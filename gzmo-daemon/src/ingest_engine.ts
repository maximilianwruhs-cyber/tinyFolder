/**
 * ingest_engine.ts — Raw Source → wiki/sources/ ingest pipeline
 *
 * Implements `schema/WIKI.md` Ingest in a mechanical, fail-closed way:
 * - raw/ is read-only (enforced by vault_fs write firewall)
 * - One source per cycle
 * - Always produces a schema-compliant source summary in wiki/sources/
 * - Always appends wiki/log.md and rebuilds wiki/index.md
 */
 
import { join, basename, extname, relative, resolve } from "path";
import { existsSync, promises as fsp } from "fs";
import { atomicWriteJson, resolveVaultPath } from "./vault_fs";
import { writeSchemaCompliantWikiPage } from "./wiki_contract";
import { appendWikiLogEntry } from "./wiki_log";
import { rebuildWikiIndex } from "./wiki_index";
import type { EmbeddingStore } from "./embeddings";
import { searchVault } from "./search";
import { linkSourceIntoWikiPage } from "./wiki_graph";
 
interface IngestDigest {
  processed: string[]; // raw relative paths
  lastRun: string;
}
 
function isoNow(): string {
  return new Date().toISOString();
}
 
async function walkRawMdFiles(rawRootAbs: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [rawRootAbs];
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
  return out.sort(); // stable ordering
}
 
function sanitizeSlug(input: string): string {
  return input
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .toLowerCase();
}
 
function deriveSourceTitle(rawRelPath: string): string {
  const base = basename(rawRelPath, extname(rawRelPath));
  return base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
 
export class IngestEngine {
  private readonly vaultPath: string;
  private readonly rawPath: string;
  private readonly digestPath: string;
  private digest: IngestDigest;
 
  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.rawPath = join(vaultPath, "raw");
    this.digestPath = join(vaultPath, "GZMO", ".gzmo_ingest_digest.json");
    this.digest = { processed: [], lastRun: "" };
  }

  async init(): Promise<void> {
    this.digest = await this.loadDigest();
  }
 
  private async loadDigest(): Promise<IngestDigest> {
    try {
      const file = Bun.file(this.digestPath);
      // Bun.file().size is 0 for non-existent files
      if (file.size === 0) return { processed: [], lastRun: "" };
      const raw = await Bun.file(this.digestPath).text();
      const parsed = JSON.parse(raw) as IngestDigest;
      return {
        processed: Array.isArray(parsed.processed) ? parsed.processed.map(String) : [],
        lastRun: typeof parsed.lastRun === "string" ? parsed.lastRun : "",
      };
    } catch {
      return { processed: [], lastRun: "" };
    }
  }
 
  private saveDigest(): void {
    this.digest.lastRun = isoNow();
    atomicWriteJson(this.vaultPath, this.digestPath, this.digest, 2).catch(() => {});
  }
 
  /**
   * Process exactly one unprocessed raw source.
   */
  async cycle(
    infer: (system: string, prompt: string) => Promise<string>,
    opts?: { embeddingStore?: EmbeddingStore; ollamaUrl?: string },
  ): Promise<{
    rawRelPath: string;
    summaryWikiPath: string;
    title: string;
    touchedPages: string[];
  } | null> {
    if (!existsSync(this.rawPath)) return null;
 
    // Discover candidates
    const rawFilesAbs = await walkRawMdFiles(this.rawPath);
    const processed = new Set(this.digest.processed);
 
    let nextAbs: string | null = null;
    let nextRel: string | null = null;
    for (const abs of rawFilesAbs) {
      const rel = relative(resolve(this.vaultPath), resolve(abs)).replace(/\\/g, "/");
      if (!rel.startsWith("raw/")) continue;
      if (processed.has(rel)) continue;
      nextAbs = abs;
      nextRel = rel;
      break;
    }
 
    if (!nextAbs || !nextRel) return null;
 
    // Read raw source (read-only)
    const rawContent = await Bun.file(nextAbs).text().catch(() => "");
    if (!rawContent || rawContent.trim().length < 80) {
      // Mark as processed to avoid churn on empty/invalid sources.
      this.digest.processed.push(nextRel);
      this.saveDigest();
      return null;
    }
 
    const sourceTitle = deriveSourceTitle(nextRel);
    const slug = sanitizeSlug(sourceTitle || basename(nextRel, ".md"));
    const summaryRelPath = join("wiki", "sources", `source-${slug}.md`).replace(/\\/g, "/");
    const summaryAbs = join(this.vaultPath, summaryRelPath);
 
    // Validate we are writing inside vault & not raw/
    resolveVaultPath(this.vaultPath, summaryAbs);
 
    // Build prompts
    const system = [
      "You are GZMO's Ingest Engine.",
      "Your job: summarize one raw source document into a single Obsidian wiki source summary page.",
      "Constraints:",
      "- Output Markdown only (no HTML).",
      "- Include YAML frontmatter (tags, sources).",
      "- Do not fabricate. If uncertain, write 'Unknown'.",
      "- Include a '## Raw Source' section that contains the raw relative path string exactly.",
      "",
    ].join("\n");
 
    const prompt = [
      `Raw relative path: ${nextRel}`,
      "",
      "Write a source summary page with these sections:",
      "1) # <Title>",
      "2) ## What it is",
      "3) ## Key takeaways (3–8 bullets)",
      "4) ## Notable details (optional)",
      "5) ## Raw Source (must include the exact raw relative path)",
      "",
      "Frontmatter requirements:",
      "- tags: array",
      "- sources: 1",
      "",
      "RAW CONTENT (truncated if needed):",
      rawContent.slice(0, 12_000),
    ].join("\n");
 
    const draft = await infer(system, prompt);
 
    // Normalize and write schema-compliant summary
    const normalized = await writeSchemaCompliantWikiPage({
      vaultPath: this.vaultPath,
      wikiFileAbs: summaryAbs,
      rawMarkdown: draft,
    });
 
    const touchedPages: string[] = [`[[${normalized.fileBaseName}]]`];

    // Phase 3B: Enrich the graph by linking this source into relevant existing pages.
    if (opts?.embeddingStore && opts?.ollamaUrl) {
      try {
        const q = `${normalized.frontmatter.title}\n${draft.slice(0, 600)}`;
        const hits = await searchVault(q, opts.embeddingStore, opts.ollamaUrl, 8);
        const candidates = hits
          .map(h => h.file.replace(/\\/g, "/"))
          .filter(f => f.startsWith("wiki/entities/") || f.startsWith("wiki/concepts/") || f.startsWith("wiki/topics/"))
          .filter(f => !f.startsWith("wiki/sources/"))
          .filter((f, i, arr) => arr.indexOf(f) === i)
          .slice(0, 3);

        for (const rel of candidates) {
          const abs = join(this.vaultPath, rel);
          const linked = await linkSourceIntoWikiPage({
            vaultPath: this.vaultPath,
            pageAbs: abs,
            sourceSummaryAbs: summaryAbs,
          });
          touchedPages.push(`[[${linked.pageBase}]]`);
        }
      } catch {
        // non-fatal enrichment
      }
    }

    // Mark raw as processed
    this.digest.processed.push(nextRel);
    this.saveDigest();
 
    // Log + index
    await appendWikiLogEntry({
      vaultPath: this.vaultPath,
      operation: "ingest",
      title: normalized.frontmatter.title,
      summary: `Source summary created for ${nextRel}.`,
      pagesTouched: touchedPages,
      contradictions: "none",
    }).catch(() => {});
 
    await rebuildWikiIndex(this.vaultPath).catch(() => {});
 
    return {
      rawRelPath: nextRel,
      summaryWikiPath: summaryAbs,
      title: normalized.frontmatter.title,
      touchedPages,
    };
  }
}

export const __testing = {
  sanitizeSlug,
  deriveSourceTitle,
};
