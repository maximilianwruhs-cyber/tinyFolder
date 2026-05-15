import { promises as fsp } from "fs";
import { join } from "path";
import matter from "./yaml_frontmatter";

function wsMode(): "off" | "cabinet" | "cabinet_wiki" {
  const v = (process.env.GZMO_MEMORY_WORKING_SET ?? "off").trim().toLowerCase();
  if (v === "cabinet" || v === "cabinet_wiki") return v;
  return "off";
}

function wsMaxFiles(): number {
  const raw = Number.parseInt(process.env.GZMO_MEMORY_WORKING_SET_MAX_FILES ?? "4", 10);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(16, raw));
}

function charsPerSnippet(): number {
  const raw = Number.parseInt(process.env.GZMO_MEMORY_WORKING_SET_CHARS_PER_FILE ?? "400", 10);
  if (!Number.isFinite(raw)) return 400;
  return Math.max(80, Math.min(2000, raw));
}

async function statMtime(vaultRoot: string, rel: string): Promise<{ rel: string; mtime: number } | null> {
  try {
    const abs = join(vaultRoot, ...rel.split("/"));
    const st = await fsp.stat(abs);
    if (!st.isFile()) return null;
    return { rel, mtime: st.mtimeMs };
  } catch {
    return null;
  }
}

async function listMdRecursive(absDir: string, relPrefix: string): Promise<string[]> {
  const out: string[] = [];
  let dirents: Array<{ name: string; isDir: boolean; isFile: boolean }> = [];
  try {
    const raw = await fsp.readdir(absDir, { withFileTypes: true });
    dirents = raw.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      isFile: e.isFile(),
    }));
  } catch {
    return out;
  }

  for (const e of dirents) {
    if (e.name.startsWith(".")) continue;
    if (e.name === "_archive") continue;
    const relChild = `${relPrefix}/${e.name}`;
    const full = join(absDir, e.name);
    if (e.isDir) {
      const sub = await listMdRecursive(full, relChild);
      out.push(...sub);
    } else if (e.isFile && e.name.endsWith(".md")) {
      out.push(relChild.replace(/\\/g, "/"));
    }
  }
  return out;
}

function stripFmBody(raw: string, maxChars: number): string {
  try {
    const { content } = matter(raw);
    const t = String(content ?? "").replace(/\s+/g, " ").trim();
    return t.length <= maxChars ? t : `${t.slice(0, maxChars)}…`;
  } catch {
    const t = raw.replace(/\s+/g, " ").trim();
    return t.length <= maxChars ? t : `${t.slice(0, maxChars)}…`;
  }
}

/**
 * Bounded recency snippets from Thought Cabinet and optionally wiki/.
 */
export async function formatMemoryWorkingSet(vaultRoot: string): Promise<string> {
  const mode = wsMode();
  if (mode === "off") return "";

  const maxFiles = wsMaxFiles();
  const snippetChars = charsPerSnippet();
  const rels: string[] = [];

  const cabAbs = join(vaultRoot, "GZMO", "Thought_Cabinet");
  rels.push(...(await listMdRecursive(cabAbs, "GZMO/Thought_Cabinet")));

  if (mode === "cabinet_wiki") {
    const wikiAbs = join(vaultRoot, "wiki");
    rels.push(...(await listMdRecursive(wikiAbs, "wiki")));
  }

  const withM = (await Promise.all(rels.map((rel) => statMtime(vaultRoot, rel)))).filter(
    Boolean,
  ) as { rel: string; mtime: number }[];

  withM.sort((a, b) => b.mtime - a.mtime);
  const picked = withM.slice(0, maxFiles);
  if (picked.length === 0) return "";

  const chunks: string[] = [];
  for (const { rel } of picked) {
    try {
      const txt = await fsp.readFile(join(vaultRoot, ...rel.split("/")), "utf8");
      const clip = stripFmBody(txt, snippetChars);
      if (clip.length > 0) chunks.push(`- **${rel}**: ${clip}`);
    } catch {
      continue;
    }
  }
  if (chunks.length === 0) return "";

  return `\nWorking set (recency excerpts; \`GZMO_MEMORY_WORKING_SET\`):\n${chunks.join("\n")}`;
}
