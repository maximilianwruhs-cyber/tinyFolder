import matter from "gray-matter";
import { basename, dirname, extname, relative, resolve } from "path";
import { existsSync } from "fs";
import { safeWriteText } from "./vault_fs";

export type WikiType = "entity" | "concept" | "topic" | "research" | "session" | "source-summary" | "dream" | "index" | "log" | "map" | "skill" | "overview";

export interface WikiFrontmatter {
  title: string;
  type: WikiType;
  tags: string[];
  sources: number;
  created: string; // YYYY-MM-DD
  updated: string; // YYYY-MM-DD
  [key: string]: unknown;
}

export interface NormalizedWikiPage {
  frontmatter: WikiFrontmatter;
  markdown: string; // full file content (frontmatter + body)
  fileBaseName: string; // filename without extension (for wikilinks)
}

function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function firstH1(body: string): string | null {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  return m?.[1]?.trim() ?? null;
}

function normalizeTags(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(String).map(s => s.trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    // Allow "a, b, c" or "a b c" style.
    return v
      .split(/[,]/g)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSources(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function typeFromWikiPath(wikiFileAbs: string, vaultPath: string): WikiType {
  const rel = relative(resolve(vaultPath), resolve(wikiFileAbs)).replace(/\\/g, "/");
  // Expected: wiki/<bucket>/...
  if (!rel.startsWith("wiki/")) return "topic";
  const parts = rel.split("/");
  const bucket = parts[1] ?? "";
  switch (bucket) {
    case "entities": return "entity";
    case "concepts": return "concept";
    case "topics": return "topic";
    case "research": return "research";
    case "sessions": return "session";
    case "skills": return "skill";
    case "sources": return "source-summary";
    case "dreams": return "dream";
    default:
      // repo currently uses extra buckets like research/sessions; treat them as topics
      return "topic";
  }
}

/**
 * Detect HTML tags outside fenced code blocks.
 * Schema says "No HTML" — we enforce this as a hard validation error.
 */
export function containsHtmlOutsideCodeFences(markdown: string): boolean {
  const lines = markdown.split("\n");
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/<[a-zA-Z][^>]*>/.test(line)) return true;
  }
  return false;
}

export function normalizeWikiMarkdown(params: {
  vaultPath: string;
  wikiFileAbs: string;
  rawMarkdown: string;
  now?: Date;
  existingMarkdown?: string | null;
}): NormalizedWikiPage {
  const now = params.now ?? new Date();
  const fileBaseName = basename(params.wikiFileAbs, extname(params.wikiFileAbs));

  const parsed = matter(params.rawMarkdown ?? "");
  const body = (parsed.content ?? "").trim();
  const existing = params.existingMarkdown ? matter(params.existingMarkdown) : null;

  const inferredTitle = firstH1(body) ?? fileBaseName.replace(/[_-]+/g, " ").trim();
  const existingCreated = existing?.data?.created ? String(existing.data.created) : undefined;

  const type = typeFromWikiPath(params.wikiFileAbs, params.vaultPath);
  const tags = normalizeTags(parsed.data?.tags);
  const sources = normalizeSources(parsed.data?.sources ?? parsed.data?.source_count);

  const fm: WikiFrontmatter = {
    title: String(parsed.data?.title ?? inferredTitle),
    type,
    tags,
    sources,
    created: existingCreated ?? String(parsed.data?.created ?? isoDate(now)),
    updated: isoDate(now),
  };

  // Enforce "no HTML" at the contract boundary.
  if (containsHtmlOutsideCodeFences(body)) {
    throw new Error(`Wiki contract violation: HTML detected in ${fileBaseName}`);
  }

  // Ensure there is an H1 matching title (helps humans + keeps title stable).
  let normalizedBody = body;
  const h1 = firstH1(body);
  if (!h1) {
    normalizedBody = `# ${fm.title}\n\n${body}`.trim() + "\n";
  }

  // Write out only our canonical frontmatter keys (+ keep other keys? no: supreme means canonical)
  const markdown = matter.stringify(normalizedBody.trimEnd() + "\n", fm);

  return { frontmatter: fm, markdown, fileBaseName };
}

/**
 * Write a wiki page with schema compliance.
 * - Normalizes frontmatter and rejects HTML.
 * - Preserves `created` if file exists.
 */
export async function writeSchemaCompliantWikiPage(params: {
  vaultPath: string;
  wikiFileAbs: string;
  rawMarkdown: string;
  now?: Date;
}): Promise<NormalizedWikiPage> {
  const existing = existsSync(params.wikiFileAbs)
    ? await Bun.file(params.wikiFileAbs).text().catch(() => null)
    : null;

  const normalized = normalizeWikiMarkdown({
    vaultPath: params.vaultPath,
    wikiFileAbs: params.wikiFileAbs,
    rawMarkdown: params.rawMarkdown,
    existingMarkdown: existing,
    now: params.now,
  });

  await safeWriteText(params.vaultPath, params.wikiFileAbs, normalized.markdown);
  return normalized;
}

