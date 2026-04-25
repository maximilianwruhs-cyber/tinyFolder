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
import { existsSync, mkdirSync } from "fs";
import { promises as fsp } from "fs";
import matter from "gray-matter";
import type { EmbeddingStore } from "./embeddings";
import { searchVault, formatSearchContext } from "./search";
import { atomicWriteJson, safeWriteText, resolveVaultPath } from "./vault_fs";
import { writeSchemaCompliantWikiPage } from "./wiki_contract";
import { appendWikiLogEntry } from "./wiki_log";
import { rebuildWikiIndex } from "./wiki_index";
import { createAutoInboxTasks, parseTypedNextAction, type AutoTaskSpec } from "./auto_tasks";
import { assessWikiDraft, quarantineArtifact, createRepairTask } from "./quarantine";
import { writeOpsOutputsIndex } from "./wiki_ops_index";
import { compileEvidencePacket, renderEvidencePacket } from "./evidence_packet";
import { selfEvalAndRewrite } from "./self_eval";
import { verifySafety } from "./verifier_safety";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/v1";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "hermes3:8b";
const ollama = createOpenAICompatible({ name: "ollama", baseURL: OLLAMA_BASE_URL });

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

async function listCabinetMarkdownRecursive(cabinetAbs: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dirAbs: string): Promise<void> {
    let ents: Array<{ name: string; isDir: boolean; isFile: boolean }> = [];
    try {
      const raw = await fsp.readdir(dirAbs, { withFileTypes: true });
      ents = raw.map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() }));
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const full = join(dirAbs, e.name);
      if (e.isDir) {
        await walk(full);
      } else if (e.isFile && e.name.endsWith(".md")) {
        // Never consolidate honeypot engine stores (they are structured outputs, not text notes).
        if (full.includes("/honeypots/")) continue;
        out.push(full);
      }
    }
  }
  await walk(cabinetAbs);
  return out;
}

// ── WikiEngine ─────────────────────────────────────────────
export class WikiEngine {
  private readonly vaultPath: string;
  private readonly cabinetPath: string;
  private readonly wikiPath: string;
  private readonly digestPath: string;
  private readonly srcPath: string;
  private digest: WikiDigest;
  private digestLoaded = false;

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

    // Load digest lazily (async) to avoid blocking the event loop during daemon boot.
    this.digest = {
      consolidated: [],
      wikiPages: [],
      lastRun: "",
      lastIntrospection: "",
    };
  }

  private async ensureDigestLoaded(): Promise<void> {
    if (this.digestLoaded) return;
    this.digestLoaded = true;
    try {
      const file = Bun.file(this.digestPath);
      if (file.size === 0) return;
      const parsed = await file.json();
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Partial<WikiDigest>;
        this.digest = {
          consolidated: Array.isArray(rec.consolidated) ? rec.consolidated : [],
          wikiPages: Array.isArray(rec.wikiPages) ? rec.wikiPages : [],
          lastRun: typeof rec.lastRun === "string" ? rec.lastRun : "",
          lastIntrospection: typeof rec.lastIntrospection === "string" ? rec.lastIntrospection : "",
        };
      }
    } catch {
      // keep defaults
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
    await this.ensureDigestLoaded();
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
    // Keep an ops outputs index page up to date (improves deterministic grounding).
    await writeOpsOutputsIndex({ vaultPath: this.vaultPath }).catch(() => {});

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
      const absFiles = await listCabinetMarkdownRecursive(this.cabinetPath);
      const relFiles = absFiles.map((abs) => abs.replace(this.cabinetPath + "/", ""));
      cabinetFiles = relFiles
        .filter((f) => f.endsWith(".md"))
        .filter((f) => !this.digest.consolidated.includes(f));
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
        const content = await Bun.file(join(this.cabinetPath, file)).text();
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
      let existingResults: any[] = [];
      if (embeddingStore && ollamaApiUrl) {
        try {
          const searchResults = await searchVault(
            `${category} GZMO daemon`,
            embeddingStore,
            ollamaApiUrl,
            2,
          );
          existingResults = searchResults;
        } catch {}
      }

      const packet = compileEvidencePacket({
        localFacts: `CABINET ENTRIES (ground truth):\n${entryContext}`,
        results: existingResults,
        maxSnippets: 10,
        maxSnippetChars: 900,
      });
      const evidence = renderEvidencePacket(packet);

      const systemPrompt = [
        "You are GZMO's Wiki Engine.",
        "Your job is to CONSOLIDATE the provided cabinet entries into a wiki page.",
        "",
        "Hard constraints:",
        "- Be extractive and grounded: ONLY use information present in the Evidence Packet.",
        "- Do NOT use outside knowledge. Do NOT add generic filler or marketing language.",
        "- Every non-trivial claim must be supported by an explicit quote or datum from the Evidence Packet and cited by [E#].",
        "- If the entries are too thin, produce a short page that says so and list what information is missing.",
        "",
        "Output format constraints:",
        "- Markdown only.",
        "- The wiki contract will normalize frontmatter; you may include frontmatter but keep it minimal.",
        "",
        evidence,
      ].join("\n");

      const prompt = `The following ${catEntries.length} cabinet entries are from category "${category}". Consolidate them into a single wiki article.

Required structure (Markdown):

1) H1 title (short, specific; derived from the entries)
2) ## Summary (2–4 bullets, each grounded)
3) ## Evidence (quotes / extracted data)
   - 3–10 bullets
   - Each bullet MUST cite which entry it came from, e.g. "(Entry 2: 2026-..._dream.md)"
4) ## Implications (grounded; may be empty)
5) ## Next actions (1–5 bullets; concrete improvements or follow-ups)

Rules:
- If no evidence exists for a claim, do not include the claim.
- If there are contradictions between entries, list them under Evidence as separate bullets.`;

      const promptWithTaskTypes = [
        prompt,
        "",
        "Next actions typing rule:",
        "- If (and only if) a bullet should become an Inbox task, prefix it with one of: [maintenance] [research] [build] [verify] [curate].",
      ].join("\n");

      try {
        let article = await infer(systemPrompt, promptWithTaskTypes);
        if (article.length < 50) continue;

        // Optional verifier passes (cheap honesty boost).
        if (String(process.env.GZMO_ENABLE_SELF_EVAL ?? "on").toLowerCase() !== "off") {
          try {
            const { rewritten } = await selfEvalAndRewrite({
              model: ollama(OLLAMA_MODEL),
              userPrompt: `Wiki consolidation category=${category}.`,
              answer: article,
              context: evidence,
              maxTokens: 260,
            });
            if (rewritten && rewritten.length > 50) article = rewritten;
          } catch {}
        }
        if (String(process.env.GZMO_VERIFY_SAFETY ?? "on").toLowerCase() !== "off") {
          const verdict = verifySafety({ answer: article, packet });
          if (verdict) {
            // Fail closed: quarantine will catch it; make the failure explicit.
            article = `# Wiki draft rejected\n\ninsufficient evidence to produce a safe draft.\n\nReason: ${verdict}\n`;
          }
        }

        const qualityCheck = assessWikiDraft(article);
        if (!qualityCheck.ok) {
          const qAbs = await quarantineArtifact({
            vaultPath: this.vaultPath,
            kind: "wiki",
            sourceId: `category:${category}`,
            reason: qualityCheck.reason ?? "other",
            details: qualityCheck.details ?? "Wiki draft failed quality gate.",
            rawMarkdown: article,
          }).catch(() => null);

          if (qAbs) {
            await createRepairTask({
              vaultPath: this.vaultPath,
              title: `Repair wiki consolidation output (${category})`,
              reason: qualityCheck.reason ?? "other",
              quarantineFile: basename(qAbs),
              suggestion: "Adjust the wiki consolidation prompt or add missing evidence/entry references, then re-run the wiki cycle.",
            }).catch(() => {});
          }
          continue;
        }

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

        // Closed loop: promote typed Next actions into Inbox tasks.
        try {
          const nextActionsSection = article.match(/##\s*Next actions\s+([\s\S]*?)(?:\n## |\n---|$)/i)?.[1] ?? "";
          const lines = nextActionsSection
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith("- "))
            .map((l) => l.slice(2).trim());

          const typed = lines
            .map((line) => ({ parsed: parseTypedNextAction(line), raw: line }))
            .filter((x) => x.parsed !== null) as Array<{ raw: string; parsed: { type: any; title: string } }>;

          if (typed.length > 0) {
            const tasks: AutoTaskSpec[] = typed.map((t) => ({
              type: t.parsed.type,
              title: t.parsed.title,
              body: [
                `Source: Wiki consolidation \`${basename(wikiFilePath)}\` (category: ${category}).`,
                "",
                "Evidence excerpt (for grounding):",
                "```",
                (article.match(/##\s*Evidence\s+([\s\S]*?)(?:\n## |\n---|$)/i)?.[1] ?? "").trim().slice(0, 1200),
                "```",
              ].join("\n"),
              source: { subsystem: "wiki", sourceFile: basename(wikiFilePath) },
            }));
            await createAutoInboxTasks({ vaultPath: this.vaultPath, tasks }).catch(() => {});
          }
        } catch {}

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
      const files = (await fsp.readdir(this.srcPath)).filter((f) => f.endsWith(".ts"));
      for (const file of files) {
        try {
          const content = await Bun.file(join(this.srcPath, file)).text();
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

    const systemPrompt = [
      "You are GZMO's self-documentation engine.",
      "Write a precise, technical architecture document describing the daemon codebase.",
      "Hard constraints:",
      "- No metaphors, no storytelling, no marketing language, no filler.",
      "- Prefer tables and bullet lists over paragraphs.",
      "- Be factual: only use information present in the provided module summaries + system info.",
      "- Keep the 'System overview' to max 2 sentences.",
      "",
    ].join("\n");

    const prompt = `Based on the following module summaries, generate a structured architecture wiki document for the GZMO daemon.

${sourceContext}${systemInfo}

Required output format (Markdown):

Frontmatter:
- title: Architecture Overview
- tags: [architecture, self-documentation, auto-generated]
- sources: ${sourceFiles.length}

Sections:
1) # Architecture Overview
2) ## System overview (max 2 sentences)
3) ## Data flow (mechanical)
   - Bullet list: Source -> Transform -> Write, using real module names.
   - List the canonical vault paths written (e.g. \`GZMO/CHAOS_STATE.json\`, \`GZMO/Thought_Cabinet/\`, \`wiki/index.md\`, \`wiki/log.md\`, \`wiki/sources/\`).
4) ## Module map (table)
   A Markdown table with columns:
   - Module
   - Responsibility (1 line)
   - Key exports (names only)
   - Reads (paths or 'none')
   - Writes (paths or 'none')
   - Invariants (1 short bullet; e.g. 'never write to raw/')
5) ## Runtime profile
   - Kernel line
   - GPU line
   - Models list
6) ## Known limitations (bullets)
   - Only include limitations directly inferable from the summaries (e.g. missing data, partial coverage).`;

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
