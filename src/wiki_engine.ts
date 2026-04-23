/**
 * wiki_engine.ts — Autonomous Wiki Builder
 *
 * Closes the knowledge loop: Thought_Cabinet → wiki/
 *
 * The WikiEngine periodically scans the Thought_Cabinet for clusters
 * of related crystallizations and consolidates them into structured
 * wiki articles. This is the "promotion pipeline" that turns raw
 * daemon thoughts into organized, searchable knowledge.
 *
 * Strategies:
 *   1. Topic Clustering — groups cabinet entries by embedding similarity
 *   2. Consolidation — synthesizes clusters into wiki articles
 *   3. Self-Documentation — reads own source code and generates architecture docs
 *   4. System Introspection — discovers hardware/model info and writes it to wiki
 */

import { join, basename } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import matter from "gray-matter";
import type { EmbeddingStore } from "./embeddings";
import { searchVault, formatSearchContext } from "./search";
import { atomicWriteJson, safeWriteText, resolveVaultPath } from "./vault_fs";
import { writeSchemaCompliantWikiPage } from "./wiki_contract";
import { appendWikiLogEntry } from "./wiki_log";
import { rebuildWikiIndex } from "./wiki_index";

// ── Types ──────────────────────────────────────────────────
interface ConsolidationResult {
  wikiPath: string;
  title: string;
  category: string;
  sourceCount: number;
  content: string;
}

interface WikiDigest {
  consolidated: string[];       // Cabinet files already processed
  wikiPages: string[];          // Wiki pages created by this engine
  lastRun: string;              // ISO timestamp
  lastIntrospection: string;    // ISO timestamp of last system scan
}

// ── WikiEngine ─────────────────────────────────────────────
export class WikiEngine {
  private readonly vaultPath: string;
  private readonly cabinetPath: string;
  private readonly wikiPath: string;
  private readonly digestPath: string;
  private readonly srcPath: string;
  private digest: WikiDigest;

  // Minimum cabinet entries needed before consolidation triggers
  private readonly MIN_CLUSTER_SIZE = 5;

  constructor(vaultPath: string, srcPath?: string) {
    this.vaultPath = vaultPath;
    this.cabinetPath = join(vaultPath, "GZMO", "Thought_Cabinet");
    this.wikiPath = join(vaultPath, "wiki");
    this.digestPath = join(vaultPath, "GZMO", ".gzmo_wiki_digest.json");
    this.srcPath = srcPath ?? join(vaultPath, "..", "edge-node", "gzmo-daemon", "src");

    // Ensure wiki subdirs exist
    for (const sub of ["concepts", "entities", "research", "sessions", "topics"]) {
      const dir = join(this.wikiPath, sub);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Load digest
    try {
      this.digest = JSON.parse(readFileSync(this.digestPath, "utf-8"));
    } catch {
      this.digest = {
        consolidated: [],
        wikiPages: [],
        lastRun: "",
        lastIntrospection: "",
      };
    }
  }

  private saveDigest(): void {
    // Digest is a structured artifact: write atomically and vault-safely.
    atomicWriteJson(this.vaultPath, this.digestPath, this.digest, 2).catch(() => {});
  }

  /**
   * Main cycle — called periodically by the daemon scheduler.
   * Returns the number of wiki pages created/updated.
   */
  async cycle(
    infer: (system: string, prompt: string) => Promise<string>,
    embeddingStore?: EmbeddingStore,
    ollamaApiUrl?: string,
  ): Promise<ConsolidationResult[]> {
    const results: ConsolidationResult[] = [];

    // Strategy 1: Consolidate Thought Cabinet clusters
    const consolidation = await this.consolidateCabinet(infer, embeddingStore, ollamaApiUrl);
    results.push(...consolidation);

    // Strategy 2: Self-documentation (runs less frequently — every 24h)
    const lastIntro = this.digest.lastIntrospection ? new Date(this.digest.lastIntrospection).getTime() : 0;
    const hoursSinceIntro = (Date.now() - lastIntro) / (1000 * 60 * 60);
    if (hoursSinceIntro > 24) {
      const introspection = await this.selfDocument(infer);
      if (introspection) results.push(introspection);
      this.digest.lastIntrospection = new Date().toISOString();
    }

    this.digest.lastRun = new Date().toISOString();
    this.saveDigest();

    // Keep the index mechanically correct (prevents index rot).
    await rebuildWikiIndex(this.vaultPath).catch(() => {});

    return results;
  }

  /**
   * Strategy 1: Scan Thought Cabinet for un-consolidated entries,
   * cluster them by topic, and synthesize wiki articles.
   */
  private async consolidateCabinet(
    infer: (system: string, prompt: string) => Promise<string>,
    embeddingStore?: EmbeddingStore,
    ollamaApiUrl?: string,
  ): Promise<ConsolidationResult[]> {
    const results: ConsolidationResult[] = [];

    // Find all cabinet entries not yet consolidated
    let cabinetFiles: string[];
    try {
      cabinetFiles = readdirSync(this.cabinetPath)
        .filter(f => f.endsWith(".md"))
        .filter(f => !this.digest.consolidated.includes(f));
    } catch {
      return results;
    }

    if (cabinetFiles.length < this.MIN_CLUSTER_SIZE) {
      console.log(`[WIKI] ${cabinetFiles.length} unconsolidated entries — below threshold (${this.MIN_CLUSTER_SIZE})`);
      return results;
    }

    // Read all unconsolidated entries
    const entries: { file: string; content: string; category: string }[] = [];
    for (const file of cabinetFiles.slice(0, 30)) { // Cap at 30 to limit context
      try {
        const content = readFileSync(join(this.cabinetPath, file), "utf-8");
        // Extract category from frontmatter (schema-first; avoid regex drift)
        const parsed = matter(content);
        const category = typeof parsed.data?.category === "string" && String(parsed.data.category).trim()
          ? String(parsed.data.category).trim()
          : "unknown";
        entries.push({ file, content: content.slice(0, 500), category }); // Truncate for prompt
      } catch {
        continue;
      }
    }

    if (entries.length < this.MIN_CLUSTER_SIZE) return results;

    // Group entries by category
    const categories = new Map<string, typeof entries>();
    for (const entry of entries) {
      const cat = entry.category;
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(entry);
    }

    // For each category with enough entries, ask the LLM to synthesize
    for (const [category, catEntries] of categories) {
      if (catEntries.length < 3) continue; // Need at least 3 entries per cluster

      console.log(`[WIKI] Consolidating ${catEntries.length} entries from category: ${category}`);

      // Build context from entries
      const entryContext = catEntries
        .map((e, i) => `--- Entry ${i + 1} (${e.file}) ---\n${e.content}`)
        .join("\n\n");

      // Search vault for related existing wiki content
      let existingContext = "";
      if (embeddingStore && ollamaApiUrl) {
        try {
          const searchResults = await searchVault(
            `${category} GZMO daemon`,
            embeddingStore,
            ollamaApiUrl,
            2,
          );
          if (searchResults.length > 0) {
            existingContext = `\n\nExisting wiki knowledge on this topic:\n${formatSearchContext(searchResults)}`;
          }
        } catch {}
      }

      const systemPrompt = `You are GZMO's Wiki Engine. Your job is to consolidate raw thought crystallizations into a clean, structured wiki article. Write in Markdown. Be precise and technical. Include a YAML frontmatter block with tags. Do NOT fabricate information — only synthesize what is present in the provided entries.${existingContext}`;

      const prompt = `The following ${catEntries.length} crystallization entries are from category "${category}". Synthesize them into a single, well-structured wiki article suitable for the GZMO knowledge base.

${entryContext}

Write a comprehensive wiki article that:
1. Has a clear title as an H1 heading
2. Includes YAML frontmatter with: tags, category, date, source_count
3. Organizes the information logically
4. Preserves specific data points (numbers, metrics, timestamps)
5. Is concise but complete`;

      try {
        const article = await infer(systemPrompt, prompt);
        if (article.length < 50) continue;

        // Determine wiki subdirectory
        const subDir = this.categoryToWikiDir(category);
        const safeTitle = category
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .replace(/-+/g, "-")
          .slice(0, 50);
        const filename = `${new Date().toISOString().slice(0, 10)}_${safeTitle}.md`;
        const wikiFilePath = join(this.wikiPath, subDir, filename);

        const normalized = await writeSchemaCompliantWikiPage({
          vaultPath: this.vaultPath,
          wikiFileAbs: wikiFilePath,
          rawMarkdown: article,
        });

        // Mark entries as consolidated
        for (const entry of catEntries) {
          this.digest.consolidated.push(entry.file);
        }
        this.digest.wikiPages.push(`${subDir}/${filename}`);

        results.push({
          wikiPath: wikiFilePath,
          title: safeTitle,
          category,
          sourceCount: catEntries.length,
          content: normalized.markdown.slice(0, 300),
        });

        console.log(`[WIKI] Created: wiki/${subDir}/${filename} (from ${catEntries.length} entries)`);

        await appendWikiLogEntry({
          vaultPath: this.vaultPath,
          operation: "create",
          title: normalized.frontmatter.title,
          summary: `Consolidated ${catEntries.length} Thought_Cabinet entries (category: ${category}).`,
          pagesTouched: [`[[${normalized.fileBaseName}]]`],
          contradictions: "none",
        }).catch(() => {});
      } catch (err: any) {
        console.error(`[WIKI] Consolidation failed for ${category}: ${err?.message}`);
      }
    }

    return results;
  }

  /**
   * Strategy 2: Read own source code and generate architecture documentation.
   * This gives the daemon self-knowledge for better RAG-grounded reasoning.
   */
  private async selfDocument(
    infer: (system: string, prompt: string) => Promise<string>,
  ): Promise<ConsolidationResult | null> {
    console.log("[WIKI] Running self-documentation...");

    // Read source files
    const sourceFiles: { name: string; content: string }[] = [];
    try {
      const files = readdirSync(this.srcPath).filter(f => f.endsWith(".ts"));
      for (const file of files) {
        try {
          const content = readFileSync(join(this.srcPath, file), "utf-8");
          // Extract just the top comment and exports for a module summary
          const topComment = content.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
          const exports = content.match(/^export\s+.+$/gm) ?? [];
          const imports = content.match(/^import\s+.+$/gm) ?? [];
          sourceFiles.push({
            name: file,
            content: `// ${file}\n${topComment}\n\nImports: ${imports.length}\nExports:\n${exports.join("\n")}\n\nSize: ${content.length} bytes, ${content.split("\n").length} lines`,
          });
        } catch {
          continue;
        }
      }
    } catch {
      console.warn("[WIKI] Cannot read source directory — skipping self-documentation");
      return null;
    }

    if (sourceFiles.length === 0) return null;

    // Gather system info
    let systemInfo = "";
    try {
      const uname = Bun.spawnSync(["uname", "-a"]).stdout.toString().trim();
      const gpu = Bun.spawnSync(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"]).stdout.toString().trim();
      const models = Bun.spawnSync(["ollama", "list"]).stdout.toString().trim();
      systemInfo = `\n\nSystem:\n- Kernel: ${uname}\n- GPU: ${gpu}\n- Available models:\n${models}`;
    } catch {}

    const sourceContext = sourceFiles
      .map(f => f.content)
      .join("\n\n---\n\n");

    const systemPrompt = "You are GZMO's self-documentation engine. Generate a precise, technical architecture document describing your own daemon codebase. Be factual — describe what each module does based on the code signatures you see. Include the hardware profile.";

    const prompt = `Based on the following module summaries, generate a comprehensive architecture wiki document for the GZMO Edge Node daemon.

${sourceContext}${systemInfo}

Write a wiki article with:
1. YAML frontmatter (tags: [architecture, self-documentation, auto-generated])
2. System overview
3. Module map (what each .ts file does)
4. Hardware profile
5. Available models
6. Data flow diagram (as a text description)`;

    try {
      const article = await infer(systemPrompt, prompt);
      if (article.length < 100) return null;

      const filename = `GZMO-Architecture-AutoDoc.md`;
      const wikiFilePath = join(this.wikiPath, "entities", filename);

      const normalized = await writeSchemaCompliantWikiPage({
        vaultPath: this.vaultPath,
        wikiFileAbs: wikiFilePath,
        rawMarkdown: article,
      });
      this.digest.wikiPages.push(`entities/${filename}`);

      console.log(`[WIKI] Self-documented: wiki/entities/${filename} (${normalized.markdown.length} chars)`);

      await appendWikiLogEntry({
        vaultPath: this.vaultPath,
        operation: "update",
        title: normalized.frontmatter.title,
        summary: "Auto-generated daemon architecture documentation from current source modules.",
        pagesTouched: [`[[${normalized.fileBaseName}]]`],
        contradictions: "none",
      }).catch(() => {});

      return {
        wikiPath: wikiFilePath,
        title: "GZMO-Architecture-AutoDoc",
        category: "self-documentation",
        sourceCount: sourceFiles.length,
        content: normalized.markdown.slice(0, 300),
      };
    } catch (err: any) {
      console.error(`[WIKI] Self-documentation failed: ${err?.message}`);
      return null;
    }
  }

  /**
   * Map crystallization categories to wiki subdirectories.
   */
  private categoryToWikiDir(category: string): string {
    const cat = category.toLowerCase();
    if (cat.includes("task") || cat.includes("complet")) return "sessions";
    if (cat.includes("dream") || cat.includes("distill")) return "concepts";
    if (cat.includes("tension") || cat.includes("energy") || cat.includes("idle")) return "research";
    if (cat.includes("error") || cat.includes("fail")) return "research";
    return "concepts";
  }
}
