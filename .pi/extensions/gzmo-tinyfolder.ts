import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

type GzmoAction = "think" | "search" | "chain";

type ExtensionAPI = {
  on?: (event: string, handler: (...args: any[]) => void) => void;
  registerTool?: (tool: {
    name: string;
    description: string;
    parameters?: any;
    execute: (args: any, ctx?: any) => Promise<any> | any;
  }) => void;
  registerCommand?: (cmd: {
    name: string;
    description?: string;
    handler: (args: any, ctx?: any) => Promise<any> | any;
  }) => void;
  ui?: {
    setStatus?: (s: string) => void;
    setWidget?: (id: string, content: string) => void;
    notify?: (s: string) => void;
    confirm?: (opts: { title?: string; message: string }) => Promise<boolean> | boolean;
    openFile?: (filePath: string) => Promise<void> | void;
  };
  cwd?: () => string;
};

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
  // Walk upwards; at each level prefer .env then gzmo-daemon/.env
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

async function resolveVaultPath(api: ExtensionAPI): Promise<{ vaultPath: string; envFile?: string }> {
  // Order: GZMO_ENV_FILE → VAULT_PATH env → walk from cwd
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

  const cwd = api.cwd?.() ?? process.cwd();
  const walked = await walkForEnv(cwd);
  if (!walked) {
    throw new Error(
      "No .env found. Set GZMO_ENV_FILE=/path/to/gzmo-daemon/.env or set VAULT_PATH, or run Pi from within the tinyFolder repo tree."
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

async function updateUiStatus(api: ExtensionAPI): Promise<void> {
  if (!api.ui?.setStatus && !api.ui?.setWidget) return;
  try {
    const { vaultPath } = await resolveVaultPath(api);
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
    const status = `GZMO: ${pending} pending, ${processing} processing | vault: ${vaultName}`;
    api.ui?.setStatus?.(status);
    api.ui?.setWidget?.("gzmo", status);
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    api.ui?.setStatus?.(`GZMO: env missing (${msg})`);
  }
}

export default function gzmoTinyFolderExtension(api: ExtensionAPI) {
  if (!api?.registerTool) {
    throw new Error("Pi API missing registerTool(). This extension requires Pi tool registration support.");
  }

  async function listLastTasks(limit: number) {
    const { vaultPath } = await resolveVaultPath(api);
    const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
    const tasks: Array<{ path: string; status: string | null; updated_at: string; action?: string | null }> = [];
    if (await fileExists(inboxDir)) {
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
          tasks.push({ path: p, status, action, updated_at: st.mtime.toISOString() });
        } catch {
          // ignore
        }
      }
    }
    tasks.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return { tasks: tasks.slice(0, Math.max(1, Math.min(200, limit))) };
  }

  api.on?.("session_start", () => {
    void updateUiStatus(api);
  });

  api.registerTool({
    name: "gzmo_submit_task",
    description:
      "Create a tinyFolder/GZMO Inbox task file under VAULT_PATH/GZMO/Inbox with correct frontmatter (status/action).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action", "body"],
      properties: {
        action: { type: "string", enum: ["think", "search", "chain"] },
        body: { type: "string", description: "Markdown body of the task" },
        chain_next: { type: ["string", "null"], default: null },
      },
    },
    execute: async (args: any) => {
      const action = args?.action as GzmoAction;
      const body = asNonEmptyString(args?.body);
      const chainNext = args?.chain_next ?? null;
      if (!body) throw new Error("body is required");
      if (action !== "think" && action !== "search" && action !== "chain") throw new Error(`Invalid action: ${action}`);

      const { vaultPath } = await resolveVaultPath(api);
      const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
      const filePath = path.join(inboxDir, mkTaskFilename());
      const fm = makeTaskFrontmatter(action, chainNext ?? undefined);
      await atomicWriteFile(filePath, `${fm}${body}\n`);
      api.ui?.notify?.(`GZMO task submitted: ${filePath}`);
      await updateUiStatus(api);
      return { task_path: filePath };
    },
  });

  api.registerTool({
    name: "gzmo_read_task",
    description: "Read a GZMO task file, returning status/frontmatter plus a small tail excerpt.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task_path"],
      properties: {
        task_path: { type: "string" },
        tail_lines: { type: "integer", default: 60, minimum: 10, maximum: 400 },
      },
    },
    execute: async (args: any) => {
      const taskPath = asNonEmptyString(args?.task_path);
      const tailN = typeof args?.tail_lines === "number" ? args.tail_lines : 60;
      if (!taskPath) throw new Error("task_path is required");
      const md = await fsp.readFile(taskPath, "utf8");
      const { frontmatter } = parseFrontmatter(md);
      const status = asNonEmptyString(frontmatter["status"]);
      const tail = await tailLines(taskPath, Math.max(10, Math.min(400, tailN)));
      await updateUiStatus(api);
      return { status, frontmatter, tail };
    },
  });

  api.registerTool({
    name: "gzmo_watch_task",
    description: "Poll a task file until status is completed or failed (or timeout). Returns a compact excerpt.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task_path"],
      properties: {
        task_path: { type: "string" },
        max_seconds: { type: "integer", default: 600, minimum: 5, maximum: 86400 },
        poll_seconds: { type: "integer", default: 2, minimum: 1, maximum: 30 },
        tail_lines: { type: "integer", default: 120, minimum: 10, maximum: 600 },
      },
    },
    execute: async (args: any) => {
      const taskPath = asNonEmptyString(args?.task_path);
      if (!taskPath) throw new Error("task_path is required");
      const maxSec = typeof args?.max_seconds === "number" ? args.max_seconds : 600;
      const pollSec = typeof args?.poll_seconds === "number" ? args.poll_seconds : 2;
      const tailN = typeof args?.tail_lines === "number" ? args.tail_lines : 120;

      const started = Date.now();
      let lastStatus: string | null = null;
      while ((Date.now() - started) / 1000 < maxSec) {
        const status = await readTaskStatus(taskPath);
        lastStatus = status;
        if (status === "completed" || status === "failed") {
          const excerpt = await tailLines(taskPath, Math.max(10, Math.min(600, tailN)));
          await updateUiStatus(api);
          return { final_status: status, excerpt };
        }
        await new Promise((r) => setTimeout(r, Math.max(1, pollSec) * 1000));
      }
      await updateUiStatus(api);
      throw new Error(`Timeout after ${maxSec}s waiting for completed|failed (last status: ${lastStatus ?? "unknown"})`);
    },
  });

  api.registerTool({
    name: "gzmo_list_tasks",
    description: "List tasks in VAULT_PATH/GZMO/Inbox with statuses, newest first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: ["string", "null"], default: null },
        limit: { type: "integer", default: 20, minimum: 1, maximum: 200 },
      },
    },
    execute: async (args: any) => {
      const desiredStatus = asNonEmptyString(args?.status ?? "") ?? null;
      const limit = typeof args?.limit === "number" ? args.limit : 20;
      const { vaultPath } = await resolveVaultPath(api);
      const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
      const tasks: Array<{ path: string; status: string | null; updated_at: string; action?: string | null }> = [];
      if (!(await fileExists(inboxDir))) return { tasks: [] };
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
          if (desiredStatus && status !== desiredStatus) continue;
          tasks.push({ path: p, status, action, updated_at: st.mtime.toISOString() });
        } catch {
          // ignore
        }
      }
      tasks.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      await updateUiStatus(api);
      return { tasks: tasks.slice(0, Math.max(1, Math.min(200, limit))) };
    },
  });

  api.registerTool({
    name: "gzmo_last_tasks",
    description: "Convenience wrapper: list last N tasks (newest first).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", default: 10, minimum: 1, maximum: 200 },
      },
    },
    execute: async (args: any) => {
      const limit = typeof args?.limit === "number" ? args.limit : 10;
      await updateUiStatus(api);
      return await listLastTasks(limit);
    },
  });

  api.registerTool({
    name: "gzmo_open_task",
    description: "Best-effort open a task file in the editor; falls back to returning the path.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["task_path"],
      properties: {
        task_path: { type: "string" },
      },
    },
    execute: async (args: any) => {
      const taskPath = asNonEmptyString(args?.task_path);
      if (!taskPath) throw new Error("task_path is required");
      if (api.ui?.openFile) {
        await api.ui.openFile(taskPath);
        return { opened: true };
      }
      return { opened: false, task_path: taskPath };
    },
  });

  // Human-invoked commands (if supported)
  api.registerCommand?.({
    name: "/gzmo-last",
    description: "Show last N GZMO tasks (newest first). Usage: /gzmo-last 10",
    handler: async (args: any) => {
      const n = typeof args?.[0] === "number" ? args[0] : parseInt(String(args?.[0] ?? "10"), 10);
      const limit = Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : 10;
      const res = await listLastTasks(limit);
      const lines = res.tasks.map((t) => `- ${t.status ?? "?"} ${t.action ?? "?"}  ${t.path}`);
      api.ui?.notify?.(lines.join("\n"));
      await updateUiStatus(api);
      return res;
    },
  });

  // Initialize UI once on load as well.
  void updateUiStatus(api);
}

