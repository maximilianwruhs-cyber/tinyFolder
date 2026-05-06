import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type, type Static } from "typebox";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

type GzmoAction = "think" | "search" | "chain";

/* ── helpers ── */

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function isAbsPosixOrNative(p: string): boolean {
  return path.isAbsolute(p);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function parseDotEnvFile(envFile: string): Promise<Record<string, string>> {
  const raw = await fsp.readFile(envFile, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function walkForEnv(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  while (true) {
    const env1 = path.join(dir, ".env");
    if (await fileExists(env1)) return env1;
    const env2 = path.join(dir, "gzmo-daemon", ".env");
    if (await fileExists(env2)) return env2;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function resolveVaultPath(): Promise<{ vaultPath: string; envFile?: string }> {
  const envFromProcess = asNonEmptyString(process.env.VAULT_PATH);
  const envFileOverride = asNonEmptyString(process.env.GZMO_ENV_FILE);

  if (envFileOverride && (await fileExists(envFileOverride))) {
    const parsed = await parseDotEnvFile(envFileOverride);
    const vp = asNonEmptyString(parsed["VAULT_PATH"]);
    if (!vp) throw new Error(`GZMO_ENV_FILE set but VAULT_PATH missing: ${envFileOverride}`);
    if (!isAbsPosixOrNative(vp)) throw new Error(`VAULT_PATH must be absolute (got: ${vp})`);
    return { vaultPath: vp, envFile: envFileOverride };
  }

  if (envFromProcess) {
    if (!isAbsPosixOrNative(envFromProcess)) throw new Error(`VAULT_PATH must be absolute (got: ${envFromProcess})`);
    return { vaultPath: envFromProcess };
  }

  const walked = await walkForEnv(process.cwd());
  if (!walked) {
    throw new Error(
      "No .env found. Set GZMO_ENV_FILE=/path/to/gzmo-daemon/.env or set VAULT_PATH, or run Pi from within the tinyFolder repo tree.",
    );
  }
  const parsed = await parseDotEnvFile(walked);
  const vp = asNonEmptyString(parsed["VAULT_PATH"]);
  if (!vp) throw new Error(`VAULT_PATH not set after sourcing: ${walked}`);
  if (!isAbsPosixOrNative(vp)) throw new Error(`VAULT_PATH must be absolute (got: ${vp})`);
  return { vaultPath: vp, envFile: walked };
}

function makeTaskFrontmatter(action: GzmoAction, chainNext?: string): string {
  if (action === "chain") {
    const cn = asNonEmptyString(chainNext);
    if (!cn) throw new Error("chain_next is required when action=chain");
    return `---\nstatus: pending\naction: chain\nchain_next: ${cn}\n---\n`;
  }
  return `---\nstatus: pending\naction: ${action}\n---\n`;
}

function parseFrontmatter(md: string): { frontmatter: Record<string, string>; body: string } {
  const lines = md.split(/\r?\n/);
  if (lines[0] !== "---") return { frontmatter: {}, body: md };
  let i = 1;
  const fm: Record<string, string> = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---") {
      i++;
      break;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    val = val.replace(/^['"]|['"]$/g, "");
    fm[key] = val;
  }
  return { frontmatter: fm, body: lines.slice(i).join("\n") };
}

async function readTaskStatus(taskPath: string): Promise<string | null> {
  const md = await fsp.readFile(taskPath, "utf8");
  const { frontmatter } = parseFrontmatter(md);
  return asNonEmptyString(frontmatter["status"]);
}

async function tailLines(filePath: string, maxLines: number): Promise<string> {
  const md = await fsp.readFile(filePath, "utf8");
  const lines = md.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

function tailLineArray(fileText: string, maxLines: number): string[] {
  const lines = fileText.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines));
}

function extractInjectedContext(markdown: string): string {
  const { body } = parseFrontmatter(markdown);
  const b = body.trimStart();
  const evIdx = b.indexOf("## Evidence Packet");
  if (evIdx >= 0) return b.slice(evIdx).trim();
  const respIdx = b.indexOf("## GZMO Response");
  if (respIdx >= 0) return b.slice(respIdx).trim();
  return b.trim();
}

/* ── session-scoped state ── */

type SessionUiHandles = {
  gzmoDirWatcher: fs.FSWatcher | null;
  inboxDirWatcher: fs.FSWatcher | null;
  debounce: NodeJS.Timeout | null;
  inboxDebounce: NodeJS.Timeout | null;
};

const sessionLiveWatch = new Map<string, SessionUiHandles>();
const sessionNotifyPaths = new Map<string, Set<string>>();

function getSessionHandles(sessionId: string): SessionUiHandles {
  let h = sessionLiveWatch.get(sessionId);
  if (!h) {
    h = { gzmoDirWatcher: null, inboxDirWatcher: null, debounce: null, inboxDebounce: null };
    sessionLiveWatch.set(sessionId, h);
  }
  return h;
}

function getSessionNotifyPaths(sessionId: string): Set<string> {
  let s = sessionNotifyPaths.get(sessionId);
  if (!s) {
    s = new Set<string>();
    sessionNotifyPaths.set(sessionId, s);
  }
  return s;
}

function stopLiveWatch(sessionId: string): void {
  const h = sessionLiveWatch.get(sessionId);
  if (h) {
    if (h.debounce) {
      clearTimeout(h.debounce);
      h.debounce = null;
    }
    if (h.inboxDebounce) {
      clearTimeout(h.inboxDebounce);
      h.inboxDebounce = null;
    }
    try {
      h.gzmoDirWatcher?.close();
    } catch { /* ignore */ }
    try {
      h.inboxDirWatcher?.close();
    } catch { /* ignore */ }
    h.gzmoDirWatcher = null;
    h.inboxDirWatcher = null;
    sessionLiveWatch.delete(sessionId);
  }
  sessionNotifyPaths.delete(sessionId);
}

async function reconstructTrackedTasks(ctx: ExtensionContext): Promise<void> {
  const sid = ctx.sessionManager.getSessionId();
  const notify = getSessionNotifyPaths(sid);
  notify.clear();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message as { role?: string; toolName?: string; details?: { task_path?: string } };
    if (msg.role !== "toolResult") continue;
    if (msg.toolName !== "gzmo_submit_task" && msg.toolName !== "gzmo_query_context") continue;
    const p = msg.details?.task_path;
    if (!p) continue;
    try {
      const st = await readTaskStatus(p);
      if (st === "pending" || st === "processing") notify.add(p);
    } catch { /* ignore */ }
  }
}

async function flushTerminalNotifications(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const sid = ctx.sessionManager.getSessionId();
  const notify = getSessionNotifyPaths(sid);
  if (notify.size === 0) return;
  for (const p of [...notify]) {
    try {
      const st = await readTaskStatus(p);
      if (st !== "completed" && st !== "failed") continue;
      notify.delete(p);
      const bn = path.basename(p);
      pi.sendMessage(
        {
          customType: "gzmo-task-terminal",
          content: `GZMO task ${st}: ${bn} — use gzmo_read_task if you need the full file.`,
          display: true,
          details: { task_path: p, final_status: st },
        },
        { triggerTurn: false },
      );
      await updateUiStatus(ctx);
    } catch { /* unreadable */ }
  }
}

function scheduleLiveStreamRefresh(ctx: ExtensionContext, sessionId: string): void {
  const handles = getSessionHandles(sessionId);
  if (handles.debounce) clearTimeout(handles.debounce);
  handles.debounce = setTimeout(async () => {
    handles.debounce = null;
    await updateUiStatus(ctx);
  }, 200);
}

function scheduleInboxNotify(pi: ExtensionAPI, ctx: ExtensionContext, sessionId: string): void {
  const handles = getSessionHandles(sessionId);
  if (handles.inboxDebounce) clearTimeout(handles.inboxDebounce);
  handles.inboxDebounce = setTimeout(async () => {
    handles.inboxDebounce = null;
    await flushTerminalNotifications(pi, ctx);
  }, 120);
}

async function waitForTerminalTaskStatus(
  taskPath: string,
  signal: AbortSignal | undefined,
  maxSec: number,
  pollSec: number,
): Promise<"completed" | "failed"> {
  const started = Date.now();
  let lastStatus: string | null = null;
  let wakeEarly = false;
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(taskPath, () => {
      wakeEarly = true;
    });
  } catch {
    /* task file may not exist yet */
  }

  try {
    while ((Date.now() - started) / 1000 < maxSec) {
      if (signal?.aborted) throw new Error("Aborted");
      const status = await readTaskStatus(taskPath);
      lastStatus = status;
      if (status === "completed" || status === "failed") return status;
      const delayMs = wakeEarly ? 0 : Math.max(1, pollSec) * 1000;
      wakeEarly = false;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  } finally {
    try {
      watcher?.close();
    } catch { /* ignore */ }
  }
  throw new Error(`Timeout after ${maxSec}s waiting for completed|failed (last status: ${lastStatus ?? "unknown"})`);
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`);

  const fh = await fsp.open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(content, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, filePath);
}

function mkTaskFilename(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = crypto.randomBytes(8).toString("hex").slice(0, 6);
  return `${ts}_${rand}.md`;
}

/* ── inbox data ── */

type TaskRow = { path: string; status: string | null; updated_at: string; action: string | null };

async function listInbox(filterStatus?: string | null, limit = 20): Promise<TaskRow[]> {
  const { vaultPath } = await resolveVaultPath();
  const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
  const tasks: TaskRow[] = [];
  if (!(await fileExists(inboxDir))) return [];
  const entries = await fsp.readdir(inboxDir);
  for (const e of entries) {
    if (!e.endsWith(".md")) continue;
    const p = path.join(inboxDir, e);
    try {
      const st = await fsp.stat(p);
      const md = await fsp.readFile(p, "utf8");
      const { frontmatter } = parseFrontmatter(md);
      const status = asNonEmptyString(frontmatter["status"]);
      const action = asNonEmptyString(frontmatter["action"]);
      if (filterStatus && status !== filterStatus) continue;
      tasks.push({ path: p, status, action, updated_at: st.mtime.toISOString() });
    } catch {
      // ignore unreadable tasks
    }
  }
  tasks.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return tasks.slice(0, Math.max(1, Math.min(200, limit)));
}

/* ── UI helpers ── */

async function updateUiStatus(ctx: ExtensionContext): Promise<void> {
  try {
    const { vaultPath } = await resolveVaultPath();
    const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
    let pending = 0;
    let processing = 0;
    if (await fileExists(inboxDir)) {
      const entries = await fsp.readdir(inboxDir);
      for (const e of entries) {
        if (!e.endsWith(".md")) continue;
        const p = path.join(inboxDir, e);
        try {
          const s = await readTaskStatus(p);
          if (s === "pending") pending++;
          if (s === "processing") processing++;
        } catch {
          // ignore unreadable tasks
        }
      }
    }
    const vaultName = path.basename(vaultPath);
    const summary = `GZMO: ${pending} pending, ${processing} processing`;
    ctx.ui.setStatus("gzmo", summary);

    const liveStreamPath = path.join(vaultPath, "GZMO", "Live_Stream.md");
    let tail: string[] = await fileExists(liveStreamPath)
      ? tailLineArray(await fsp.readFile(liveStreamPath, "utf8"), 5).map((l) =>
          l.length > 240 ? `${l.slice(0, 237)}…` : l,
        )
      : [];

    if (tail.length === 0) tail = ["(Live_Stream idle or not created yet)"];

    const widgetLines = [summary, `vault: ${vaultName}`, "── live ──", ...tail];
    ctx.ui.setWidget("gzmo", widgetLines, { placement: "belowEditor" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.setStatus("gzmo", `GZMO: env missing (${msg})`);
    ctx.ui.setWidget("gzmo", [`GZMO: env missing`, msg], { placement: "belowEditor" });
  }
}

async function attachGzmoWatchers(pi: ExtensionAPI, ctx: ExtensionContext, sessionId: string): Promise<void> {
  stopLiveWatch(sessionId);
  const handles = getSessionHandles(sessionId);
  let gzmoDir: string;
  let inboxDir: string;
  try {
    const { vaultPath } = await resolveVaultPath();
    gzmoDir = path.join(vaultPath, "GZMO");
    inboxDir = path.join(vaultPath, "GZMO", "Inbox");
    await fsp.mkdir(inboxDir, { recursive: true });
  } catch {
    await updateUiStatus(ctx);
    return;
  }

  try {
    handles.gzmoDirWatcher = fs.watch(gzmoDir, (_ev, filename) => {
      if (filename !== "Live_Stream.md") return;
      scheduleLiveStreamRefresh(ctx, sessionId);
    });
  } catch {
    handles.gzmoDirWatcher = null;
  }

  try {
    handles.inboxDirWatcher = fs.watch(inboxDir, () => {
      scheduleInboxNotify(pi, ctx, sessionId);
    });
  } catch {
    handles.inboxDirWatcher = null;
  }
  await updateUiStatus(ctx);
}

/* ── dashboard component ── */

type DashboardState = {
  pending: number;
  processing: number;
  vaultName: string;
  tasks: TaskRow[];
  liveLines: string[];
  healthText: string;
};

class GzmoDashboardComponent {
  private state: DashboardState;
  private theme: Theme;
  private onClose: () => void;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(state: DashboardState, theme: Theme, onClose: () => void) {
    this.state = state;
    this.theme = theme;
    this.onClose = onClose;
  }

  setState(state: DashboardState) {
    this.state = state;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const th = this.theme;
    const lines: string[] = [];
    this._renderHeader(lines, th, width);
    this._renderCounts(lines, th, width);
    this._renderTasks(lines, th, width);
    this._renderLive(lines, th, width);
    this._renderHealth(lines, th, width);
    this._renderFooter(lines, th, width);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private _renderHeader(lines: string[], th: Theme, width: number) {
    const title = th.fg("accent", " GZMO ");
    const headerLine =
      th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
    lines.push("");
    lines.push(truncateToWidth(headerLine, width));
    lines.push("");
  }

  private _renderCounts(lines: string[], th: Theme, width: number) {
    lines.push(
      truncateToWidth(
        `  ${th.fg("muted", "vault:")} ${th.fg("text", this.state.vaultName)}  ${th.fg("warning", `${this.state.pending} pending`)}  ${th.fg("accent", `${this.state.processing} processing`)}`,
        width,
      ),
    );
    lines.push("");
  }

  private _renderTasks(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("muted", "Recent Inbox (newest first)")}`, width));
    if (this.state.tasks.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "(no tasks)")}`, width));
    } else {
      for (const t of this.state.tasks) {
        const st = t.status ?? "?";
        const col =
          st === "completed" ? th.fg("success", st) : st === "failed" ? th.fg("error", st) : th.fg("muted", st);
        const base = path.basename(t.path);
        lines.push(truncateToWidth(`  ${col} ${th.fg("dim", String(t.action ?? "?"))}  ${base}`, width));
      }
    }
    lines.push("");
  }

  private _renderLive(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("muted", "Live_Stream (tail)")}`, width));
    for (const ln of this.state.liveLines) {
      lines.push(truncateToWidth(`  ${th.fg("dim", ln)}`, width));
    }
    lines.push("");
  }

  private _renderHealth(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("muted", "health.md (tail)")}`, width));
    for (const ln of this.state.healthText.split("\n").slice(0, 8)) {
      lines.push(truncateToWidth(`  ${th.fg("text", ln)}`, width));
    }
    lines.push("");
  }

  private _renderFooter(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("dim", "r = refresh  |  Escape = close")}`, width));
    lines.push("");
  }
}

async function fetchDashboardState(): Promise<DashboardState> {
  const { vaultPath } = await resolveVaultPath();
  const vaultName = path.basename(vaultPath);
  const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
  let pending = 0;
  let processing = 0;
  if (await fileExists(inboxDir)) {
    for (const e of await fsp.readdir(inboxDir)) {
      if (!e.endsWith(".md")) continue;
      const p = path.join(inboxDir, e);
      try {
        const s = await readTaskStatus(p);
        if (s === "pending") pending++;
        if (s === "processing") processing++;
      } catch { /* */ }
    }
  }
  const tasks = await listInbox(null, 10);
  const liveStreamPath = path.join(vaultPath, "GZMO", "Live_Stream.md");
  const liveLines = await fileExists(liveStreamPath)
    ? tailLineArray(await fsp.readFile(liveStreamPath, "utf8"), 8).map((l) =>
        l.length > 120 ? `${l.slice(0, 117)}…` : l,
      )
    : ["(no Live_Stream yet)"];
  const hp = path.join(vaultPath, "GZMO", "health.md");
  let healthText: string;
  try {
    healthText = await tailLines(hp, 12);
  } catch {
    healthText = "(health not available)";
  }
  return { pending, processing, vaultName, tasks, liveLines, healthText };
}

/* ── schemas ── */

const SubmitParams = Type.Object({
  action: Type.Union([Type.Literal("think"), Type.Literal("search"), Type.Literal("chain")]),
  body: Type.String({ description: "Markdown body of the task" }),
  chain_next: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: "Required when action=chain. Filename for the next step under GZMO/Subtasks/.",
    }),
  ),
});

const ReadParams = Type.Object({
  task_path: Type.String(),
  tail_lines: Type.Optional(Type.Integer({ minimum: 10, maximum: 400, default: 60 })),
});

const WatchParams = Type.Object({
  task_path: Type.String(),
  max_seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 86400, default: 600 })),
  poll_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 2 })),
  tail_lines: Type.Optional(Type.Integer({ minimum: 10, maximum: 600, default: 120 })),
});

const ListParams = Type.Object({
  status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 20 })),
});

const LastParams = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 10 })),
});

const HealthParams = Type.Object({
  lines: Type.Optional(Type.Integer({ minimum: 5, maximum: 200, default: 60 })),
});

const QueryContextParams = Type.Object({
  query: Type.String({
    description:
      "Natural-language question answered via GZMO vault search (RAG). The daemon retrieves snippets and returns an evidence-grounded answer.",
  }),
  max_seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 86400, default: 900 })),
  poll_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 2 })),
});

/* ── main ── */

export default function gzmoTinyFolderExtension(pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({
    skillPaths: [path.join(extensionDir, "skills", "gzmo-daemon")],
  }));

  pi.on("session_start", async (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    await reconstructTrackedTasks(ctx);
    await attachGzmoWatchers(pi, ctx, sid);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await reconstructTrackedTasks(ctx);
    await attachGzmoWatchers(pi, ctx, ctx.sessionManager.getSessionId());
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopLiveWatch(ctx.sessionManager.getSessionId());
    ctx.ui.setWidget("gzmo", undefined);
    ctx.ui.setStatus("gzmo", undefined);
  });

  pi.on("before_agent_start", async () => {
    try {
      const { vaultPath } = await resolveVaultPath();
      const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
      let pending = 0;
      let processing = 0;
      if (await fileExists(inboxDir)) {
        for (const e of await fsp.readdir(inboxDir)) {
          if (!e.endsWith(".md")) continue;
          const p = path.join(inboxDir, e);
          try {
            const s = await readTaskStatus(p);
            if (s === "pending") pending++;
            if (s === "processing") processing++;
          } catch { /* ignore */ }
        }
      }
      if (pending === 0 && processing === 0) return undefined;
      return {
        message: {
          customType: "gzmo-status",
          content: `GZMO Inbox: ${pending} pending, ${processing} processing.`,
          display: false,
        },
      };
    } catch {
      return undefined;
    }
  });

  /* ── submit ── */

  pi.registerTool({
    name: "gzmo_submit_task",
    label: "GZMO submit",
    description:
      "Create a tinyFolder/GZMO Inbox task file under VAULT_PATH/GZMO/Inbox with correct frontmatter (status/action).",
    promptSnippet: "Submit a task to the GZMO daemon Inbox",
    promptGuidelines: [
      "Use gzmo_submit_task when the user wants to create a GZMO task (think, search, or chain).",
      "Always include the full task body as Markdown.",
      "For chain actions, also provide chain_next pointing to a filename in GZMO/Subtasks/.",
    ],
    parameters: SubmitParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof SubmitParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ task_path: string }>> {
      const action = params.action as GzmoAction;
      const body = asNonEmptyString(params.body);
      const chainNext = params.chain_next ?? null;
      if (!body) throw new Error("body is required");

      const { vaultPath } = await resolveVaultPath();
      const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
      const filePath = path.join(inboxDir, mkTaskFilename());
      const fm = makeTaskFrontmatter(action, chainNext ?? undefined);
      await atomicWriteFile(filePath, `${fm}${body}\n`);
      getSessionNotifyPaths(ctx.sessionManager.getSessionId()).add(filePath);
      ctx.ui.notify(`GZMO task submitted: ${filePath}`, "info");
      await updateUiStatus(ctx);
      return {
        content: [{ type: "text", text: filePath }],
        details: { task_path: filePath },
      };
    },
    renderCall(args, theme) {
      const tail = asNonEmptyString(args.body)?.replace(/\s+/g, " ").slice(0, 48) ?? "";
      let line = theme.fg("toolTitle", theme.bold("GZMO submit ")) + theme.fg("accent", args.action);
      if (tail) line += theme.fg("dim", ` — ${tail}${tail.length >= 48 ? "…" : ""}`);
      return new Text(line, 0, 0);
    },
    renderResult(result, { expanded }, theme, _ctx) {
      const d = result.details as { task_path?: string } | undefined;
      const p = d?.task_path ?? (result.content[0]?.type === "text" ? result.content[0].text : "");
      const show = expanded ? p : path.basename(String(p));
      return new Text(theme.fg("success", "📤 ") + theme.fg("muted", show), 0, 0);
    },
  });

  /* ── read ── */

  pi.registerTool({
    name: "gzmo_read_task",
    label: "GZMO read",
    description: "Read a GZMO task file, returning status/frontmatter plus a small tail excerpt.",
    promptSnippet: "Read a GZMO task file to inspect its status and output",
    promptGuidelines: [
      "Use gzmo_read_task to inspect a task file after watching or when the user asks for full details.",
      "Provides frontmatter status and a configurable tail excerpt.",
    ],
    parameters: ReadParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof ReadParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ status: string | null; frontmatter: Record<string, string>; tail: string }>> {
      const taskPath = asNonEmptyString(params.task_path);
      const tailN = typeof params.tail_lines === "number" ? params.tail_lines : 60;
      if (!taskPath) throw new Error("task_path is required");
      const md = await fsp.readFile(taskPath, "utf8");
      const { frontmatter } = parseFrontmatter(md);
      const status = asNonEmptyString(frontmatter["status"]);
      const tail = await tailLines(taskPath, Math.max(10, Math.min(400, tailN)));
      await updateUiStatus(ctx);
      return {
        content: [{ type: "text", text: `status: ${status ?? "?"}\n\n${tail}` }],
        details: { status, frontmatter, tail },
      };
    },
    renderCall(args, theme) {
      const bn = path.basename(args.task_path);
      return new Text(theme.fg("toolTitle", theme.bold("GZMO read ")) + theme.fg("accent", bn), 0, 0);
    },
    renderResult(result, { expanded }, theme, _ctx) {
      const d = result.details as { status?: string; tail?: string } | undefined;
      const st = d?.status ?? "?";
      const stColor = st === "completed" ? "success" : st === "failed" ? "error" : "muted";
      const tail = d?.tail ?? (result.content[0]?.type === "text" ? result.content[0].text : "");
      const preview = expanded ? tail : tail.split("\n").slice(0, 6).join("\n");
      return new Text(
        theme.fg(stColor, `status: ${st}`) + "\n" + theme.fg("dim", preview),
        0,
        0,
      );
    },
  });

  /* ── watch ── */

  pi.registerTool({
    name: "gzmo_watch_task",
    label: "GZMO watch",
    description:
      "Wait until a task file reaches status completed or failed (or timeout). Uses filesystem watch for faster wake; still polls as a backstop.",
    promptSnippet: "Wait for a GZMO task to finish and return its result",
    promptGuidelines: [
      "Use gzmo_watch_task after gzmo_submit_task when you need the final output.",
      "Blocks until the daemon marks the task completed or failed, or a timeout is reached.",
    ],
    parameters: WatchParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof WatchParams>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ final_status: string; excerpt: string }>> {
      const taskPath = asNonEmptyString(params.task_path);
      if (!taskPath) throw new Error("task_path is required");
      const maxSec = typeof params.max_seconds === "number" ? params.max_seconds : 600;
      const pollSec = typeof params.poll_seconds === "number" ? params.poll_seconds : 2;
      const tailN = typeof params.tail_lines === "number" ? params.tail_lines : 120;

      const sid = ctx.sessionManager.getSessionId();
      const notify = getSessionNotifyPaths(sid);
      let tracking = false;
      try {
        const pre = await readTaskStatus(taskPath);
        if (pre !== "completed" && pre !== "failed") {
          notify.add(taskPath);
          tracking = true;
        }
      } catch {
        notify.add(taskPath);
        tracking = true;
      }
      const status = await waitForTerminalTaskStatus(taskPath, signal, maxSec, pollSec);
      const excerpt = await tailLines(taskPath, Math.max(10, Math.min(600, tailN)));
      if (tracking) notify.delete(taskPath);
      await updateUiStatus(ctx);
      return {
        content: [{ type: "text", text: `final_status: ${status}\n\n${excerpt}` }],
        details: { final_status: status, excerpt },
      };
    },
    renderCall(args, theme) {
      const bn = path.basename(args.task_path);
      return new Text(theme.fg("toolTitle", theme.bold("GZMO watch ")) + theme.fg("accent", bn), 0, 0);
    },
    renderResult(result, { isPartial, expanded }, theme, _ctx) {
      if (isPartial) {
        return new Text(theme.fg("warning", "⏳ Waiting for task…"), 0, 0);
      }
      const d = result.details as { final_status?: string } | undefined;
      const st = d?.final_status;
      if (st === "failed") return new Text(theme.fg("error", `❌ final_status: ${st}`), 0, 0);
      if (st === "completed") return new Text(theme.fg("success", `✓ final_status: ${st}`), 0, 0);
      const t = result.content[0];
      const raw = t?.type === "text" ? t.text : "";
      const preview = expanded ? raw : raw.split("\n").slice(0, 4).join("\n");
      return new Text(theme.fg("muted", preview), 0, 0);
    },
  });

  /* ── query context (search) ── */

  pi.registerTool({
    name: "gzmo_query_context",
    label: "GZMO query context",
    description:
      "Run a semantic vault search via GZMO (Inbox task action: search), wait for completion, and return grounded text for Pi context. Prefer ## Evidence Packet when present in the task file; otherwise returns ## GZMO Response. Note: the daemon currently persists the model answer; full snippet blocks are usually implied by [E#] citations in that answer.",
    promptSnippet: "Search the GZMO vault for evidence-grounded answers",
    promptGuidelines: [
      "Use gzmo_query_context when the user asks about vault content, project knowledge, or anything requiring RAG search.",
      "This creates a search task, waits for daemon completion, and returns the Evidence Packet or GZMO Response.",
      "Do not use for general web search — this is vault-local RAG only.",
    ],
    parameters: QueryContextParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof QueryContextParams>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ task_path: string; final_status: string; injected: string }>> {
      const q = asNonEmptyString(params.query);
      if (!q) throw new Error("query is required");
      const maxSec = typeof params.max_seconds === "number" ? params.max_seconds : 900;
      const pollSec = typeof params.poll_seconds === "number" ? params.poll_seconds : 2;

      const { vaultPath } = await resolveVaultPath();
      const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
      const filePath = path.join(inboxDir, mkTaskFilename());
      const fm = makeTaskFrontmatter("search");
      const body = `## Pi context query\n\n${q}\n\n_(via gzmo_query_context — answer with vault evidence.)_\n`;
      await atomicWriteFile(filePath, `${fm}${body}`);
      getSessionNotifyPaths(ctx.sessionManager.getSessionId()).add(filePath);
      ctx.ui.notify(`GZMO search started: ${filePath}`, "info");

      const finalStatus = await waitForTerminalTaskStatus(filePath, signal, maxSec, pollSec);
      const md = await fsp.readFile(filePath, "utf8");
      const injected = extractInjectedContext(md);
      getSessionNotifyPaths(ctx.sessionManager.getSessionId()).delete(filePath);
      await updateUiStatus(ctx);

      if (finalStatus === "failed") {
        return {
          content: [{ type: "text", text: `Search task failed. Excerpt:\n\n${injected}` }],
          details: { task_path: filePath, final_status: finalStatus, injected },
        };
      }
      return {
        content: [{ type: "text", text: injected }],
        details: { task_path: filePath, final_status: finalStatus, injected },
      };
    },
    renderCall(args, theme) {
      const q = asNonEmptyString(args.query)?.replace(/\s+/g, " ").slice(0, 56) ?? "";
      return new Text(
        theme.fg("toolTitle", theme.bold("GZMO search ")) + theme.fg("dim", q) + (q.length >= 56 ? "…" : ""),
        0,
        0,
      );
    },
    renderResult(result, { isPartial, expanded }, theme, _ctx) {
      if (isPartial) {
        return new Text(theme.fg("warning", "🔍 Searching vault…"), 0, 0);
      }
      const d = result.details as { final_status?: string; injected?: string } | undefined;
      if (d?.final_status === "failed") {
        return new Text(theme.fg("error", "❌ Search task failed"), 0, 0);
      }
      const injected = d?.injected ?? (result.content[0]?.type === "text" ? result.content[0].text : "");
      const preview = expanded ? injected : injected.split("\n").slice(0, 5).join("\n");
      return new Text(theme.fg("success", "✓ Evidence / response ready\n") + theme.fg("muted", preview), 0, 0);
    },
  });

  /* ── list ── */

  pi.registerTool({
    name: "gzmo_list_tasks",
    label: "GZMO list",
    description: "List tasks in VAULT_PATH/GZMO/Inbox with statuses, newest first.",
    promptSnippet: "List GZMO Inbox tasks with optional status filter",
    promptGuidelines: [
      "Use gzmo_list_tasks to enumerate tasks, optionally filtering by status.",
      "Returns up to 200 tasks sorted newest first.",
    ],
    parameters: ListParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof ListParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ tasks: TaskRow[] }>> {
      const desiredStatus = asNonEmptyString(params.status ?? "") ?? null;
      const limit = typeof params.limit === "number" ? params.limit : 20;
      const tasks = await listInbox(desiredStatus, limit);
      await updateUiStatus(ctx);
      const lines = tasks.map((t) => `- ${t.status ?? "?"} ${t.action ?? "?"}  ${t.path}`);
      return {
        content: [{ type: "text", text: lines.join("\n") || "(no tasks)" }],
        details: { tasks },
      };
    },
    renderCall(args, theme) {
      const filter = asNonEmptyString(args.status) ?? "all";
      const limit = typeof args.limit === "number" ? args.limit : 20;
      return new Text(
        theme.fg("toolTitle", theme.bold("GZMO list ")) +
          theme.fg("accent", filter) +
          theme.fg("dim", ` (limit ${limit})`),
        0,
        0,
      );
    },
    renderResult(result, { expanded }, theme, _ctx) {
      const d = result.details as { tasks?: TaskRow[] } | undefined;
      const tasks = d?.tasks ?? [];
      if (tasks.length === 0) return new Text(theme.fg("dim", "(no tasks)"), 0, 0);
      const lines = tasks.map((t) => {
        const st = t.status ?? "?";
        const col = st === "completed" ? "success" : st === "failed" ? "error" : "muted";
        return `${theme.fg(col, st)} ${theme.fg("dim", t.action ?? "?")}  ${path.basename(t.path)}`;
      });
      const cap = expanded ? lines : lines.slice(0, 8);
      let text = cap.join("\n");
      if (!expanded && lines.length > 8) text += `\n${theme.fg("dim", `… ${lines.length - 8} more`)}`;
      return new Text(text, 0, 0);
    },
  });

  /* ── last ── */

  pi.registerTool({
    name: "gzmo_last_tasks",
    label: "GZMO last",
    description: "Convenience wrapper: list last N tasks (newest first).",
    promptSnippet: "List the most recent GZMO Inbox tasks",
    promptGuidelines: [
      "Use gzmo_last_tasks as a quick shorthand for listing recent tasks without a status filter.",
      "Default limit is 10; max is 200.",
    ],
    parameters: LastParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof LastParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ tasks: TaskRow[] }>> {
      const limit = typeof params.limit === "number" ? params.limit : 10;
      const tasks = await listInbox(null, limit);
      await updateUiStatus(ctx);
      const lines = tasks.map((t) => `- ${t.status ?? "?"} ${t.action ?? "?"}  ${t.path}`);
      return {
        content: [{ type: "text", text: lines.join("\n") || "(no tasks)" }],
        details: { tasks },
      };
    },
    renderCall(args, theme) {
      const limit = typeof args.limit === "number" ? args.limit : 10;
      return new Text(theme.fg("toolTitle", theme.bold("GZMO last ")) + theme.fg("dim", `(${limit})`), 0, 0);
    },
    renderResult(result, { expanded }, theme, _ctx) {
      const d = result.details as { tasks?: TaskRow[] } | undefined;
      const tasks = d?.tasks ?? [];
      if (tasks.length === 0) return new Text(theme.fg("dim", "(no tasks)"), 0, 0);
      const lines = tasks.map((t) => {
        const st = t.status ?? "?";
        const col = st === "completed" ? "success" : st === "failed" ? "error" : "muted";
        return `${theme.fg(col, st)} ${theme.fg("dim", t.action ?? "?")}  ${path.basename(t.path)}`;
      });
      const cap = expanded ? lines : lines.slice(0, 8);
      let text = cap.join("\n");
      if (!expanded && lines.length > 8) text += `\n${theme.fg("dim", `… ${lines.length - 8} more`)}`;
      return new Text(text, 0, 0);
    },
  });

  /* ── health ── */

  pi.registerTool({
    name: "gzmo_health",
    label: "GZMO health",
    description: "Read the latest daemon health report from VAULT_PATH/GZMO/health.md.",
    promptSnippet: "Check GZMO daemon health status",
    promptGuidelines: [
      "Use gzmo_health to quickly check the daemon's health report.",
      "If unhealthy, consider running the doctor script or restarting the daemon.",
    ],
    parameters: HealthParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof HealthParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ health_path: string }>> {
      const { vaultPath } = await resolveVaultPath();
      const healthPath = path.join(vaultPath, "GZMO", "health.md");
      const tailN = typeof params.lines === "number" ? params.lines : 60;
      let text: string;
      try {
        text = await tailLines(healthPath, Math.max(5, Math.min(200, tailN)));
      } catch {
        text = "(health report not yet generated)";
      }
      ctx.ui.notify("GZMO health loaded", "info");
      return {
        content: [{ type: "text", text }],
        details: { health_path: healthPath },
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("GZMO health")), 0, 0);
    },
    renderResult(result, { expanded }, theme, _ctx) {
      const t = result.content[0];
      const raw = t?.type === "text" ? t.text : "";
      const lines = raw.split("\n");
      const cap = expanded ? 24 : 8;
      return new Text(theme.fg("muted", lines.slice(0, cap).join("\n")), 0, 0);
    },
  });

  /* ── commands ── */

  pi.registerCommand("gzmo", {
    description: "Open GZMO dashboard (counts, recent tasks, live stream, health tail). Press r to refresh.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/gzmo requires interactive mode", "error");
        return;
      }

      let state: DashboardState;
      try {
        state = await fetchDashboardState();
      } catch (e: unknown) {
        ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
        return;
      }

      let component: GzmoDashboardComponent | null = null;

      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        component = new GzmoDashboardComponent(state, theme, () => done());

        return {
          render: (width: number) => component!.render(width),
          invalidate: () => component!.invalidate(),
          handleInput: (data: string) => {
            if (matchesKey(data, "r")) {
              fetchDashboardState()
                .then((s) => {
                  state = s;
                  component?.setState(s);
                  _tui.requestRender();
                })
                .catch(() => {
                  /* ignore refresh errors */
                });
              return;
            }
            component!.handleInput(data);
          },
        };
      });
    },
  });

  pi.registerCommand("gzmo-last", {
    description: "Show last N GZMO tasks (newest first). Usage: /gzmo-last 10",
    handler: async (args, ctx) => {
      const raw = typeof args === "string" ? args.trim() : "";
      const parsed = raw.length ? parseInt(raw, 10) : Number.NaN;
      const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 10;
      const tasks = await listInbox(null, limit);
      const lines = tasks.map((t) => `- ${t.status ?? "?"} ${t.action ?? "?"}  ${t.path}`);
      ctx.ui.notify(lines.join("\n") || "(no tasks)", "info");
      await updateUiStatus(ctx);
    },
  });
}
