/**
 * GZMO Self-Ask Engine — Autonomous Knowledge Consolidation
 *
 * Three strategies for strengthening the vault during idle time:
 *
 *  1. Gap Detective   — find connections between distant vault clusters
 *  2. Contradiction Scanner — verify dream claims against vault
 *  3. Spaced Repetition — re-visit old, unreferenced vault entries
 *
 * Architecture (Karpathy Map-Reduce):
 *   Each strategy decomposes into micro-branches → honeypot → aggregation.
 *   The 3B model handles ONE tiny question per branch.
 *   Final pass reads all branch conclusions to synthesize.
 *
 * Prompt architecture: Constraint-First Decomposition (CFD)
 *   Constraints BEFORE objective (Primacy Effect).
 *   Negative few-shot examples to calibrate "No Information" responses.
 *
 * Sources:
 *   - NotebookLM 7755126a: CFD, Anchor-Constrained Extraction
 *   - NotebookLM 9b41df2f: Self-asking patterns, CAIM Memory Controller
 *   - NotebookLM 082f7d1d: Reflexion verbal reinforcement
 */

import { mkdirSync, promises as fsp } from "fs";
import * as path from "path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingStore } from "./embeddings";
import type { ChaosSnapshot } from "./types";
import { searchVault, formatSearchContext, type SearchResult } from "./search";
import { createAutoInboxTasks, parseTypedNextAction, type AutoTaskSpec } from "./auto_tasks";
import { compileEvidencePacket, renderEvidencePacket, type EvidencePacket } from "./evidence_packet";
import { selfEvalAndRewrite } from "./self_eval";
import { verifySafety } from "./verifier_safety";
import { scoreSelfAskOutput } from "./self_ask_quality";
import { extractEdgeCandidate, type EdgeStore } from "./honeypot_edges";
import { validateEdgeCandidate } from "./linc_filter";
import { normalizeOllamaV1BaseUrl } from "./inference";
import { readAutoInboxFromSelfAsk } from "./pipelines/helpers";
import { formatProvenanceYamlComment } from "./provenance_footer";
import { autonomyBudgetAllows, autonomyBudgetConsume } from "./autonomy_budget";

const OLLAMA_BASE_URL = normalizeOllamaV1BaseUrl(process.env.OLLAMA_URL);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "hermes3:8b";
const ollama = createOpenAICompatible({ name: "ollama", baseURL: OLLAMA_BASE_URL });

// ── Types ──────────────────────────────────────────────────────

type InferFn = (system: string, prompt: string) => Promise<string>;

export type SelfAskStrategy = "gap_detective" | "contradiction_scan" | "spaced_repetition";

export interface SelfAskResult {
  strategy: SelfAskStrategy;
  output: string;
  relatedFiles: string[];     // basenames for [[wiki-links]]
  vaultPath: string | null;   // path to written dream file
  timestamp: string;
}

export function assessSelfAskOutput(
  strategy: SelfAskStrategy,
  output: string,
  sources: string[],
): { signal: "none" | "blocked" | "actionable"; nextActions: string[]; reasons: string[] } {
  const raw = String(output ?? "").trim();
  const reasons: string[] = [];

  if (!raw) return { signal: "none", nextActions: [], reasons: ["empty output"] };

  if (/\bno connection found\b/i.test(raw)) {
    reasons.push("explicit no-signal result");
    return { signal: "none", nextActions: [], reasons };
  }

  if (/\buser_interaction_logs?[_-]/i.test(raw) || /\bsearch_results\.csv\b/i.test(raw)) {
    reasons.push("mentions unsupported external evidence");
    return { signal: "blocked", nextActions: [], reasons };
  }

  if (strategy === "contradiction_scan" && /\bcontradict/i.test(raw)) {
    const src = sources.length ? ` (sources: ${sources.slice(0, 3).join(", ")})` : "";
    return {
      signal: "actionable",
      nextActions: [`- [verify] Resolve contradiction surfaced by self-ask${src}`],
      reasons: ["contradiction flagged"],
    };
  }

  return { signal: "blocked", nextActions: [], reasons: ["insufficiently concrete"] };
}

// ── Configuration ──────────────────────────────────────────────

const MAX_AUTO_TASKS_PER_CYCLE = 3;
const MIN_SIMILARITY_GAP = 0.05;  // Floor for gap detective (avoid noise chunks)
const MAX_SIMILARITY_GAP = 0.55;  // Ceiling (above this = too similar, was 0.35 but domain vaults are denser)
const SPACED_REPETITION_DAYS = 7; // Re-visit entries older than this
const HONEYPOT_DIR = "GZMO/Thought_Cabinet/honeypots";
const CABINET_ROOT = ["GZMO", "Thought_Cabinet"] as const;
const DREAMS_SUBDIR = "dreams";

function cabinetSubdirForStrategy(strategy: SelfAskStrategy): string {
  switch (strategy) {
    case "gap_detective": return "gap_detective";
    case "contradiction_scan": return "contradiction_scan";
    case "spaced_repetition": return "spaced_repetition";
  }
}

// ── CFD Prompt Templates (Constraints First!) ──────────────────

const CFD_GAP_SYSTEM = `CONSTRAINTS:
- You may ONLY reference information explicitly present in TOPIC A and TOPIC B below.
- If no connection exists between the two topics, you MUST output exactly: "No connection found."
- Do NOT invent relationships, terminology, or concepts not present in the text.
- Do NOT use parametric memory or general knowledge.
- Maximum 100 words.

EXAMPLE OF CORRECT OUTPUT WHEN NO CONNECTION EXISTS:
Topic A discusses GPU quantization for inference optimization.
Topic B discusses music production workflows.
Output: "No connection found."`;

const CFD_CONTRADICTION_SYSTEM = `CONSTRAINTS:
- You must output ONLY one of three exact strings: "Supported", "Contradicted", or "No Information".
- Only use information explicitly present in the VAULT CONTEXT below.
- Do NOT use outside general knowledge or parametric memory.
- If the specific entity, value, or relationship is not explicitly stated, output "No Information".
- If a claim is partially supported but contains unstated details, output "No Information".

THINKING PROTOCOL (execute internally before answering):
Step A: Extract all distinct entities and claims from the STATEMENT.
Step B: Map each entity to an exact text span in the VAULT CONTEXT.
Step C: If any entity cannot be mapped, this is a "Missing Anchor".
Step D: If a Missing Anchor exists, output "No Information".

EXAMPLE:
Statement: "Cortisol modulates theta-wave oscillation frequency in GZMO."
Vault context mentions cortisol and GZMO but has zero references to theta-wave oscillation.
Missing Anchor: "theta-wave oscillation frequency"
Output: No Information`;

const CFD_SPACED_SYSTEM = `CONSTRAINTS:
- You may ONLY reference information from the OLD ENTRY and RECENT CONTEXT below.
- If no connection exists between old and recent content, output exactly: "No recent connections."
- Do NOT invent relationships.
- Maximum 100 words.
- Do NOT summarize your environment. Focus ONLY on connections.`;

// ── Self-Ask Engine ────────────────────────────────────────────

export class SelfAskEngine {
  private vaultPath: string;
  private honeypotDir: string;
  private edgeStore: EdgeStore;
  private taskCount = 0;

  constructor(vaultPath: string, edgeStore: EdgeStore) {
    this.vaultPath = vaultPath;
    this.edgeStore = edgeStore;
    this.honeypotDir = path.join(vaultPath, HONEYPOT_DIR);
    try { mkdirSync(this.honeypotDir, { recursive: true }); } catch {}
  }

  /**
   * Run one self-ask cycle. Picks the best strategy based on chaos state.
   * Returns results for all strategies that ran (up to MAX_AUTO_TASKS_PER_CYCLE).
   */
  async cycle(
    snap: ChaosSnapshot,
    store: EmbeddingStore,
    ollamaUrl: string,
    infer: InferFn,
  ): Promise<SelfAskResult[]> {
    this.taskCount = 0;
    const results: SelfAskResult[] = [];

    // Chaos-aware gating
    //
    // NOTE: `snap.tension` is 0–100 (derived from hardware telemetry + allostasis).
    // The legacy threshold (15) effectively disables self-ask under normal load.
    // We keep self-ask off in extreme stress, but allow it during normal operation.
    const TENSION_SKIP = 70;
    const ENERGY_MIN = 50;
    if (snap.tension > TENSION_SKIP || snap.energy < ENERGY_MIN || !snap.alive) {
      console.log(
        `[SELF-ASK] Skipped — tension=${snap.tension.toFixed(1)}, energy=${snap.energy.toFixed(0)} (gate: tension>${TENSION_SKIP} or energy<${ENERGY_MIN})`
      );
      return results;
    }

    if (store.chunks.length < 10) {
      console.log("[SELF-ASK] Skipped — vault too small for meaningful analysis");
      return results;
    }

    if (!(await autonomyBudgetAllows(this.vaultPath))) {
      console.log("[SELF-ASK] Skipped — GZMO_AUTONOMY_OPS_BUDGET_HOUR exhausted for this UTC hour");
      return results;
    }

    // Strategy 1: Gap Detective
    if (this.taskCount < MAX_AUTO_TASKS_PER_CYCLE) {
      const gap = await this.gapDetective(store, ollamaUrl, infer);
      if (gap) results.push(gap);
    }

    // Strategy 2: Contradiction Scanner (only if recent dreams exist)
    if (this.taskCount < MAX_AUTO_TASKS_PER_CYCLE) {
      const scan = await this.contradictionScan(store, ollamaUrl, infer);
      if (scan) results.push(scan);
    }

    // Strategy 3: Spaced Repetition
    if (this.taskCount < MAX_AUTO_TASKS_PER_CYCLE) {
      const rep = await this.spacedRepetition(store, ollamaUrl, infer);
      if (rep) results.push(rep);
    }

    return results;
  }

  // ── Strategy 1: Gap Detective ───────────────────────────────

  private async gapDetective(
    store: EmbeddingStore,
    ollamaUrl: string,
    infer: InferFn,
  ): Promise<SelfAskResult | null> {
    try {
      // Pick a random seed chunk
      const seedIdx = Math.floor(Math.random() * store.chunks.length);
      const seed = store.chunks[seedIdx]!;

      // Find a semantically distant chunk (low cosine similarity)
      const seedMag = seed.magnitude || this.vectorMagnitude(seed.vector);
      const candidates = store.chunks
        .map((c, i) => ({ chunk: c, idx: i, sim: this.fastCosineSim(seed.vector, seedMag, c.vector, c.magnitude) }))
        .filter(c => c.sim >= MIN_SIMILARITY_GAP && c.sim <= MAX_SIMILARITY_GAP && c.idx !== seedIdx)
        .sort((a, b) => a.sim - b.sim);

      if (candidates.length === 0) {
        console.log("[SELF-ASK] Gap Detective: no suitable distant chunks found");
        return null;
      }

      // Pick one of the top 5 most distant
      const partnerEntry = candidates[Math.floor(Math.random() * Math.min(5, candidates.length))]!;
      const partner = partnerEntry.chunk;

      console.log(`[SELF-ASK] Gap Detective: ${seed.file} (${seed.heading}) ↔ ${partner.file} (${partner.heading}) [sim=${partnerEntry.sim.toFixed(3)}]`);

      // Branch 1: Extract key concepts from Topic A
      const conceptsA = await infer(
        "CONSTRAINTS:\n- Extract exactly 3 key concepts from the text below.\n- Use only terms that appear in the text.\n- Output as a numbered list, nothing else.\n- Maximum 30 words total.",
        `TEXT:\n${seed.text.slice(0, 800)}`,
      );

      // Branch 2: Extract key concepts from Topic B
      const conceptsB = await infer(
        "CONSTRAINTS:\n- Extract exactly 3 key concepts from the text below.\n- Use only terms that appear in the text.\n- Output as a numbered list, nothing else.\n- Maximum 30 words total.",
        `TEXT:\n${partner.text.slice(0, 800)}`,
      );

      // Honeypot: drop branch conclusions
      const honeypot = `Topic A (${seed.file} — ${seed.heading}):\n${conceptsA}\n\nTopic B (${partner.file} — ${partner.heading}):\n${conceptsB}`;

      // Aggregation: find connections between the extracted concepts
      const packet = this.buildEvidencePacketFromResults([
        { file: seed.file, heading: seed.heading, text: seed.text, score: 1, metadata: seed.metadata },
        { file: partner.file, heading: partner.heading, text: partner.text, score: 0.98, metadata: partner.metadata },
      ]);
      const system = [
        CFD_GAP_SYSTEM,
        "",
        "OUTPUT TEMPLATE (fill slots; keep under 140 words):",
        "- Shared terms (3-7): <comma-separated terms copied verbatim from evidence>",
        "- Connection claim (1 sentence): <must be grounded>",
        "- Evidence:",
        "  - [E#] \"<verbatim quote>\"",
        "  - [E#] \"<verbatim quote>\"",
        "- Confidence: High|Medium|Low",
        "",
        renderEvidencePacket(packet),
      ].join("\n");
      const result = await infer(system, [
        "Task: connect Topic A and Topic B using ONLY the Evidence Packet.",
        "Hard rules:",
        "- You MUST fill every slot in the template.",
        "- Shared terms MUST be copied verbatim from evidence.",
        "- Evidence quotes MUST be exact substrings of the snippets.",
        "- If you cannot produce two exact evidence quotes, output exactly: \"No connection found.\"",
      ].join("\n"));

      this.taskCount++;

      const relatedFiles = [seed.file, partner.file].map(f =>
        f.replace(/\.md$/, "").split("/").pop() || f
      );

      // Write result to Thought Cabinet
      const vaultPath = await this.writeSelfAskEntry(
        "gap_detective", result, relatedFiles, honeypot, packet
      );

      return {
        strategy: "gap_detective",
        output: result,
        relatedFiles,
        vaultPath,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      console.error(`[SELF-ASK] Gap Detective error: ${err?.message}`);
      return null;
    }
  }

  // ── Strategy 2: Contradiction Scanner ───────────────────────

  private async contradictionScan(
    store: EmbeddingStore,
    ollamaUrl: string,
    infer: InferFn,
  ): Promise<SelfAskResult | null> {
    try {
      // Find the most recent dream file
      const cabinetDir = path.join(this.vaultPath, ...CABINET_ROOT, DREAMS_SUBDIR);
      let dreams: string[] = [];
      try {
        dreams = (await fsp.readdir(cabinetDir))
          .filter(f => f.endsWith("_dream.md"))
          .sort()
          .reverse();
      } catch {}

      if (dreams.length === 0) return null;

      const latestDream = await Bun.file(
        path.join(cabinetDir, dreams[0]!)
      ).text();

      // Branch 1: Extract claims from the dream
      const claims = await infer(
        "CONSTRAINTS:\n- Extract all factual claims from the text below.\n- Output as a numbered list.\n- Each claim must be a single, verifiable statement.\n- Maximum 5 claims.\n- If no factual claims exist, output: \"No claims found.\"",
        `TEXT:\n${latestDream.slice(0, 1500)}`,
      );

      if (claims.includes("No claims found")) {
        console.log("[SELF-ASK] Contradiction Scanner: no claims to verify");
        return null;
      }

      // Extract individual claims (lines with numbers, or factual sentences)
      let claimLines = claims.split("\n")
        .filter(l => /^\d+[\.\)\-]/.test(l.trim()) || (l.trim().length > 20 && /\b(is|was|uses|has|are|were|can|will)\b/i.test(l)))
        .map(l => l.trim())
        .filter(l => l.length > 15)
        .slice(0, 3); // Max 3 to verify

      if (claimLines.length === 0) return null;

      // Branch 2+: Verify each claim against vault
      const fullReport: string[] = [];
      for (const claim of claimLines) {
        const results = await searchVault(claim, store, ollamaUrl, 3);
        const packet = compileEvidencePacket({ localFacts: "", results, maxSnippets: 6, maxSnippetChars: 900 });
        const context = renderEvidencePacket(packet);

        if (!context) {
          fullReport.push(`${claim} → No Information (no vault matches)`);
          continue;
        }

        const verdict = await infer(
          [
            CFD_CONTRADICTION_SYSTEM,
            "",
            "If you output Supported/Contradicted, append a citation like: Supported [E2].",
            "If evidence is insufficient, output: No Information.",
          ].join("\n"),
          `EVIDENCE PACKET:\n${context}\n\nSTATEMENT TO VERIFY:\n${claim.replace(/^\d+[\.\)]\s*/, "")}`,
        );

        const cleanVerdict = verdict.trim().split("\n")[0]!.trim();
        fullReport.push(`${claim} → ${cleanVerdict}`);
      }

      this.taskCount++;

      const result = fullReport.join("\n");
      const relatedFiles = [dreams[0]!.replace(/\.md$/, "")];
      const vaultPath = await this.writeSelfAskEntry(
        "contradiction_scan", result, relatedFiles,
        `Source dream: ${dreams[0]}\nClaims extracted:\n${claims}`
      );

      return {
        strategy: "contradiction_scan",
        output: result,
        relatedFiles,
        vaultPath,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      console.error(`[SELF-ASK] Contradiction Scanner error: ${err?.message}`);
      return null;
    }
  }

  // ── Strategy 3: Spaced Repetition ───────────────────────────

  private async spacedRepetition(
    store: EmbeddingStore,
    ollamaUrl: string,
    infer: InferFn,
  ): Promise<SelfAskResult | null> {
    try {
      // Find vault files not referenced by any recent dream
      const cabinetDir = path.join(this.vaultPath, ...CABINET_ROOT, DREAMS_SUBDIR);
      const cutoff = Date.now() - (SPACED_REPETITION_DAYS * 24 * 60 * 60 * 1000);

      // Collect all files referenced in recent dreams
      const recentlyReferenced = new Set<string>();
      try {
        const entries = await fsp.readdir(cabinetDir, { withFileTypes: true });
        const dreamFiles = entries
            .filter(e => e.isFile() && e.name.endsWith(".md"))
            .map(e => path.join(cabinetDir, e.name));

        for (const df of dreamFiles) {
            const stat = await fsp.stat(df);
            if (stat.mtimeMs > cutoff) {
                const content = await Bun.file(df).text();
                const links = content.match(/\[\[([^\]]+)\]\]/g) || [];
                links.forEach(l => recentlyReferenced.add(l.replace(/\[\[|\]\]/g, "")));
            }
        }
      } catch {}

      // Find chunks from files NOT recently referenced
      const unreferencedChunks = store.chunks.filter(c => {
        const basename = c.file.replace(/\.md$/, "").split("/").pop() || "";
        return !recentlyReferenced.has(basename);
      });

      if (unreferencedChunks.length === 0) {
        console.log("[SELF-ASK] Spaced Repetition: all vault files recently referenced");
        return null;
      }

      // Pick a random unreferenced chunk
      const oldChunk = unreferencedChunks[Math.floor(Math.random() * unreferencedChunks.length)]!;

      console.log(`[SELF-ASK] Spaced Repetition: re-visiting ${oldChunk.file} (${oldChunk.heading})`);

      // Branch 1: Search for recent activity related to this old entry
      const recentResults = await searchVault(
        oldChunk.text.slice(0, 300), store, ollamaUrl, 3
      );

      // Filter to only recent dream files as "recent context"
      const recentContext = formatSearchContext(
        recentResults.filter(r => r.file.includes("Thought_Cabinet") || r.file.includes("dream"))
      );

      // Aggregation: connect old entry to recent activity
      const packet = this.buildEvidencePacketFromResults([
        { file: oldChunk.file, heading: oldChunk.heading, text: oldChunk.text, score: 1, metadata: oldChunk.metadata },
        ...recentResults.map((r) => ({ ...r, score: Math.max(0.3, r.score) })),
      ]);
      const system = [
        CFD_SPACED_SYSTEM,
        "",
        "OUTPUT TEMPLATE (fill slots; keep under 140 words):",
        "- Old anchor: <one short phrase copied verbatim from [E#]>",
        "- Recent anchor: <one short phrase copied verbatim from [E#]>",
        "- Connection claim (1 sentence): <grounded>",
        "- Evidence:",
        "  - [E#] \"<verbatim quote>\"",
        "  - [E#] \"<verbatim quote>\"",
        "- Confidence: High|Medium|Low",
        "",
        renderEvidencePacket(packet),
      ].join("\n");
      const result = await infer(system, [
        "Task: connect OLD and RECENT using ONLY evidence snippets. If no connection exists, output exactly: \"No recent connections.\"",
        "If you cannot produce two exact quotes, output exactly: \"No recent connections.\"",
      ].join("\n"));

      this.taskCount++;

      const relatedFiles = [
        oldChunk.file.replace(/\.md$/, "").split("/").pop() || oldChunk.file,
        ...recentResults.map(r => r.file.replace(/\.md$/, "").split("/").pop() || r.file),
      ];

      const vaultPath = await this.writeSelfAskEntry(
        "spaced_repetition",
        result,
        [...new Set(relatedFiles)],
        `Re-visited: ${oldChunk.file}\nHeading: ${oldChunk.heading}`,
        packet
      );

      return {
        strategy: "spaced_repetition",
        output: result,
        relatedFiles: [...new Set(relatedFiles)],
        vaultPath,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      console.error(`[SELF-ASK] Spaced Repetition error: ${err?.message}`);
      return null;
    }
  }

  // ── Vault Writing ───────────────────────────────────────────

  private async writeSelfAskEntry(
    strategy: SelfAskStrategy,
    output: string,
    relatedFiles: string[],
    honeypotData: string,
    packet?: EvidencePacket,
  ): Promise<string> {
    const cabinetDir = path.join(this.vaultPath, ...CABINET_ROOT, cabinetSubdirForStrategy(strategy));
    try { mkdirSync(cabinetDir, { recursive: true }); } catch {}

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "-");
    const filename = `${dateStr}_${timeStr}_${strategy}.md`;
    const filepath = path.join(cabinetDir, filename);

    const wikiLinks = [...new Set(relatedFiles)].map(f => `- [[${f}]]`);

    let finalOutput = output;
    let selfCheckMd = "";

    if (packet && String(process.env.GZMO_ENABLE_SELF_EVAL ?? "on").toLowerCase() !== "off") {
      try {
        const rendered = renderEvidencePacket(packet);
        const { rewritten, report } = await selfEvalAndRewrite({
          model: ollama(OLLAMA_MODEL),
          userPrompt: `Self-Ask strategy=${strategy}.`,
          answer: finalOutput,
          context: rendered,
          maxTokens: 220,
        });
        if (rewritten && rewritten.length >= 20) finalOutput = rewritten;
        if (report) {
          selfCheckMd = [
            "",
            "<details>",
            "<summary>Self-check</summary>",
            "",
            report.trim(),
            "",
            "</details>",
          ].join("\n");
        }
      } catch {
        // non-fatal
      }
    }

    if (packet && String(process.env.GZMO_VERIFY_SAFETY ?? "on").toLowerCase() !== "off") {
      const verdict = verifySafety({ answer: finalOutput, packet });
      if (verdict) {
        finalOutput = [
          "insufficient evidence to produce a safe connection.",
          "",
          `Reason: ${verdict}`,
          "",
          "Next: rerun with more evidence or tighten the retrieved snippets.",
        ].join("\n");
      }
    }

    const q = scoreSelfAskOutput({ output: finalOutput, packet });
    const assessment = assessSelfAskOutput(strategy, finalOutput, relatedFiles);
    // Only actionable assessments produce typed next actions (and thus tasks).
    // For non-actionable outputs, keep human-readable guidance without task typing.
    const nextActions = assessment.signal === "actionable"
      ? assessment.nextActions
      : [
        "- If actionable, convert into a concrete Inbox task and validate against the vault.",
        "- If no-signal, tighten query scope or improve source coverage.",
      ];

    const content = [
      "---",
      `category: self_ask_${strategy}`,
      `date: ${dateStr}`,
      `time: "${now.toISOString().slice(11, 19)}"`,
      `strategy: ${strategy}`,
      `tags: [self-ask, ${strategy}, autonomous]`,
      ...(packet ? [`evidence_snippets: ${packet.snippets.length}`, `quality_score: ${q.score}`] : []),
      "---",
      "",
      `# 🔍 Self-Ask: ${this.strategyLabel(strategy)} — ${dateStr} ${now.toISOString().slice(11, 16)} UTC`,
      "",
      "## Result",
      "",
      finalOutput,
      selfCheckMd,
      "",
      "## Next actions",
      "",
      ...nextActions,
      "",
      "## Vault Links",
      "",
      ...wikiLinks,
      "",
      "## Branch Data (Honeypot)",
      "",
      "```",
      honeypotData,
      "```",
      ...(packet ? ["", "## Evidence Packet", "", renderEvidencePacket(packet)] : []),
      "",
      "---",
      `*Generated autonomously by the GZMO Self-Ask Engine (${strategy}).*`,
      formatProvenanceYamlComment({
        subsystem: "self_ask",
        strategy,
        model: OLLAMA_MODEL,
        retrieval_query_id: packet?.snippets
          ?.filter((s) => s.kind === "retrieval" && s.file)
          .map((s) => s.file!)
          .join("|")
          .slice(0, 200) || undefined,
        evidence_files: packet
          ? [...new Set(packet.snippets.map((s) => s.file).filter((f): f is string => Boolean(f)))]
          : undefined,
      }),
    ].join("\n");

    await Bun.write(filepath, content);
    await autonomyBudgetConsume(this.vaultPath, "self_ask").catch(() => {});
    console.log(`[SELF-ASK] Written: ${filename}`);

    // Emit canonical edge candidates for recursive honeypot layers.
    // Only strategies that propose intersections participate.
    if (strategy === "gap_detective" || strategy === "spaced_repetition") {
      const edge = extractEdgeCandidate({
        strategy,
        output: finalOutput,
        relatedFiles,
        cabinetFile: filename,
      });
      if (edge) {
        // L.I.N.C. validation: score edge before emission.
        // Hybrid gate: hard reject <0.3 (noise), soft score 0.3+ flows to promotion.
        const lincEnabled = String(process.env.GZMO_LINC_FILTER ?? "on").toLowerCase() !== "off";
        if (lincEnabled) {
          const linc = validateEdgeCandidate(edge);
          edge.linc_score = linc.score;
          edge.linc_violations = linc.violations;
          if (!linc.valid || linc.score < 0.3) {
            console.log(`[LINC] Rejected edge ${edge.from}→${edge.to} (score=${linc.score.toFixed(2)}): ${linc.violations.join("; ")}`);
          } else {
            if (linc.adjustedConfidence !== undefined) {
              edge.confidence = linc.adjustedConfidence;
            }
            await this.edgeStore.append(edge).catch(() => {});
            console.log(`[LINC] Accepted edge ${edge.from}→${edge.to} (score=${linc.score.toFixed(2)})`);
          }
        } else {
          await this.edgeStore.append(edge).catch(() => {});
        }
      }
    }

    // Closed loop: only actionable assessments promote tasks.
    if (assessment.signal === "actionable" && assessment.nextActions.length > 0 && readAutoInboxFromSelfAsk()) {
      const typed = assessment.nextActions
        .map((line) => ({ raw: line, parsed: parseTypedNextAction(line.replace(/^-+\s*/, "")) }))
        .filter((x) => x.parsed !== null) as Array<{ raw: string; parsed: { type: any; title: string } }>;
      if (typed.length > 0) {
        const tasks: AutoTaskSpec[] = typed.map((t) => ({
          type: t.parsed.type,
          title: t.parsed.title,
          body: [
            `Source: Self-Ask \`${strategy}\` via \`${filename}\`.`,
            "",
            "Context:",
            "```",
            finalOutput.slice(0, 1200),
            "```",
            "",
            `Assessment: signal=${assessment.signal}; reasons=${assessment.reasons.join("; ") || "(none)"}`,
          ].join("\n"),
          source: { subsystem: "self_ask", sourceFile: filename },
        }));
        await createAutoInboxTasks({ vaultPath: this.vaultPath, tasks }).catch(() => {});
      }
    }

    return filepath;
  }

  // ── Utilities ───────────────────────────────────────────────

  private strategyLabel(s: SelfAskStrategy): string {
    switch (s) {
      case "gap_detective": return "Gap Detective";
      case "contradiction_scan": return "Contradiction Scanner";
      case "spaced_repetition": return "Spaced Repetition";
    }
  }

  private buildEvidencePacketFromResults(results: SearchResult[]): EvidencePacket {
    return compileEvidencePacket({
      localFacts: "",
      results: results.slice(0, 8),
      maxSnippets: 8,
      maxSnippetChars: 900,
    });
  }

  /** Fast cosine similarity using pre-computed magnitudes (O(d) instead of O(2d)). */
  private fastCosineSim(a: number[], magA: number, b: number[], magB: number): number {
    if (a.length !== b.length || a.length === 0) return 0;
    const mA = magA || this.vectorMagnitude(a);
    const mB = magB || this.vectorMagnitude(b);
    if (mA === 0 || mB === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
    return dot / (mA * mB);
  }

  /** Fallback magnitude computation for chunks without pre-computed magnitude. */
  private vectorMagnitude(vec: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i]! * vec[i]!;
    return Math.sqrt(sum);
  }
}
