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
import { augmentWithWikiGraphContext, formatSearchContext, inferSearchFilters, searchVault } from "./search";
import { TaskMemory } from "./memory";
import { safeWriteText } from "./vault_fs";
import { SMALL_MODEL_AUDITOR_RULES } from "./small_model_rules";

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
    "",
    SMALL_MODEL_AUDITOR_RULES,
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
    prompt += vaultContext;
  }

  // Inject episodic memory (~100 tokens)
  if (memoryContext) {
    prompt += memoryContext;
  }

  return prompt;
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
  vaultRoot: string,
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
    
    if (action === "search" && embeddingStore) {
      // Vault search: find relevant chunks before answering
      const vectorResults = await searchVault(body, embeddingStore, OLLAMA_API_URL, {
        topK: 3,
        filters: inferSearchFilters(body),
      });
      const vaultRoot = filePath.split(/[/\\]GZMO[/\\]/)[0] ?? resolve(filePath, "../../..");
      const results = await augmentWithWikiGraphContext(vaultRoot, vectorResults, 2);
      if (results.length > 0) {
        vaultContext = formatSearchContext(results);
        console.log(`[ENGINE] Found ${results.length} vault chunks (top: ${(results[0]!.score * 100).toFixed(0)}%)`);

      }
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

    // 8. Append the result to the task file
    const output = `\n---\n\n## GZMO Response\n*${new Date().toISOString()}*\n\n${fullText}`;
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
        await safeWriteText(vaultRoot, chainPath, chainContent);
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
