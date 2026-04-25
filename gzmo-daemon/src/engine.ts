/**
 * engine.ts — The GZMO inference engine (Smart Core v0.3.0)
 *
 * Now with:
 * - Task routing via `action:` frontmatter
 * - Vault search via nomic-embed-text embeddings
 * - Episodic memory for cross-task continuity
 * - Chaos-aware LLM parameter modulation
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { updateFrontmatter, appendToTask } from "./frontmatter";
import type { TaskEvent } from "./watcher";
import type { VaultWatcher } from "./watcher";
import { resolve } from "path";
import type { ChaosSnapshot } from "./types";
import { Phase } from "./types";
import type { PulseLoop } from "./pulse";
import type { EmbeddingStore } from "./embeddings";
import { searchVaultHybrid } from "./search";
import { TaskMemory } from "./memory";
import { safeWriteText } from "./vault_fs";
import { gatherLocalFacts } from "./local_facts";
import { selfEvalAndRewrite } from "./self_eval";
import { gatherVaultStateIndex } from "./vault_state_index";
import { compileEvidencePacket, renderEvidencePacket, type EvidencePacket } from "./evidence_packet";
import { verifySafety } from "./verifier_safety";

// ── Configuration ──────────────────────────────────────────
const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://localhost:11434/v1";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "hermes3:8b";
const OLLAMA_API_URL = process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434";

// ── Provider Setup ─────────────────────────────────────────
const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: OLLAMA_BASE_URL,
});

// ── Task Actions ───────────────────────────────────────────
type TaskAction = "think" | "search" | "chain";

function parseAction(frontmatter: Record<string, unknown>): TaskAction {
  const action = String(frontmatter.action ?? "think").toLowerCase();
  if (action === "search" || action === "chain") return action;
  return "think";
}


// ── Phase Persona ──────────────────────────────────────────
function phasePersona(phase: Phase): string {
  switch (phase) {
    case Phase.Idle:  return "You are calm and reflective. Prioritize clarity and precision.";
    case Phase.Build: return "You are alert and focused. Be thorough and structured.";
    case Phase.Drop:  return "You are under pressure. Be decisive and direct. No hedging.";
  }
}

// ── Valence Coloring ───────────────────────────────────────
function valenceDirective(valence: number): string {
  if (valence < -0.5) return " Approach with caution — flag risks and uncertainties.";
  if (valence < -0.15) return " Be measured and analytical.";
  if (valence > 0.5) return " Be exploratory and confident — suggest bold connections.";
  if (valence > 0.15) return " Be constructive and forward-looking.";
  return ""; // Neutral — no directive
}

// ── Verbosity Control (from Lorenz z-axis) ─────────────
function verbosityDirective(maxTokens: number): string {
  if (maxTokens < 500) return " Keep your response concise — under 150 words.";
  if (maxTokens > 700) return " You may elaborate and explore in detail.";
  return ""; // Default range — no override
}

// ── System Prompt (chaos-modulated) ────────────────────────
function buildSystemPrompt(
  snap?: ChaosSnapshot,
  vaultContext?: string,
  memoryContext?: string,
): string {
  let prompt = [
    "You are GZMO, a sovereign local AI daemon running on this machine.",
    "GZMO is your name, not an acronym. You are NOT a fictional character.",
    "Respond in Markdown.",
    "",
    "Hard constraints:",
    "- Follow the task's requested structure exactly (headings, bullet counts, 'exactly N', etc.).",
    "- Do not invent information. If something is not present in the task (or provided context), say so explicitly and keep it brief.",
    "- If asked to quote text, quote it verbatim from the task/context.",
  ].join("\n");

  if (snap) {
    // Phase-driven persona modulation
    prompt += " " + phasePersona(snap.phase);
    // Valence coloring from Lorenz y-axis
    prompt += valenceDirective(snap.llmValence);
    // Verbosity from Lorenz z-axis (soft control, no hard token cap)
    prompt += verbosityDirective(snap.llmMaxTokens);
    // Chaos state tag for grounding
    prompt += ` [T:${snap.tension.toFixed(0)} E:${snap.energy.toFixed(0)}% ${snap.phase} V:${snap.llmValence >= 0 ? "+" : ""}${snap.llmValence.toFixed(2)}]`;
  }

  // Inject vault search context (action: search)
  if (vaultContext) {
    prompt += [
      "",
      "Grounding rules (when context is provided):",
      "- Treat the 'Evidence Packet' as the only allowed evidence source.",
      "- For each non-trivial claim, cite evidence by ID like [E2].",
      "- If evidence is missing, say 'insufficient evidence' and suggest the next deterministic check.",
      "- Never claim you wrote/changed files unless the evidence packet contains it explicitly.",
      "",
      vaultContext,
    ].join("\n");
  }

  // Inject episodic memory (~100 tokens)
  if (memoryContext) {
    prompt += memoryContext;
  }

  return prompt;
}

function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

function readIntEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, n));
}

// ── Standalone Inference (for DreamEngine / SelfAsk) ────────
export async function infer(system: string, prompt: string): Promise<string> {
  const result = streamText({
    model: ollama(OLLAMA_MODEL),
    system,
    prompt,
  });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  // Strip out thinking blocks (Qwen3 emits both <think> and <thinking> formats)
  text = text.replace(/<think>[\s\S]*?<\/think>\n?/g, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, "")
    .trim();
  return text;
}

// ── Task Processor (Smart Core) ────────────────────────────
export async function processTask(
  event: TaskEvent,
  watcher: VaultWatcher,
  pulse?: PulseLoop,
  embeddingStore?: EmbeddingStore,
  memory?: TaskMemory,
): Promise<void> {
  const { filePath, fileName, body, frontmatter } = event;
  const startTime = Date.now();

  // Lock the file so our writes don't re-trigger the watcher
  watcher.lockFile(filePath);

  // Emit task_received event into chaos engine
  pulse?.emitEvent({
    type: "task_received",
    fileName,
    action: String(frontmatter?.action ?? "think"),
    bodyLength: body.length,
    title: String(frontmatter?.title ?? "").trim() || undefined,
  });

  try {
    // 0. Parse action from frontmatter
    const action = parseAction(frontmatter ?? {});
    console.log(`[ENGINE] Processing: ${fileName} (action: ${action})`);

    // 1. Claim the task
    await updateFrontmatter(filePath, {
      status: "processing",
      started_at: new Date().toISOString(),
    });

    // 2. Build context based on action
    let vaultContext: string | undefined;
    let evidencePacket: EvidencePacket | undefined;

    if (action === "search" && embeddingStore) {
      const enableV2 = readBoolEnv("GZMO_PIPELINE_V2", true);
      // Deterministic grounding: ops facts + vault state index (prevents RAG blind spots).
      const vaultRoot = filePath.split(/[/\\]GZMO[/\\]/)[0] ?? resolve(filePath, "../../..");
      const [localFacts, vaultIndex] = await Promise.all([
        gatherLocalFacts({ vaultPath: vaultRoot, query: body }).catch(() => ""),
        gatherVaultStateIndex({ vaultPath: vaultRoot, query: body }).catch(() => ""),
      ]);

      // Hybrid retrieval: semantic + lexical.
      const topK = readIntEnv("GZMO_TOPK", 6, 1, 20);
      const results = enableV2 ? await searchVaultHybrid(body, embeddingStore, OLLAMA_API_URL, topK) : [];
      if (results.length > 0) {
        console.log(`[ENGINE] Found ${results.length} vault chunks (top: ${(results[0]!.score * 100).toFixed(0)}%)`);
      }

      const enableEvidence = readBoolEnv("GZMO_EVIDENCE_PACKET", true);
      evidencePacket = compileEvidencePacket({
        localFacts: [localFacts, vaultIndex].filter(Boolean).join("\n"),
        results,
        maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 10, 1, 20),
        maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
      });
      vaultContext = enableEvidence ? renderEvidencePacket(evidencePacket) : [localFacts, vaultIndex].filter(Boolean).join("\n");
    }

    // 3. Get chaos snapshot for full parameter modulation
    const snap = pulse?.snapshot();
    const temp = snap?.llmTemperature ?? 0.7;
    const maxTok = snap?.llmMaxTokens ?? 400;
    const valence = snap?.llmValence ?? 0;
    console.log(`[ENGINE] Model: ${OLLAMA_MODEL} (temp: ${temp.toFixed(2)}, tokens: ${maxTok}, val: ${valence >= 0 ? "+" : ""}${valence.toFixed(2)}, phase: ${snap?.phase ?? "?"})`);

    // 4. Build system prompt with context (now chaos-modulated)
    const memoryContext = memory?.toPromptContext();
    const systemPrompt = buildSystemPrompt(snap, vaultContext, memoryContext);

    // 5. Run inference — temperature + prompt modulation
    const result = streamText({
      model: ollama(OLLAMA_MODEL),
      system: systemPrompt,
      prompt: body,
      temperature: temp,
      // The AI SDK types vary across versions; Bun runtime supports this setting for Ollama models.
      maxTokens: maxTok,
    } as any);

    // 6. Stream the response
    let fullText = "";
    for await (const chunk of result.textStream) {
      fullText += chunk;
    }

    // 7. Strip thinking blocks from Qwen3 output (both <think> and <thinking> formats)
    fullText = fullText
      .replace(/<think>[\s\S]*?<\/think>\n?/g, "")
      .replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, "")
      .trim();
    if (!fullText) {
      fullText = "_[GZMO produced internal reasoning but no visible output. Consider adding explicit output instructions or using /no_think.]_";
      console.warn(`[ENGINE] Empty output after think-stripping for: ${fileName}`);
    }

    // Optional self-eval pass (cheap honesty boost) for action: search.
    // Defaults ON for search, can be disabled via env.
    let selfCheckBlock = "";
    if (action === "search" && readBoolEnv("GZMO_ENABLE_SELF_EVAL", true)) {
      try {
        const { rewritten, report } = await selfEvalAndRewrite({
          model: ollama(OLLAMA_MODEL),
          userPrompt: body,
          answer: fullText,
          context: vaultContext,
          maxTokens: 220,
        });
        if (rewritten && rewritten.length >= 20) {
          fullText = rewritten;
        }
        if (report) {
          selfCheckBlock = [
            "",
            "<details>",
            "<summary>Self-check</summary>",
            "",
            report.trim(),
            "",
            "</details>",
            "",
          ].join("\n");
        }
      } catch {
        // non-fatal
      }
    }

    // Safety verifier (pass B): block invented paths / side-effect claims.
    if (action === "search" && evidencePacket && readBoolEnv("GZMO_VERIFY_SAFETY", true)) {
      const verdict = verifySafety({ answer: fullText, packet: evidencePacket });
      if (verdict) {
        fullText = [
          "insufficient evidence to answer safely.",
          "",
          `Reason: ${verdict}`,
          "",
          "Next deterministic check: inspect the paths/snippets shown in the Evidence Packet.",
        ].join("\n");
      }
    }

    // 8. Append the result to the task file
    const output = `\n---\n\n## GZMO Response\n*${new Date().toISOString()}*\n\n${fullText}${selfCheckBlock}`;
    await appendToTask(filePath, output);

    // 9. Mark as completed
    await updateFrontmatter(filePath, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });

    console.log(`[ENGINE] Completed: ${fileName} (${action})`);

    // 10. Record in episodic memory
    memory?.record(fileName, fullText);

    // 11. Feed completion back into chaos engine
    const durationMs = Date.now() - startTime;
    pulse?.emitEvent({
      type: "task_completed",
      fileName,
      action: String(frontmatter?.action ?? "think"),
      summary: fullText.slice(0, 240).replace(/\s+/g, " ").trim() || undefined,
      tokenCount: fullText.length / 4,
      durationMs,
    });

    // 12. Handle chain action — create next task
    if (action === "chain" && frontmatter?.chain_next) {
      const { basename, dirname, join } = await import("path");

      // Sanitize nextTask to prevent path traversal (only allow basename).
      let nextTask = basename(String(frontmatter.chain_next));
      if (!nextTask.endsWith(".md")) nextTask += ".md";

      console.log(`[ENGINE] Chain → next task: ${nextTask}`);
      const chainPath = join(dirname(filePath), nextTask);
      const chainContent = `---\nstatus: pending\naction: think\nchain_from: ${fileName}\n---\n\n## Chained Task\n\nPrevious context:\n${fullText.slice(0, 300)}\n\nContinue from here.`;

      try {
        // Derive vault root from the task path (Inbox lives under vault/GZMO).
        const vaultRoot = filePath.split(/[/\\]GZMO[/\\]/)[0] ?? "";
        if (vaultRoot) {
          await safeWriteText(vaultRoot, chainPath, chainContent);
        } else {
          await Bun.write(chainPath, chainContent);
        }
      } catch (err) {
        console.warn(`[ENGINE] Chain write failed: ${err}`);
      }
    }

  } catch (err: any) {
    console.error(`[ENGINE] Failed: ${fileName} — ${err?.message}`);

    try {
      await appendToTask(filePath, `\n---\n\n## ❌ Error\n\`\`\`\n${err?.message}\n\`\`\``);
      await updateFrontmatter(filePath, {
        status: "failed",
        completed_at: new Date().toISOString(),
      });
    } catch { /* last resort */ }

    pulse?.emitEvent({
      type: "task_failed",
      fileName,
      action: String(frontmatter?.action ?? "think"),
      errorType: err?.message ?? "unknown",
    });

  } finally {
    setTimeout(() => watcher.unlockFile(filePath), 1000);
  }
}
