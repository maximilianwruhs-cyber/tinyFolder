/**
 * Model Router — dispatch inference by task role when GZMO_ENABLE_MODEL_ROUTING=on.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { InferenceResult, InferDetailedOptions } from "./inference";
import { readBoolEnv } from "./pipelines/helpers";
import { DEFAULT_TIMEOUTS } from "./lifecycle";

export type ModelRole = "fast" | "reason" | "judge" | "rerank" | "default";

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
    case "rerank":
      return process.env.GZMO_RERANK_MODEL?.trim() ? process.env.GZMO_RERANK_MODEL! : main;
    default:
      return main;
  }
}

/**
 * Per-role default timeout (ms). `reason` gets the long budget; everything
 * else uses the fast budget. Callers can still override with `opts.timeoutMs`.
 */
function defaultTimeoutForRole(role: ModelRole): number {
  return role === "reason" || role === "default"
    ? DEFAULT_TIMEOUTS.inferReason()
    : DEFAULT_TIMEOUTS.inferFast();
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
  const { inferDetailed, inferDetailedWithModel } = await import("./inference");

  if (!modelRoutingEnabled()) {
    // R2: even when routing is off, callers should still get the role-appropriate
    // timeout (e.g. fast=30s) instead of always falling back to the 120s reason budget.
    const passOpts: InferDetailedOptions = {
      ...opts,
      timeoutMs: opts?.timeoutMs ?? defaultTimeoutForRole(role),
    };
    return inferDetailed(system, prompt, passOpts);
  }

  const ollama = createOpenAICompatible({ name: "ollama", baseURL: OLLAMA_BASE_URL });
  const tag = resolveTag(role);
  const model = ollama(tag);

  const mergedOpts: InferDetailedOptions = {
    ...opts,
    temperature: opts?.temperature ?? (role === "judge" ? 0.1 : role === "fast" ? 0.5 : 0.6),
    maxTokens: opts?.maxTokens ?? (role === "judge" ? 200 : role === "fast" ? 300 : 600),
    // R2: pick a sensible per-role timeout when the caller didn't specify one.
    timeoutMs: opts?.timeoutMs ?? defaultTimeoutForRole(role),
  };

  return inferDetailedWithModel(model, system, prompt, mergedOpts);
}
