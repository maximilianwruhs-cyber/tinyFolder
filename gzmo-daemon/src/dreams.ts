/**
 * dreams.ts - Dream Engine
 *
 * Distills completed tasks into higher-signal Thought Cabinet entries.
 * This version adds:
 * - canonical context filtering (no dream-on-dream grounding)
 * - structured dream schema with evidence and next actions
 * - lightweight novelty / duplicate gating
 * - separation of supported facts from unverified response claims
 */

import { readFileSync, promises as fsp } from "fs";
import * as path from "path";
import matter from "gray-matter";
import type { ChaosSnapshot } from "./types";
import type { EmbeddingStore } from "./embeddings";
import { searchVault, formatSearchContext, type SearchResult } from "./search";
import { atomicWriteJson, safeWriteText } from "./vault_fs";

const MIN_BODY_LENGTH = 100;
const MIN_RESPONSE_LENGTH = 120;
const MAX_TRANSCRIPT = 4000;
const DIGESTED_FILE_NAME = ".gzmo_dreams_digested.json";
const MAX_CONTEXT_RESULTS = 12;
const MAX_CANONICAL_RESULTS = 4;
const RECENT_DREAM_LOOKBACK = 5;
const RECENT_DREAM_COMPARE = 20;
const MIN_SUMMARY_LENGTH = 120;
const DUPLICATE_SIMILARITY = 0.72;

interface DreamResult {
  taskFile: string;
  insights: string;
  vaultPath: string;
  timestamp: string;
}

interface ExtractedTaskTranscript {
  taskPrompt: string;
  response: string;
  transcript: string;
}

interface DreamDraft {
  summary: string;
  evidence: string[];
  delta: string;
  nextActions: string[];
  confidence: number;
  unverifiedClaims: string[];
  raw: string;
}

interface RecentDream {
  file: string;
  content: string;
  excerpt: string;
}

interface DreamQualityReport {
  accepted: boolean;
  score: number;
  maxSimilarity: number;
  reasons: string[];
}

export class DreamEngine {
  private vaultPath: string;
  private digestedIds: Set<string>;
  private digestedFilePath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.digestedFilePath = path.join(vaultPath, "GZMO", DIGESTED_FILE_NAME);
    this.digestedIds = this.loadDigested();
  }

  async dream(
    snapshot: ChaosSnapshot,
    infer: (system: string, prompt: string) => Promise<string>,
    store?: EmbeddingStore,
    ollamaUrl?: string,
  ): Promise<DreamResult | null> {
    const task = await this.findUnprocessedTask();
    if (!task) return null;

    const transcript = await this.extractTranscript(task.path);
    if (!transcript) return null;

    if (transcript.transcript.length < MIN_BODY_LENGTH || transcript.response.length < MIN_RESPONSE_LENGTH) {
      await this.markDigested(task.id);
      return null;
    }

    const recentDreams = await this.loadRecentDreams(RECENT_DREAM_COMPARE);

    let vaultContext = "";
    let relatedFiles: SearchResult[] = [];
    if (store && store.chunks.length > 0) {
      try {
        const query = [transcript.taskPrompt, transcript.response]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 800);
        const results = await searchVault(query, store, ollamaUrl, MAX_CONTEXT_RESULTS);
        relatedFiles = this.selectCanonicalContext(results);

        if (relatedFiles.length > 0) {
          vaultContext = formatSearchContext(relatedFiles);
          console.log(
            `[DREAM] Canonical RAG: kept ${relatedFiles.length}/${results.length} chunks (top ${(relatedFiles[0]!.score * 100).toFixed(0)}%)`
          );
        }
      } catch (err: any) {
        console.warn(`[DREAM] RAG search failed (non-fatal): ${err?.message}`);
      }
    }

    const draftText = await this.reflect(
      transcript,
      vaultContext,
      recentDreams.slice(0, RECENT_DREAM_LOOKBACK),
      infer,
    );
    if (!draftText) return null;

    const draft = this.parseDreamDraft(draftText);
    if (!draft) {
      console.warn(`[DREAM] Draft parse failed for ${task.id}`);
      return null;
    }

    const quality = this.assessDreamDraft(draft, recentDreams);
    if (!quality.accepted) {
      console.log(
        `[DREAM] Skipped ${task.id} (score=${quality.score}, similarity=${quality.maxSimilarity.toFixed(2)}): ${quality.reasons.join("; ")}`
      );
      await this.markDigested(task.id);
      return null;
    }

    const dreamPath = await this.writeDreamEntry(
      draft,
      snapshot,
      task.id,
      relatedFiles,
      quality.score,
    );

    await this.markDigested(task.id);

    return {
      taskFile: task.id,
      insights: `${draft.summary}\n\nNext Actions:\n${draft.nextActions.map((item) => `- ${item}`).join("\n")}`,
      vaultPath: dreamPath,
      timestamp: new Date().toISOString(),
    };
  }

  private async findUnprocessedTask(): Promise<{ id: string; path: string } | null> {
    const inboxDir = path.join(this.vaultPath, "GZMO", "Inbox");
    try {
      const fileNames = await fsp.readdir(inboxDir);
      const mdFiles = fileNames.filter((file) => file.endsWith(".md"));

      const fileStats = await Promise.all(
        mdFiles.map(async (file) => {
          const filePath = path.join(inboxDir, file);
          const stat = await fsp.stat(filePath);
          return { id: file, path: filePath, mtime: stat.mtimeMs };
        })
      );

      fileStats.sort((a, b) => b.mtime - a.mtime);

      for (const file of fileStats) {
        if (this.digestedIds.has(file.id)) continue;

        try {
          const raw = await Bun.file(file.path).text();
          const parsed = matter(raw);
          if (parsed.data.status === "completed") {
            return file;
          }
        } catch {
          // Skip unreadable task files.
        }
      }
    } catch (err: any) {
      console.error(`[DREAM] Failed to scan inbox: ${err?.message}`);
    }

    return null;
  }

  private async extractTranscript(taskPath: string): Promise<ExtractedTaskTranscript | null> {
    try {
      const raw = await Bun.file(taskPath).text();
      const parsed = matter(raw);
      const content = parsed.content.trim();
      const split = content.split(/\n##\s+GZMO Response\s*\n/i);

      let taskPrompt = split[0]?.trim() ?? content;
      let response = split.slice(1).join("\n## GZMO Response\n").trim();
      response = response.replace(/^\*[^\n]+\*\s*/m, "").trim();

      if (taskPrompt.length > 1200) {
        taskPrompt = `${taskPrompt.slice(0, 1200).trimEnd()}\n...(truncated)`;
      }
      if (response.length > 2600) {
        response = `...(truncated)...\n\n${response.slice(-2600).trimStart()}`;
      }

      const transcript = [
        "## Task Request",
        taskPrompt || "(empty task request)",
        "",
        "## Model Response",
        response || "(no model response recorded)",
      ].join("\n");

      return {
        taskPrompt,
        response,
        transcript: transcript.slice(0, MAX_TRANSCRIPT),
      };
    } catch (err: any) {
      console.error(`[DREAM] Failed to read task: ${err?.message}`);
      return null;
    }
  }

  private async reflect(
    transcript: ExtractedTaskTranscript,
    vaultContext: string,
    recentDreams: RecentDream[],
    infer: (system: string, prompt: string) => Promise<string>,
  ): Promise<string | null> {
    const recentContext = recentDreams.length > 0
      ? recentDreams.map((dream, idx) => `[${idx + 1}] ${dream.file}\n${dream.excerpt}`).join("\n\n")
      : "No recent dream excerpts available.";

    const systemPrompt = [
      "You are distilling a completed task into a high-signal dream note for an Obsidian knowledge vault.",
      "You MUST only use facts that appear in the TASK REQUEST, MODEL RESPONSE, or CANONICAL VAULT CONTEXT below.",
      "Do NOT promote unsupported claims from the MODEL RESPONSE into the Summary.",
      "If a claim appears only in the MODEL RESPONSE and is not corroborated by the task request or canonical context, move it to Unverified Claims.",
      "Recent dreams are for novelty comparison only and must NOT be used as factual evidence.",
      "",
      "Return EXACTLY this structure:",
      "",
      "Summary:",
      "<2-4 factual sentences>",
      "",
      "Evidence:",
      "- <Task request or canonical file backed point>",
      "- <Task request or canonical file backed point>",
      "",
      "Delta:",
      "<What is genuinely new compared with canonical context or recent dreams, or 'No meaningful delta.'>",
      "",
      "Next Actions:",
      "- <1-3 concrete, testable follow-ups>",
      "",
      "Confidence: <0.00-1.00>",
      "",
      "Unverified Claims:",
      "- <claim from the model response that was not corroborated>",
      "- None",
      "",
      "Rules:",
      "- Evidence bullets must cite `Task request`, `Model response`, or a canonical file name.",
      "- Next Actions must be operational, not philosophical.",
      "- If the task is trivial or generic, say so directly and keep Next Actions conservative.",
      "- Keep Summary and Delta together under 220 words.",
    ].join("\n");

    const userPrompt = [
      "## TASK REQUEST",
      "",
      transcript.taskPrompt || "(empty task request)",
      "",
      "## MODEL RESPONSE",
      "",
      transcript.response || "(no model response recorded)",
    ];

    if (vaultContext) {
      userPrompt.push("", "## CANONICAL VAULT CONTEXT", "", vaultContext);
    }

    userPrompt.push(
      "",
      "## RECENT DREAMS (novelty check only)",
      "",
      recentContext,
      "",
      "---",
      "",
      "Write a publishable dream note with evidence, delta, concrete next actions, and any unverified claims separated out."
    );

    try {
      const result = await infer(systemPrompt, userPrompt.join("\n"));
      return result || null;
    } catch (err: any) {
      console.error(`[DREAM] Reflection failed: ${err?.message}`);
      return null;
    }
  }

  private async writeDreamEntry(
    draft: DreamDraft,
    snap: ChaosSnapshot,
    taskFile: string,
    relatedFiles: SearchResult[] = [],
    qualityScore: number,
  ): Promise<string> {
    const cabinetDir = path.join(this.vaultPath, "GZMO", "Thought_Cabinet");
    try {
      await fsp.mkdir(cabinetDir, { recursive: true });
    } catch {
      // Directory may already exist.
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "-");
    const filename = `${dateStr}_${timeStr}_dream.md`;
    const filePath = path.join(cabinetDir, filename);

    const uniqueFiles = [...new Set(relatedFiles.map((result) => result.file))];
    const wikiLinks = uniqueFiles.map((file) => {
      const baseName = file.replace(/\.md$/, "").split("/").pop() || file;
      return `- [[${baseName}]]`;
    });

    const sourceBasename = taskFile.replace(/\.md$/, "");

    const content = [
      "---",
      `date: ${dateStr}`,
      `time: "${now.toISOString().slice(11, 19)}"`,
      `tick: ${snap.tick}`,
      `tension: ${snap.tension.toFixed(1)}`,
      `energy: ${snap.energy.toFixed(0)}`,
      `phase: ${snap.phase}`,
      `chaos_val: ${snap.chaosVal.toFixed(4)}`,
      `temperature: ${snap.llmTemperature.toFixed(3)}`,
      `valence: ${snap.llmValence.toFixed(3)}`,
      `category: dream`,
      `source_task: "${taskFile}"`,
      `source_task_path: "GZMO/Inbox/${taskFile}"`,
      `quality_score: ${qualityScore}`,
      `confidence: ${draft.confidence.toFixed(2)}`,
      `tags: [dream, crystallization, autonomous]`,
      "---",
      "",
      `# Dream - ${dateStr} ${now.toISOString().slice(11, 16)} UTC`,
      "",
      `Source: [[GZMO/Inbox/${sourceBasename}]]`,
      "",
      "## Summary",
      "",
      draft.summary,
      "",
      "## Evidence",
      "",
      ...draft.evidence.map((item) => `- ${item}`),
      "",
      "## Delta",
      "",
      draft.delta,
      "",
      "## Next Actions",
      "",
      ...draft.nextActions.map((item) => `- ${item}`),
      "",
      "## Confidence",
      "",
      draft.confidence.toFixed(2),
      "",
    ];

    if (wikiLinks.length > 0) {
      content.push("## Vault Links", "", ...wikiLinks, "");
    }

    if (draft.unverifiedClaims.length > 0) {
      content.push(
        "## Unverified Claims",
        "",
        ...draft.unverifiedClaims.map((item) => `- ${item}`),
        "",
      );
    }

    content.push(
      "## Chaos State at Dream Time",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Tick | ${snap.tick} |`,
      `| Phase | ${snap.phase} |`,
      `| Tension | ${snap.tension.toFixed(1)}% |`,
      `| Energy | ${snap.energy.toFixed(0)}% |`,
      `| Temperature | ${snap.llmTemperature.toFixed(3)} |`,
      `| Deaths | ${snap.deaths} |`,
      "",
      "---",
      `*Crystallized autonomously by the GZMO Dream Engine at tick ${snap.tick}.*`,
    );

    await safeWriteText(this.vaultPath, filePath, content.join("\n"));
    return filePath;
  }

  private selectCanonicalContext(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const canonical = results.filter((result) => this.isCanonicalContextFile(result.file));
    const unique: SearchResult[] = [];

    for (const result of canonical) {
      if (seen.has(result.file)) continue;
      seen.add(result.file);
      unique.push(result);
      if (unique.length >= MAX_CANONICAL_RESULTS) break;
    }

    return unique;
  }

  private isCanonicalContextFile(file: string): boolean {
    const normalized = file.replace(/\\/g, "/");
    return normalized.startsWith("wiki/")
      || normalized.startsWith("Projects/")
      || normalized.startsWith("Notes/");
  }

  private parseDreamDraft(raw: string): DreamDraft | null {
    const summary = this.extractSection(raw, "Summary", "Evidence");
    const evidence = this.extractBullets(this.extractSection(raw, "Evidence", "Delta"));
    const delta = this.extractSection(raw, "Delta", "Next Actions");
    const nextActions = this.extractBullets(this.extractSection(raw, "Next Actions", "Confidence"));
    const confidenceMatch = raw.match(/Confidence:\s*([01](?:\.\d+)?)/i);
    const unverifiedClaims = this.extractBullets(this.extractSection(raw, "Unverified Claims"));
    const confidence = confidenceMatch ? Number.parseFloat(confidenceMatch[1]!) : 0.5;

    if (!summary || !delta) return null;

    return {
      summary,
      evidence,
      delta,
      nextActions: nextActions.filter((item) => !/^none$/i.test(item)),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
      unverifiedClaims: unverifiedClaims.filter((item) => !/^none$/i.test(item)),
      raw,
    };
  }

  private extractSection(raw: string, label: string, nextLabel?: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nextEscaped = nextLabel ? nextLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
    const pattern = nextEscaped
      ? new RegExp(`${escaped}:\\s*([\\s\\S]*?)\\n${nextEscaped}:`, "i")
      : new RegExp(`${escaped}:\\s*([\\s\\S]*)$`, "i");
    const match = raw.match(pattern);
    return match?.[1]?.trim() ?? "";
  }

  private extractBullets(section: string): string[] {
    return section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  }

  private async loadRecentDreams(limit: number): Promise<RecentDream[]> {
    const cabinetDir = path.join(this.vaultPath, "GZMO", "Thought_Cabinet");
    try {
      const files = (await fsp.readdir(cabinetDir))
        .filter((file) => file.endsWith("_dream.md"))
        .sort()
        .reverse()
        .slice(0, limit);

      return await Promise.all(files.map(async (file) => {
        const content = await Bun.file(path.join(cabinetDir, file)).text();
        return {
          file,
          content,
          excerpt: this.extractRecentDreamExcerpt(content),
        };
      }));
    } catch {
      return [];
    }
  }

  private extractRecentDreamExcerpt(content: string): string {
    const structured = content.match(/## Summary\s+([\s\S]*?)(?:\n## |\n---|$)/i)?.[1]?.trim();
    if (structured) return structured.slice(0, 280);

    const legacy = content.match(/## Crystallized Insights\s+([\s\S]*?)(?:\n## |\n---|$)/i)?.[1]?.trim();
    if (legacy) return legacy.slice(0, 280);

    return content.slice(0, 280).trim();
  }

  private assessDreamDraft(draft: DreamDraft, recentDreams: RecentDream[]): DreamQualityReport {
    const reasons: string[] = [];
    let score = 0;

    if (draft.evidence.length > 0) score += 35;
    else reasons.push("missing evidence");

    if (draft.nextActions.length > 0) score += 25;
    else reasons.push("missing next actions");

    if (draft.summary.length >= MIN_SUMMARY_LENGTH) score += 20;
    else reasons.push("summary too short or generic");

    const currentText = this.normalizeText([
      draft.summary,
      draft.delta,
      draft.nextActions.join(" "),
    ].join(" "));

    let maxSimilarity = 0;
    for (const dream of recentDreams) {
      const similarity = this.jaccardSimilarity(currentText, this.normalizeText(dream.content));
      if (similarity > maxSimilarity) maxSimilarity = similarity;
    }

    if (maxSimilarity < 0.55) score += 20;
    else if (maxSimilarity < DUPLICATE_SIMILARITY) score += 10;
    else reasons.push("too similar to recent dream output");

    return {
      accepted: reasons.length === 0,
      score,
      maxSimilarity,
      reasons,
    };
  }

  private normalizeText(text: string): string[] {
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4);
    return [...new Set(tokens)];
  }

  private jaccardSimilarity(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;

    const aSet = new Set(a);
    const bSet = new Set(b);
    let intersection = 0;

    for (const token of aSet) {
      if (bSet.has(token)) intersection++;
    }

    const union = new Set([...aSet, ...bSet]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private loadDigested(): Set<string> {
    try {
      const raw = readFileSync(this.digestedFilePath, "utf-8");
      const data = JSON.parse(raw);
      return new Set(data.digested || []);
    } catch {
      return new Set();
    }
  }

  private async markDigested(taskId: string): Promise<void> {
    this.digestedIds.add(taskId);

    if (this.digestedIds.size > 200) {
      const ids = [...this.digestedIds];
      this.digestedIds = new Set(ids.slice(ids.length - 200));
    }

    try {
      await atomicWriteJson(
        this.vaultPath,
        this.digestedFilePath,
        {
          digested: [...this.digestedIds],
          lastDream: new Date().toISOString(),
        },
        2,
      );
    } catch (err: any) {
      console.error(`[DREAM] Failed to save digested IDs: ${err?.message}`);
    }
  }
}
