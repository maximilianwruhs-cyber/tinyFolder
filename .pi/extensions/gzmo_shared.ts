/**
 * gzmo_shared.ts — pure helpers shared by the entry, the API client, and the
 * dashboard. Importing only here (not from the entry) lets the dashboard +
 * api_client modules avoid circular references with the default-export entry.
 *
 * Behavior is bit-for-bit identical to the helpers that previously lived
 * inline in `gzmo-tinyfolder.ts`; only the file location changes.
 *
 * No `pi-coding-agent` / `pi-tui` imports allowed in this file — keep it
 * dependency-light.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type GzmoAction = "think" | "search" | "chain";

export function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function isAbsPosixOrNative(p: string): boolean {
  return path.isAbsolute(p);
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function parseDotEnvFile(envFile: string): Promise<Record<string, string>> {
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

export async function walkForEnv(startDir: string): Promise<string | null> {
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

export async function resolveVaultPath(): Promise<{ vaultPath: string; envFile?: string }> {
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

export function makeTaskFrontmatter(action: GzmoAction, chainNext?: string): string {
  if (action === "chain") {
    const cn = asNonEmptyString(chainNext);
    if (!cn) throw new Error("chain_next is required when action=chain");
    return `---\nstatus: pending\naction: chain\nchain_next: ${cn}\n---\n`;
  }
  return `---\nstatus: pending\naction: ${action}\n---\n`;
}

export function parseFrontmatter(md: string): { frontmatter: Record<string, string>; body: string } {
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

export async function readTaskStatus(taskPath: string): Promise<string | null> {
  const md = await fsp.readFile(taskPath, "utf8");
  const { frontmatter } = parseFrontmatter(md);
  return asNonEmptyString(frontmatter["status"]);
}

export async function tailLines(filePath: string, maxLines: number): Promise<string> {
  const md = await fsp.readFile(filePath, "utf8");
  const lines = md.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

export function tailLineArray(fileText: string, maxLines: number): string[] {
  const lines = fileText.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines));
}

export function extractInjectedContext(markdown: string): string {
  const { body } = parseFrontmatter(markdown);
  const b = body.trimStart();
  const evIdx = b.indexOf("## Evidence Packet");
  if (evIdx >= 0) return b.slice(evIdx).trim();
  const respIdx = b.indexOf("## GZMO Response");
  if (respIdx >= 0) return b.slice(respIdx).trim();
  return b.trim();
}

export type TaskRow = { path: string; status: string | null; updated_at: string; action: string | null };

export async function listInbox(filterStatus?: string | null, limit = 20): Promise<TaskRow[]> {
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

/** Re-export node modules for downstream files that used to share them. */
export { fs, fsp, path };
