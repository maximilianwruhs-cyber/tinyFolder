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
const sessionSseClose = new Map<string, () => void>();

/**
 * If the /gzmo dashboard is currently mounted, its TUI handle lives here so
 * external events (SSE task_completed) can poke `requestRender()` / `refresh()`.
 * The /gzmo handler must null this on close to avoid stale-closure crashes.
 */
let dashboardRenderer: { requestRender: () => void; refresh: () => Promise<void> } | null = null;

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
  const closeSse = sessionSseClose.get(sessionId);
  if (closeSse) {
    try { closeSse(); } catch { /* ignore */ }
    sessionSseClose.delete(sessionId);
  }
}

async function maybeWarnLocalOnly(pi: ExtensionAPI): Promise<void> {
  if (process.env.GZMO_LOCAL_ONLY !== "1") return;
  const provider = process.env.OPENAI_BASE_URL ?? process.env.PI_BASE_URL ?? "";
  if (!provider) return;
  if (provider.includes("localhost") || provider.includes("127.")) return;
  pi.sendMessage(
    {
      customType: "gzmo-local-only-warning",
      content:
        `GZMO_LOCAL_ONLY=1 is set, but the Pi LLM provider URL (${provider}) is not loopback. ` +
        "Switch Pi to a localhost provider (e.g. http://localhost:11434/v1) for full local mode.",
      display: true,
    },
    { triggerTurn: false },
  );
}

async function attachApiSseListener(pi: ExtensionAPI, ctx: ExtensionContext, sessionId: string): Promise<void> {
  const existing = sessionSseClose.get(sessionId);
  if (existing) {
    try { existing(); } catch { /* ignore */ }
    sessionSseClose.delete(sessionId);
  }

  const client = new GzmoApiClient();
  const h = await client.health();
  if (!h.ok) return;

  const close = client.connectSSE((ev) => {
    if (ev.type !== "task_completed" && ev.type !== "task_failed") return;
    // Update footer status + dashboard FIRST so the UI reflects the new
    // counts/model/VRAM before the chat message render is queued.
    void updateUiStatus(ctx);
    if (dashboardRenderer) {
      void dashboardRenderer.refresh();
    }
    pi.sendMessage(
      {
        customType: "gzmo-task-api",
        content: `GZMO API task ${ev.type.replace("task_", "")}: ${ev.task_id ?? "(no id)"}`,
        display: true,
        details: { task_id: ev.task_id, event: ev },
      },
      { triggerTurn: false },
    );
  });
  sessionSseClose.set(sessionId, close);
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

/* ── GZMO HTTP API client (Phase 2) ─────────────────────────────── */

type ApiClientEnv = {
  baseUrl: string;
  socketPath: string | null;
};

function readApiClientEnv(): ApiClientEnv {
  const socket = asNonEmptyString(process.env.GZMO_API_SOCKET) ?? "";
  const host = asNonEmptyString(process.env.GZMO_API_HOST) ?? "127.0.0.1";
  const port = asNonEmptyString(process.env.GZMO_API_PORT) ?? "12700";
  if (socket && fs.existsSync(socket)) return { baseUrl: `http://unix:${socket}`, socketPath: socket };
  return { baseUrl: `http://${host}:${port}`, socketPath: null };
}

type ApiSubmitOk = { ok: true; id: string; path?: string; status: string };
type ApiCallErr = { ok: false; error: string; status?: number };
type ApiHealthOk = { ok: true; data: ApiHealthShape };
type ApiTaskOk = { ok: true; data: ApiTaskShape };
type ApiSearchOk = { ok: true; answer: string; evidence?: string; trace_id?: string; task_path?: string };

type ApiHealthShape = {
  status: string;
  version: string;
  ollama_connected: boolean;
  model_loaded: string;
  embedding_model?: string;
  pending_tasks: number;
  processing_tasks: number;
  uptime_seconds: number;
  vault_path?: string;
  vram_used_mb?: number;
  vram_total_mb?: number;
};

type ApiTaskShape = {
  id: string;
  status: string;
  action?: string;
  body?: string;
  output?: string;
  evidence?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  path?: string;
};

type ApiSearchAccepted = {
  id: string;
  status: string;
  action: "search";
  path: string;
  stream_url: string;
  task_url: string;
};

type ApiEventShape = {
  type: "task_created" | "task_started" | "task_completed" | "task_failed" | "token" | "log";
  task_id?: string;
  data?: unknown;
  timestamp: string;
};

/**
 * Wait for an API task to reach `completed` or `failed`, primarily by
 * subscribing to the daemon SSE stream. A periodic poll of /api/v1/task/:id
 * acts as a backstop so callers still finish if SSE drops the event (network
 * blip, idle reconnect, etc.). Either path is sufficient on its own.
 */
async function waitForApiTaskTerminal(
  client: GzmoApiClient,
  taskId: string,
  maxSec: number,
  pollSec: number,
  signal?: AbortSignal,
): Promise<"completed" | "failed"> {
  return await new Promise<"completed" | "failed">((resolve, reject) => {
    let settled = false;
    let closeSse: (() => void) | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let deadlineTimer: NodeJS.Timeout | null = null;
    let abortHandler: (() => void) | null = null;

    const cleanup = () => {
      if (closeSse) {
        try { closeSse(); } catch { /* ignore */ }
        closeSse = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      if (abortHandler && signal) {
        signal.removeEventListener("abort", abortHandler);
        abortHandler = null;
      }
    };

    const finish = (s: "completed" | "failed") => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(s);
    };

    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    };

    closeSse = client.connectSSE((ev) => {
      if (ev.task_id !== taskId) return;
      if (ev.type === "task_completed") finish("completed");
      else if (ev.type === "task_failed") finish("failed");
    });

    pollTimer = setInterval(() => {
      void (async () => {
        const t = await client.getTask(taskId, 3000);
        if (!t.ok) return;
        if (t.data.status === "completed") finish("completed");
        else if (t.data.status === "failed") finish("failed");
      })();
    }, Math.max(1, pollSec) * 1000);

    deadlineTimer = setTimeout(
      () => fail(new Error(`Timeout after ${maxSec}s waiting for API task ${taskId}`)),
      Math.max(1, maxSec) * 1000,
    );

    if (signal) {
      if (signal.aborted) {
        fail(new Error("Aborted"));
        return;
      }
      abortHandler = () => fail(new Error("Aborted"));
      signal.addEventListener("abort", abortHandler);
    }
  });
}

class GzmoApiClient {
  readonly baseUrl: string;

  constructor(env: ApiClientEnv = readApiClientEnv()) {
    this.baseUrl = env.baseUrl;
  }

  private async fetchJson(pathSuffix: string, init?: RequestInit & { timeoutMs?: number }) {
    const timeoutMs = init?.timeoutMs ?? 5000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.baseUrl}${pathSuffix}`, {
        ...init,
        signal: init?.signal ?? ac.signal,
      });
      const text = await r.text();
      let data: any = null;
      try {
        data = text.length ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { r, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async health(timeoutMs = 2000): Promise<ApiHealthOk | ApiCallErr> {
    try {
      const { r, data } = await this.fetchJson("/api/v1/health", { timeoutMs });
      if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
      return { ok: true, data: data as ApiHealthShape };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async submitTask(action: GzmoAction, body: string, chainNext?: string): Promise<ApiSubmitOk | ApiCallErr> {
    try {
      const payload: Record<string, unknown> = { action, body };
      if (chainNext) payload.chain_next = chainNext;
      const { r, data } = await this.fetchJson("/api/v1/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
      });
      if (!r.ok) return { ok: false, status: r.status, error: data?.error ?? `HTTP ${r.status}` };
      return { ok: true, id: String(data.id), path: data.path, status: String(data.status ?? "pending") };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getTask(id: string, timeoutMs = 5000): Promise<ApiTaskOk | ApiCallErr> {
    try {
      const { r, data } = await this.fetchJson(`/api/v1/task/${encodeURIComponent(id)}`, { timeoutMs });
      if (!r.ok) return { ok: false, status: r.status, error: data?.error ?? `HTTP ${r.status}` };
      return { ok: true, data: data as ApiTaskShape };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Submit a search task to /api/v1/search and return immediately. The server
   * returns 202 Accepted with `stream_url` and `task_url`; callers then wait
   * for completion via SSE (preferred) or polling /api/v1/task/:id.
   */
  async submitSearch(query: string): Promise<{ ok: true; data: ApiSearchAccepted } | ApiCallErr> {
    try {
      const { r, data } = await this.fetchJson("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        timeoutMs: 10_000,
      });
      if (!r.ok) return { ok: false, status: r.status, error: data?.error ?? `HTTP ${r.status}` };
      return { ok: true, data: data as ApiSearchAccepted };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * High-level search: submit (non-blocking) → wait for completion via SSE
   * (with polling backstop) → fetch and return the answer + evidence packet.
   * The HTTP server never holds a worker for the full duration, so concurrent
   * /health and /task submits stay responsive while the search runs.
   */
  async search(query: string, maxSec = 120, signal?: AbortSignal): Promise<ApiSearchOk | ApiCallErr> {
    const sub = await this.submitSearch(query);
    if (!sub.ok) return sub;
    const id = sub.data.id;

    let terminal: "completed" | "failed";
    try {
      terminal = await waitForApiTaskTerminal(this, id, maxSec, 2, signal);
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const t = await this.getTask(id, 5000);
    if (!t.ok) return t;
    if (terminal === "failed") {
      return {
        ok: false,
        error: t.data.error ?? "Search task failed",
        status: 500,
      };
    }

    const answer = t.data.output ?? t.data.body ?? "";
    return {
      ok: true,
      answer,
      evidence: t.data.evidence,
      trace_id: id,
      task_path: t.data.path ?? sub.data.path,
    };
  }

  /**
   * Subscribe to the daemon SSE stream. Returns a function that closes the
   * underlying connection. Resilient to disconnects: callers are responsible
   * for re-subscribing if they want long-lived listening.
   */
  connectSSE(onEvent: (ev: ApiEventShape) => void, onClose?: () => void): () => void {
    const ac = new AbortController();
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      try {
        ac.abort();
      } catch { /* ignore */ }
      onClose?.();
    };

    (async () => {
      try {
        const r = await fetch(`${this.baseUrl}/api/v1/stream`, {
          headers: { Accept: "text/event-stream" },
          signal: ac.signal,
        });
        if (!r.ok || !r.body) {
          close();
          return;
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let eventEnd: number;
          while ((eventEnd = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, eventEnd);
            buf = buf.slice(eventEnd + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                onEvent(JSON.parse(payload) as ApiEventShape);
              } catch { /* malformed event */ }
            }
          }
        }
      } catch { /* aborted or network error */ }
      close();
    })();

    return close;
  }
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

/**
 * Render a 16-cell VRAM usage bar like `VRAM ███████░░░░░░░░░ 18/32GB`.
 * Returns an empty string when either field is missing or zero, so the
 * caller can simply concatenate without conditional spacing.
 */
function formatVramBar(used?: number, total?: number): string {
  if (!used || !total || total <= 0) return "";
  const ratio = Math.min(1, used / total);
  const filled = Math.round(ratio * 16);
  const bar = "█".repeat(filled) + "░".repeat(16 - filled);
  const u = Math.round(used / 1024);
  const t = Math.round(total / 1024);
  return `VRAM ${bar} ${u}/${t}GB`;
}

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
    const apiHealth = await new GzmoApiClient().health(800);
    let summary: string;
    if (apiHealth.ok) {
      const vram = formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb);
      const badge = `API ${apiHealth.data.status} ● ${apiHealth.data.model_loaded}`;
      summary = `GZMO: ${pending}p/${processing}a ● ${badge}` + (vram ? ` ● ${vram}` : "");
    } else {
      summary = `GZMO: ${pending}p/${processing}a ● API offline`;
    }
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
  /** Currently loaded model (e.g. "qwen3:32b") or "(API offline)" when unreachable. */
  model: string;
  /** Pre-formatted VRAM bar string, or "" when no VRAM telemetry is available. */
  vram: string;
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
    this._renderModelVram(lines, th, width);
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

  private _renderModelVram(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(
      `  ${th.fg("muted", "model:")} ${th.fg("text", this.state.model)}  ${th.fg("accent", this.state.vram)}`,
      width,
    ));
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

  // Best-effort API probe: dashboard renders even when the daemon is down.
  const client = new GzmoApiClient();
  let model = "(API offline)";
  let vram = "";
  try {
    const apiHealth = await client.health(1000);
    if (apiHealth.ok) {
      model = apiHealth.data.model_loaded;
      vram = formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb);
    }
  } catch { /* ignore — keep "(API offline)" defaults */ }

  return { pending, processing, vaultName, tasks, liveLines, healthText, model, vram };
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

const ApiSearchParams = Type.Object({
  query: Type.String({
    description:
      "Natural-language question. Calls the GZMO HTTP API directly (POST /api/v1/search) and blocks until the daemon returns an evidence-grounded answer. Falls back to the file-based search tool when the API is offline.",
  }),
  max_seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 900, default: 120 })),
});

const ApiThinkParams = Type.Object({
  body: Type.String({ description: "Markdown body of a 'think' task to submit via the GZMO HTTP API." }),
  max_seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 86400, default: 600 })),
  poll_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 2 })),
});

const ApiHealthParams = Type.Object({});

/* ── main ── */

export default function gzmoTinyFolderExtension(pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({
    skillPaths: [path.join(extensionDir, "skills", "gzmo-daemon")],
  }));

  pi.on("session_start", async (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    await reconstructTrackedTasks(ctx);
    await attachGzmoWatchers(pi, ctx, sid);
    await attachApiSseListener(pi, ctx, sid);
    await maybeWarnLocalOnly(pi);
  });

  pi.on("session_tree", async (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    await reconstructTrackedTasks(ctx);
    await attachGzmoWatchers(pi, ctx, sid);
    await attachApiSseListener(pi, ctx, sid);
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

  /* ── API: health ── */

  pi.registerTool({
    name: "gzmo_api_health",
    label: "GZMO API health",
    description:
      "Probe the GZMO HTTP API at /api/v1/health. Returns daemon status, model, embedding model, and inbox counts.",
    promptSnippet: "Check the GZMO daemon HTTP API health",
    promptGuidelines: [
      "Use gzmo_api_health to verify the daemon is reachable on its loopback HTTP API.",
      "If this fails, the file-based tools (gzmo_submit_task, gzmo_query_context) still work but won't get streaming events.",
    ],
    parameters: ApiHealthParams,
    async execute(): Promise<AgentToolResult<{ ok: boolean; data?: ApiHealthShape; error?: string }>> {
      const client = new GzmoApiClient();
      const h = await client.health(2000);
      if (!h.ok) {
        return {
          content: [{ type: "text", text: `API offline: ${h.error}` }],
          details: { ok: false, error: h.error },
        };
      }
      const d = h.data;
      const text = [
        `status: ${d.status}`,
        `version: ${d.version}`,
        `ollama_connected: ${d.ollama_connected}`,
        `model: ${d.model_loaded}`,
        `embedding_model: ${d.embedding_model ?? "?"}`,
        `pending: ${d.pending_tasks}`,
        `processing: ${d.processing_tasks}`,
        `uptime_seconds: ${d.uptime_seconds}`,
        d.vault_path ? `vault: ${d.vault_path}` : "",
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text }], details: { ok: true, data: d } };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("GZMO API health")), 0, 0);
    },
    renderResult(result, _opts, theme, _ctx) {
      const d = result.details as { ok?: boolean; data?: ApiHealthShape; error?: string } | undefined;
      if (!d?.ok) return new Text(theme.fg("error", `❌ ${d?.error ?? "API offline"}`), 0, 0);
      const x = d.data!;
      const col = x.status === "healthy" ? "success" : x.status === "degraded" ? "warning" : "error";
      return new Text(
        theme.fg(col, `● ${x.status}`) +
          theme.fg("muted", `  ${x.model_loaded}  ${x.pending_tasks}p/${x.processing_tasks}a`),
        0,
        0,
      );
    },
  });

  /* ── API: synchronous search ── */

  pi.registerTool({
    name: "gzmo_api_search",
    label: "GZMO API search",
    description:
      "Run a vault search via the GZMO HTTP API. The server submits the search task non-blocking (POST /api/v1/search returns 202 in milliseconds) and this tool waits for completion via SSE (with a polling backstop), then returns the grounded answer plus the evidence packet. Falls back to the file-based gzmo_query_context flow if the API is offline.",
    promptSnippet: "Search the GZMO vault via the HTTP API (async over SSE)",
    promptGuidelines: [
      "Prefer gzmo_api_search over gzmo_query_context when the daemon's HTTP API is enabled — submit returns immediately and completion is delivered via SSE, so the daemon stays responsive to other requests.",
      "If the API is unreachable, this tool transparently falls back to the file-based flow.",
    ],
    parameters: ApiSearchParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof ApiSearchParams>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ via: "api" | "file"; answer: string; evidence?: string; trace_id?: string; task_path?: string }>> {
      const q = asNonEmptyString(params.query);
      if (!q) throw new Error("query is required");
      const maxSec = typeof params.max_seconds === "number" ? params.max_seconds : 120;

      const client = new GzmoApiClient();
      const h = await client.health(800);
      if (h.ok) {
        const r = await client.search(q, maxSec, signal);
        if (r.ok) {
          await updateUiStatus(ctx);
          const text = r.evidence ? `${r.evidence}\n\n## GZMO Response\n\n${r.answer}` : r.answer;
          return {
            content: [{ type: "text", text }],
            details: { via: "api", answer: r.answer, evidence: r.evidence, trace_id: r.trace_id, task_path: r.task_path },
          };
        }
        ctx.ui.notify(`API search error: ${r.error}; falling back to file-based search.`, "warning");
      } else {
        ctx.ui.notify("GZMO API offline; falling back to file-based search.", "warning");
      }

      const { vaultPath } = await resolveVaultPath();
      const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
      const filePath = path.join(inboxDir, mkTaskFilename());
      const fm = makeTaskFrontmatter("search");
      const body = `## Pi context query (api fallback)\n\n${q}\n`;
      await atomicWriteFile(filePath, `${fm}${body}`);
      const finalStatus = await waitForTerminalTaskStatus(filePath, signal, maxSec, 2);
      const md = await fsp.readFile(filePath, "utf8");
      const injected = extractInjectedContext(md);
      await updateUiStatus(ctx);
      if (finalStatus === "failed") {
        return {
          content: [{ type: "text", text: `Search task failed. Excerpt:\n\n${injected}` }],
          details: { via: "file", answer: injected, task_path: filePath },
        };
      }
      return {
        content: [{ type: "text", text: injected }],
        details: { via: "file", answer: injected, task_path: filePath },
      };
    },
    renderCall(args, theme) {
      const q = asNonEmptyString(args.query)?.replace(/\s+/g, " ").slice(0, 56) ?? "";
      return new Text(
        theme.fg("toolTitle", theme.bold("GZMO API search ")) + theme.fg("dim", q) + (q.length >= 56 ? "…" : ""),
        0,
        0,
      );
    },
    renderResult(result, { isPartial, expanded }, theme, _ctx) {
      if (isPartial) return new Text(theme.fg("warning", "🔍 Querying GZMO API…"), 0, 0);
      const d = result.details as { via?: string; answer?: string } | undefined;
      const via = d?.via === "api" ? "API" : "file";
      const txt = d?.answer ?? (result.content[0]?.type === "text" ? result.content[0].text : "");
      const preview = expanded ? txt : txt.split("\n").slice(0, 5).join("\n");
      return new Text(theme.fg("success", `✓ via ${via}\n`) + theme.fg("muted", preview), 0, 0);
    },
  });

  /* ── API: think (submit + poll) ── */

  pi.registerTool({
    name: "gzmo_api_think",
    label: "GZMO API think",
    description:
      "Submit a 'think' task via the GZMO HTTP API and block until the daemon completes it. Falls back to the file-based gzmo_submit_task + gzmo_watch_task flow when the API is offline.",
    promptSnippet: "Submit a GZMO think task via the HTTP API",
    promptGuidelines: [
      "Use gzmo_api_think for one-shot 'think' work that needs the daemon's chaos-modulated parameters and traces.",
      "Falls back to the file-based flow when the API is unreachable, so callers can rely on it unconditionally.",
    ],
    parameters: ApiThinkParams,
    async execute(
      _toolCallId: string,
      params: Static<typeof ApiThinkParams>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ via: "api" | "file"; status: string; output: string; task_id?: string; task_path?: string }>> {
      const body = asNonEmptyString(params.body);
      if (!body) throw new Error("body is required");
      const maxSec = typeof params.max_seconds === "number" ? params.max_seconds : 600;
      const pollSec = typeof params.poll_seconds === "number" ? params.poll_seconds : 2;

      const client = new GzmoApiClient();
      const h = await client.health(800);
      if (h.ok) {
        const sub = await client.submitTask("think", body);
        if (sub.ok) {
          ctx.ui.notify(`GZMO API think submitted (id=${sub.id})`, "info");
          const deadline = Date.now() + maxSec * 1000;
          while (Date.now() < deadline) {
            if (signal?.aborted) throw new Error("Aborted");
            await new Promise((r) => setTimeout(r, Math.max(1, pollSec) * 1000));
            const t = await client.getTask(sub.id);
            if (!t.ok) continue;
            const s = t.data.status;
            if (s === "completed" || s === "failed") {
              await updateUiStatus(ctx);
              const out = t.data.output ?? t.data.body ?? "(no output)";
              return {
                content: [{ type: "text", text: `status: ${s}\n\n${out}` }],
                details: { via: "api", status: s, output: out, task_id: sub.id, task_path: sub.path },
              };
            }
          }
          throw new Error(`API think timed out after ${maxSec}s (task id ${sub.id})`);
        }
        ctx.ui.notify(`API submit error: ${sub.error}; falling back to file-based think.`, "warning");
      } else {
        ctx.ui.notify("GZMO API offline; falling back to file-based think.", "warning");
      }

      const { vaultPath } = await resolveVaultPath();
      const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
      const filePath = path.join(inboxDir, mkTaskFilename());
      const fm = makeTaskFrontmatter("think");
      await atomicWriteFile(filePath, `${fm}${body}\n`);
      const finalStatus = await waitForTerminalTaskStatus(filePath, signal, maxSec, pollSec);
      const excerpt = await tailLines(filePath, 200);
      await updateUiStatus(ctx);
      return {
        content: [{ type: "text", text: `final_status: ${finalStatus}\n\n${excerpt}` }],
        details: { via: "file", status: finalStatus, output: excerpt, task_path: filePath },
      };
    },
    renderCall(args, theme) {
      const tail = asNonEmptyString(args.body)?.replace(/\s+/g, " ").slice(0, 48) ?? "";
      return new Text(
        theme.fg("toolTitle", theme.bold("GZMO API think ")) + theme.fg("dim", `${tail}${tail.length >= 48 ? "…" : ""}`),
        0,
        0,
      );
    },
    renderResult(result, { isPartial, expanded }, theme, _ctx) {
      if (isPartial) return new Text(theme.fg("warning", "💭 GZMO thinking…"), 0, 0);
      const d = result.details as { via?: string; status?: string; output?: string } | undefined;
      const st = d?.status ?? "?";
      const stColor = st === "completed" ? "success" : st === "failed" ? "error" : "muted";
      const out = d?.output ?? "";
      const preview = expanded ? out : out.split("\n").slice(0, 6).join("\n");
      return new Text(theme.fg(stColor, `[${d?.via ?? "?"}] status: ${st}`) + "\n" + theme.fg("dim", preview), 0, 0);
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
        // Critical: null `dashboardRenderer` on close so SSE callbacks don't
        // poke a dead TUI handle (Esc, Ctrl+C, or any other dismissal path).
        component = new GzmoDashboardComponent(state, theme, () => {
          dashboardRenderer = null;
          done();
        });

        dashboardRenderer = {
          requestRender: () => _tui.requestRender(),
          refresh: async () => {
            try {
              const s = await fetchDashboardState();
              state = s;
              component?.setState(s);
              _tui.requestRender();
            } catch {
              /* ignore refresh errors */
            }
          },
        };

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

  pi.registerCommand("gzmo-api-health", {
    description: "Probe the GZMO HTTP API at /api/v1/health and pretty-print the response.",
    handler: async (_args, ctx) => {
      const client = new GzmoApiClient();
      const h = await client.health(2000);
      if (!h.ok) {
        ctx.ui.notify(`GZMO API offline at ${client.baseUrl}: ${h.error}`, "error");
        return;
      }
      const d = h.data;
      const lines = [
        `endpoint: ${client.baseUrl}`,
        `status: ${d.status}`,
        `version: ${d.version}`,
        `model: ${d.model_loaded}`,
        `embedding_model: ${d.embedding_model ?? "?"}`,
        `ollama_connected: ${d.ollama_connected}`,
        `pending: ${d.pending_tasks}`,
        `processing: ${d.processing_tasks}`,
        `uptime_seconds: ${d.uptime_seconds}`,
        d.vault_path ? `vault: ${d.vault_path}` : "",
      ].filter(Boolean);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("gzmo-trace", {
    description: "Display the reasoning trace for a task by partial trace_id. Usage: /gzmo-trace <id-prefix>",
    handler: async (args, ctx) => {
      const raw = typeof args === "string" ? args.trim() : "";
      if (!raw) {
        ctx.ui.notify("Usage: /gzmo-trace <id-prefix>", "warning");
        return;
      }
      const { vaultPath } = await resolveVaultPath();
      const traceDir = path.join(vaultPath, "GZMO", "Reasoning_Traces");
      let entries: string[];
      try {
        entries = await fsp.readdir(traceDir);
      } catch {
        ctx.ui.notify(`No traces directory at ${traceDir}`, "warning");
        return;
      }
      const matches = entries.filter((f) => f.includes(raw) && f.endsWith(".json"));
      if (matches.length === 0) {
        ctx.ui.notify(`No trace matching "${raw}" in ${traceDir}`, "warning");
        return;
      }
      const file = path.join(traceDir, matches[0]!);
      let parsed: any;
      try {
        parsed = JSON.parse(await fsp.readFile(file, "utf8"));
      } catch (e: unknown) {
        ctx.ui.notify(`Failed to parse ${file}: ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }
      const head = [
        `trace_id: ${parsed.trace_id ?? "?"}`,
        `task_file: ${parsed.task_file ?? "?"}`,
        `action: ${parsed.action ?? "?"}`,
        `model: ${parsed.model ?? "?"}`,
        `total_elapsed_ms: ${parsed.total_elapsed_ms ?? "?"}`,
        `status: ${parsed.status ?? "?"}`,
        `nodes: ${Array.isArray(parsed.nodes) ? parsed.nodes.length : "?"}`,
        "── nodes ──",
      ];
      const nodes: any[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      const nodeLines = nodes.slice(0, 40).map((n) => {
        const indent = "  ".repeat(Math.max(0, Number(n.depth ?? 0)));
        return `${indent}[${n.type ?? "?"}] ${(n.prompt_summary ?? "").toString().slice(0, 80)}`;
      });
      ctx.ui.notify([...head, ...nodeLines].join("\n"), "info");
    },
  });

  pi.registerCommand("gzmo-model", {
    description: "List Ollama models available locally and notify which one is the active GZMO model.",
    handler: async (_args, ctx) => {
      const ollamaUrl = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/v1\/?$/, "");
      let names: string[] = [];
      try {
        const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (!r.ok) {
          ctx.ui.notify(`Ollama unreachable at ${ollamaUrl}: HTTP ${r.status}`, "error");
          return;
        }
        const data = (await r.json()) as { models?: Array<{ name?: string }> };
        names = (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
      } catch (e: unknown) {
        ctx.ui.notify(`Ollama unreachable at ${ollamaUrl}: ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }
      const active = process.env.OLLAMA_MODEL ?? "(unset)";
      const lines = [
        `Ollama: ${ollamaUrl}`,
        `Active GZMO model (OLLAMA_MODEL): ${active}`,
        "── installed ──",
        ...names.map((n) => (n === active ? `* ${n}` : `  ${n}`)),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // Notify-only by design. We deliberately don't spawn the daemon from here:
  // it would hold an orphan child process tied to the pi session lifecycle and
  // double-fork around systemd, which is a known footgun.
  pi.registerCommand("gzmo-start", {
    description: "Show the shell command to start the GZMO daemon (user must run it in a separate terminal).",
    handler: async (_args, ctx) => {
      // extension lives at <repo>/.pi/extensions/gzmo-tinyfolder.ts
      const repoRoot = path.resolve(extensionDir, "..", "..");
      const daemonDir = path.join(repoRoot, "gzmo-daemon");
      if (!(await fileExists(path.join(daemonDir, "package.json")))) {
        ctx.ui.notify("Could not locate gzmo-daemon/ relative to the extension. Start it manually.", "warning");
        return;
      }

      let profile = "core";
      try {
        const envFile = await walkForEnv(process.cwd());
        if (envFile) {
          const parsed = await parseDotEnvFile(envFile);
          profile = asNonEmptyString(parsed["GZMO_PROFILE"]) ?? "core";
        }
      } catch { /* ignore — fall back to "core" */ }

      const cmd = `cd ${daemonDir} && GZMO_PROFILE=${profile} bun run summon`;
      ctx.ui.notify(
        `To start the GZMO daemon, run the following command in a separate terminal:\n\n${cmd}\n\n` +
          "Once started, the extension will auto-detect the API within a few seconds. " +
          "Press 'r' inside /gzmo to force a refresh.",
        "info",
      );
    },
  });

  pi.registerCommand("gzmo-stop", {
    description: "Show instructions to stop the GZMO daemon.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "To stop the GZMO daemon:\n" +
          "  systemctl --user stop gzmo-daemon   (if you installed the systemd user unit)\n" +
          "  or press Ctrl+C in the terminal running `bun run summon`",
        "info",
      );
    },
  });
}
