/**
 * Shared LLM inference for engine, ToT expansion, and tools.
 * Kept separate from engine.ts to avoid circular imports with reasoning/.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { applyMindFilter } from "./mind_filter";

function normalizeOllamaV1BaseUrl(raw: string | undefined): string {
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
}

export async function inferDetailed(
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

  const result = streamText({
    model: ollama(OLLAMA_MODEL),
    system,
    prompt: inferPrompt,
    temperature,
    maxTokens,
  } as any);

  let raw = "";
  for await (const chunk of result.textStream) raw += chunk;
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

export async function infer(system: string, prompt: string): Promise<string> {
  const res = await inferDetailed(system, prompt);
  return res.answer;
}
