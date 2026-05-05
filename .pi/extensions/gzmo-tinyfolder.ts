import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";

type GzmoAction = "think" | "search" | "chain";

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
  // Walk upwards; at each level prefer .env then gzmo-daemon/.env.
  // Mirrors contrib/pi-gzmo-skill/scripts/resolve_env.sh behavior.
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
  // Order: GZMO_ENV_FILE → VAULT_PATH env → walk from cwd.
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
  const s = asNonEmptyString(frontmatter["status"]);
  return s;
}

async function tailLines(filePath: string, maxLines: number): Promise<string> {
  const md = await fsp.readFile(filePath, "utf8");
  const lines = md.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
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
    ctx.ui.setWidget("gzmo", [summary, `vault: ${vaultName}`]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.setStatus("gzmo", `GZMO: env missing (${msg})`);
    ctx.ui.setWidget("gzmo", [`GZMO: env missing`, msg]);
  }
}

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

export default function gzmoTinyFolderExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await updateUiStatus(ctx);
  });

  pi.registerTool({
    name: "gzmo_submit_task",
    label: "GZMO submit",
    description:
      "Create a tinyFolder/GZMO Inbox task file under VAULT_PATH/GZMO/Inbox with correct frontmatter (status/action).",
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
      ctx.ui.notify(`GZMO task submitted: ${filePath}`, "info");
      await updateUiStatus(ctx);
      return {
        content: [{ type: "text", text: filePath }],
        details: { task_path: filePath },
      };
    },
  });

  pi.registerTool({
    name: "gzmo_read_task",
    label: "GZMO read",
    description: "Read a GZMO task file, returning status/frontmatter plus a small tail excerpt.",
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
  });

  pi.registerTool({
    name: "gzmo_watch_task",
    label: "GZMO watch",
    description: "Poll a task file until status is completed or failed (or timeout). Returns a compact excerpt.",
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

      const started = Date.now();
      let lastStatus: string | null = null;
      while ((Date.now() - started) / 1000 < maxSec) {
        if (signal?.aborted) throw new Error("Aborted");
        const status = await readTaskStatus(taskPath);
        lastStatus = status;
        if (status === "completed" || status === "failed") {
          const excerpt = await tailLines(taskPath, Math.max(10, Math.min(600, tailN)));
          await updateUiStatus(ctx);
          return {
            content: [{ type: "text", text: `final_status: ${status}\n\n${excerpt}` }],
            details: { final_status: status, excerpt },
          };
        }
        await new Promise((r) => setTimeout(r, Math.max(1, pollSec) * 1000));
      }
      await updateUiStatus(ctx);
      throw new Error(`Timeout after ${maxSec}s waiting for completed|failed (last status: ${lastStatus ?? "unknown"})`);
    },
  });

  pi.registerTool({
    name: "gzmo_list_tasks",
    label: "GZMO list",
    description: "List tasks in VAULT_PATH/GZMO/Inbox with statuses, newest first.",
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
  });

  pi.registerTool({
    name: "gzmo_last_tasks",
    label: "GZMO last",
    description: "Convenience wrapper: list last N tasks (newest first).",
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
  });

  pi.registerTool({
    name: "gzmo_health",
    label: "GZMO health",
    description: "Read the latest daemon health report from VAULT_PATH/GZMO/health.md.",
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
