/**
 * Shared LLM inference for engine, ToT expansion, and tools.
 * Kept separate from engine.ts to avoid circular imports with reasoning/.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { applyMindFilter } from "./mind_filter";
import { DEFAULT_TIMEOUTS, makeAbortSignal } from "./lifecycle";

export function normalizeOllamaV1BaseUrl(raw: string | undefined): string {
  const base0 = (raw ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return base0.endsWith("/v1") ? base0 : `${base0}/v1`;
}

const OLLAMA_BASE_URL = normalizeOllamaV1BaseUrl(process.env.OLLAMA_URL);
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "hermes3:8b";

export const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: OLLAMA_BASE_URL,
});

export function getChatModel() {
  return ollama(OLLAMA_MODEL);
}

export interface InferenceResult {
  answer: string;
  thinking?: string;
  raw: string;
  tokens_used?: number;
  elapsed_ms: number;
}

export interface InferDetailedOptions {
  temperature?: number;
  maxTokens?: number;
  mindDeep?: boolean;
  /**
   * Caller-supplied AbortSignal. Combined with the daemon-wide abort signal
   * and the per-call timeout. If omitted, only daemonAbort + timeout apply.
   */
  signal?: AbortSignal;
  /**
   * Hard upper bound for this inference call in milliseconds. When omitted,
   * we use the role-appropriate default from `DEFAULT_TIMEOUTS`. A wedged
   * Ollama can no longer hang the daemon indefinitely.
   */
  timeoutMs?: number;
}

/** Internal: streaming inference with any pre-built model. */
async function _inferStreamCore(
  model: ReturnType<typeof ollama>,
  system: string,
  prompt: string,
  opts?: InferDetailedOptions,
): Promise<InferenceResult> {
  const t0 = Date.now();

  let inferPrompt = prompt;
  const mindEnabled = String(process.env.GZMO_MIND_FILTER ?? "on").toLowerCase() !== "off";
  if (mindEnabled) {
    const mind = applyMindFilter(prompt, {
      deep: opts?.mindDeep ?? String(process.env.GZMO_MIND_DEEP ?? "off").toLowerCase() === "on",
    });
    if (mind.applied) {
      inferPrompt = mind.filtered;
      console.log(
        `[MIND] Filter applied: ${mind.stats.conditionalsFound} conditionals, ${mind.stats.expansionsGenerated} expansions, ${mind.stats.fillerStripped} filler stripped`,
      );
    }
  }

  const temperature = opts?.temperature ?? 0.7;
  const maxTokens = opts?.maxTokens ?? 400;

  // R2: never let a wedged Ollama hang the daemon. Combine caller signal,
  // process-wide daemonAbort, and a per-call timeout.
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUTS.inferReason();
  const abortSignal = makeAbortSignal({ signal: opts?.signal, timeoutMs });

  const result = streamText({
    model,
    system,
    prompt: inferPrompt,
    temperature,
    maxTokens,
    abortSignal,
  } as any);

  let raw = "";
  try {
    for await (const chunk of result.textStream) raw += chunk;
  } catch (err: any) {
    // Surface a clean reason for timeouts / shutdown aborts so the engine can
    // mark the task failed with something more useful than a generic stack.
    const name = err?.name ?? "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(
        `Inference aborted after ${Date.now() - t0}ms (timeout=${timeoutMs}ms): ${err?.message ?? name}`,
      );
    }
    throw err;
  }
  raw = raw.trim();

  let thinking: string | undefined;
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>\n?/i);
  if (thinkMatch) thinking = thinkMatch[1]!.trim();
  const thinkingMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>\n?/i);
  if (thinkingMatch) thinking = thinkingMatch[1]!.trim();

  const answer = raw
    .replace(/<think>[\s\S]*?<\/think>\n?/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>\n?/gi, "")
    .trim();

  return {
    answer,
    thinking,
    raw,
    elapsed_ms: Date.now() - t0,
  };
}

/** Default inference using the global OLLAMA_MODEL. */
export async function inferDetailed(
  system: string,
  prompt: string,
  opts?: InferDetailedOptions,
): Promise<InferenceResult> {
  return _inferStreamCore(ollama(OLLAMA_MODEL), system, prompt, opts);
}

/** Variant that accepts an explicit model instance (used by inference_router). */
export async function inferDetailedWithModel(
  model: ReturnType<typeof ollama>,
  system: string,
  prompt: string,
  opts?: InferDetailedOptions,
): Promise<InferenceResult> {
  return _inferStreamCore(model, system, prompt, opts);
}

export async function infer(system: string, prompt: string): Promise<string> {
  const res = await inferDetailed(system, prompt);
  return res.answer;
}
