/**
 * Model Router — dispatch inference by task role when GZMO_ENABLE_MODEL_ROUTING=on.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { applyMindFilter } from "./mind_filter";
import type { InferenceResult, InferDetailedOptions } from "./inference";
import { readBoolEnv } from "./pipelines/helpers";

export type ModelRole = "fast" | "reason" | "judge" | "default";

function normalizeOllamaV1BaseUrl(raw: string | undefined): string {
  const base0 = (raw ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return base0.endsWith("/v1") ? base0 : `${base0}/v1`;
}

const OLLAMA_BASE_URL = normalizeOllamaV1BaseUrl(process.env.OLLAMA_URL);

export function modelRoutingEnabled(): boolean {
  return readBoolEnv("GZMO_ENABLE_MODEL_ROUTING", false);
}

function resolveTag(role: ModelRole): string {
  const main = process.env.OLLAMA_MODEL ?? "hermes3:8b";
  switch (role) {
    case "fast":
      return process.env.GZMO_FAST_MODEL ?? main;
    case "reason":
      return process.env.GZMO_REASON_MODEL?.trim() ? process.env.GZMO_REASON_MODEL! : main;
    case "judge":
      return process.env.GZMO_JUDGE_MODEL?.trim() ? process.env.GZMO_JUDGE_MODEL! : main;
    default:
      return main;
  }
}

/** Chat model instance for shadow judge / evaluate when routing is on or off. */
export function getChatModelForRole(role: ModelRole = "default") {
  const ollama = createOpenAICompatible({ name: "ollama", baseURL: OLLAMA_BASE_URL });
  return ollama(resolveTag(role));
}

export async function inferByRole(
  role: ModelRole,
  system: string,
  prompt: string,
  opts?: InferDetailedOptions,
): Promise<InferenceResult> {
  if (!modelRoutingEnabled()) {
    const { inferDetailed } = await import("./inference");
    return inferDetailed(system, prompt, opts);
  }

  const ollama = createOpenAICompatible({ name: "ollama", baseURL: OLLAMA_BASE_URL });
  const tag = resolveTag(role);
  const model = ollama(tag);

  let inferPrompt = prompt;
  const mindEnabled = String(process.env.GZMO_MIND_FILTER ?? "on").toLowerCase() !== "off";
  if (mindEnabled) {
    const mind = applyMindFilter(prompt, {
      deep: opts?.mindDeep ?? String(process.env.GZMO_MIND_DEEP ?? "off").toLowerCase() === "on",
    });
    if (mind.applied) inferPrompt = mind.filtered;
  }

  const t0 = Date.now();
  const temperature = opts?.temperature ?? (role === "judge" ? 0.1 : role === "fast" ? 0.5 : 0.6);
  const maxTokens = opts?.maxTokens ?? (role === "judge" ? 200 : role === "fast" ? 300 : 600);

  const result = streamText({
    model,
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
