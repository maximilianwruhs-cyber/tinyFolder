import { join, relative, resolve, basename, extname } from "path";
import { promises as fsp } from "fs";
import matter from "gray-matter";
import { atomicWriteText } from "./vault_fs";
import { appendWikiLogEntry } from "./wiki_log";
import { writeSchemaCompliantWikiPage } from "./wiki_contract";
import { rebuildWikiIndex } from "./wiki_index";

export interface WikiLintFinding {
  kind: "missing_frontmatter" | "invalid_frontmatter" | "broken_link" | "orphan" | "stale";
  page: string; // wiki relative path
  details: string;
}

export interface WikiLintReport {
  generatedAt: string;
  wikiPages: number;
  findings: WikiLintFinding[];
  autoFix?: {
    enabled: boolean;
    normalizedPages: number;
    indexRebuilt: boolean;
  };
}

function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function walkMdFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}

export function extractWikiLinks(markdown: string): string[] {
  // basic Obsidian wikilink capture: [[Page]] or [[Page|alias]]
  const links: string[] = [];
  const re = /\[\[([^[\]]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const raw = m[1] ?? "";
    const target = raw.split("|")[0]!.trim();
    if (!target) continue;
    // Skip external style/anchors like [[Page#Section]] -> keep page part
    const page = target.split("#")[0]!.trim();
    if (!page) continue;
    links.push(page);
  }
  return links;
}

function requiredFrontmatterOk(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(data, k);
  return has("title") && has("type") && has("tags") && has("sources") && has("created") && has("updated");
}

function parseDateMaybe(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(v + "T00:00:00Z");
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

export async function runWikiLint(vaultPath: string, opts?: { staleDays?: number }): Promise<WikiLintReport> {
  const staleDays = opts?.staleDays ?? 30;
  const wikiRoot = join(vaultPath, "wiki");
  const files = await walkMdFiles(wikiRoot);

  const findings: WikiLintFinding[] = [];
  const autoFixEnabled = process.env.WIKI_LINT_AUTOFIX === "1";
  let normalizedPages = 0;
  let indexRebuilt = false;

  // Some files under /wiki are "artifacts" (indexes/logs) or raw sources and
  // should not be forced to comply with the strict wiki page contract.
  const contractExemptBases = new Set(["index", "log", "overview"]);
  const isContractExempt = (rel: string, base: string) =>
    contractExemptBases.has(base.toLowerCase()) || rel.startsWith("wiki/sources/");

  // Map page basename -> relpath (first wins)
  const pageByBase = new Map<string, string>();
  const allPages: Array<{ abs: string; rel: string; base: string; content: string; data: any }> = [];

  for (const abs of files) {
    const rel = relative(resolve(vaultPath), resolve(abs)).replace(/\\/g, "/");
    const base = basename(abs, extname(abs));
    let content = "";
    try {
      content = await Bun.file(abs).text();
    } catch {
      continue;
    }
    const parsed = matter(content);
    const data = parsed.data;
    allPages.push({ abs, rel, base, content, data });
    if (!pageByBase.has(base)) pageByBase.set(base, rel);

    // Frontmatter checks
    if (!isContractExempt(rel, base)) {
      if (!String(content).trimStart().startsWith("---")) {
        findings.push({ kind: "missing_frontmatter", page: rel, details: "No YAML frontmatter block found." });
      } else if (!requiredFrontmatterOk(data)) {
        findings.push({ kind: "invalid_frontmatter", page: rel, details: "Missing required keys (title/type/tags/sources/created/updated)." });
      }
    }

    // Stale checks
    const updatedTs = parseDateMaybe(data?.updated);
    if (updatedTs) {
      const ageDays = (Date.now() - updatedTs) / (1000 * 60 * 60 * 24);
      if (ageDays > staleDays) {
        findings.push({ kind: "stale", page: rel, details: `updated=${String(data.updated)} (> ${staleDays} days)` });
      }
    }
  }

  // Link graph: inbound counts + broken links
  const inbound = new Map<string, number>(); // base -> count
  for (const p of allPages) inbound.set(p.base, 0);

  for (const p of allPages) {
    const enforceLinkValidity = !isContractExempt(p.rel, p.base);
    const links = extractWikiLinks(p.content);
    for (const target of links) {
      // Only treat links that are intended as wiki pages (not raw paths, not http)
      if (target.includes("/") || target.startsWith("http")) continue;
      // Treat file-ish / non-page wikilinks as informational (e.g. [[WIKI.md]])
      if (target.includes(".")) continue;
      const targetBase = target;
      if (!pageByBase.has(targetBase)) {
        if (enforceLinkValidity) {
          findings.push({ kind: "broken_link", page: p.rel, details: `[[${targetBase}]] not found in wiki/` });
        }
      } else {
        inbound.set(targetBase, (inbound.get(targetBase) ?? 0) + 1);
      }
    }
  }

  // Orphans: exclude index/log/overview by filename
  for (const p of allPages) {
    if (contractExemptBases.has(p.base.toLowerCase())) continue;
    const inCount = inbound.get(p.base) ?? 0;
    if (inCount === 0) {
      findings.push({ kind: "orphan", page: p.rel, details: "No inbound wikilinks from other wiki pages." });
    }
  }

  const report: WikiLintReport = {
    generatedAt: new Date().toISOString(),
    wikiPages: allPages.length,
    findings,
    autoFix: {
      enabled: autoFixEnabled,
      normalizedPages: 0,
      indexRebuilt: false,
    },
  };

  // Optional safe autofix (opt-in):
  // - normalize wiki frontmatter + ensure H1 exists
  // - rebuild wiki/index.md (deterministic)
  if (autoFixEnabled) {
    for (const p of allPages) {
      try {
        const normalized = await writeSchemaCompliantWikiPage({
          vaultPath,
          wikiFileAbs: p.abs,
          rawMarkdown: p.content,
        });
        // Count as "normalized" if content changed
        if (normalized.markdown !== p.content) normalizedPages++;
      } catch {
        // fail closed: skip any page we can't normalize
      }
    }
    try {
      await rebuildWikiIndex(vaultPath);
      indexRebuilt = true;
    } catch {
      indexRebuilt = false;
    }
    report.autoFix = {
      enabled: true,
      normalizedPages,
      indexRebuilt,
    };
  }

  // Write a report into GZMO/ for inspection (deterministic file name).
  const reportPath = join(vaultPath, "GZMO", "wiki-lint-report.md");
  const lines: string[] = [];
  lines.push("# Wiki Lint Report", "");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Pages scanned: ${report.wikiPages}`);
  lines.push(`- Findings: ${report.findings.length}`, "");
  if (report.autoFix?.enabled) {
    lines.push(`- Autofix: enabled (normalizedPages=${report.autoFix.normalizedPages}, indexRebuilt=${report.autoFix.indexRebuilt})`, "");
  } else {
    lines.push(`- Autofix: disabled`, "");
  }

  const byKind = new Map<string, WikiLintFinding[]>();
  for (const f of report.findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind)!.push(f);
  }

  for (const [kind, items] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${kind}`, "");
    for (const it of items.slice(0, 100)) {
      lines.push(`- \`${it.page}\`: ${it.details}`);
    }
    if (items.length > 100) lines.push(`- *(+${items.length - 100} more)*`);
    lines.push("");
  }

  await atomicWriteText(vaultPath, reportPath, lines.join("\n"));

  // Append to wiki log (parseable)
  await appendWikiLogEntry({
    vaultPath,
    operation: "lint",
    title: "Wiki health check",
    summary: `${report.findings.length} findings across ${report.wikiPages} pages (report: \`GZMO/wiki-lint-report.md\`).` +
      (report.autoFix?.enabled ? ` Autofix: normalized=${report.autoFix.normalizedPages}, indexRebuilt=${report.autoFix.indexRebuilt}.` : ""),
    pagesTouched: ["`GZMO/wiki-lint-report.md`"],
    contradictions: report.findings.length === 0 ? "none" : "see report",
  }).catch(() => {});

  return report;
}

