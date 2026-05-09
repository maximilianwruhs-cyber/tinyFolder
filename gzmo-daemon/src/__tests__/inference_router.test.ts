/**
 * inference_router.test.ts — env-tag resolution table for inferByRole.
 *
 * We can't make real Ollama calls inside `bun test`, so this file focuses on
 * the deterministic surface: tag resolution + routing-enabled flag. A full
 * end-to-end check lives in the regression integration test (skipped when
 * Ollama is offline).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { getChatModelForRole, modelRoutingEnabled } from "../inference_router";

const ENV_KEYS = [
  "GZMO_ENABLE_MODEL_ROUTING",
  "OLLAMA_MODEL",
  "GZMO_FAST_MODEL",
  "GZMO_REASON_MODEL",
  "GZMO_JUDGE_MODEL",
  "GZMO_RERANK_MODEL",
] as const;

const original: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
function snapshotEnv() {
  for (const k of ENV_KEYS) original[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k] as string;
  }
}

afterEach(restoreEnv);

describe("inference_router: modelRoutingEnabled", () => {
  test("defaults to false when env unset", () => {
    snapshotEnv();
    delete process.env.GZMO_ENABLE_MODEL_ROUTING;
    expect(modelRoutingEnabled()).toBe(false);
  });

  test.each(["1", "true", "on", "yes"])("returns true for env=%s", (val) => {
    snapshotEnv();
    process.env.GZMO_ENABLE_MODEL_ROUTING = val;
    expect(modelRoutingEnabled()).toBe(true);
  });

  test.each(["0", "false", "off", "no"])("returns false for env=%s", (val) => {
    snapshotEnv();
    process.env.GZMO_ENABLE_MODEL_ROUTING = val;
    expect(modelRoutingEnabled()).toBe(false);
  });
});

describe("inference_router: getChatModelForRole tag resolution", () => {
  test("falls back to OLLAMA_MODEL when role-specific env is unset", () => {
    snapshotEnv();
    process.env.OLLAMA_MODEL = "main-model:latest";
    delete process.env.GZMO_FAST_MODEL;
    delete process.env.GZMO_REASON_MODEL;
    delete process.env.GZMO_JUDGE_MODEL;
    delete process.env.GZMO_RERANK_MODEL;

    const m = getChatModelForRole("fast");
    // The model object exposes its tag as `.modelId` (AI SDK convention).
    expect((m as { modelId?: string }).modelId).toBe("main-model:latest");
  });

  test("uses GZMO_FAST_MODEL when set for role=fast", () => {
    snapshotEnv();
    process.env.OLLAMA_MODEL = "main-model:latest";
    process.env.GZMO_FAST_MODEL = "qwen2.5:0.5b";
    expect((getChatModelForRole("fast") as { modelId?: string }).modelId).toBe("qwen2.5:0.5b");
  });

  test("uses GZMO_REASON_MODEL when set for role=reason", () => {
    snapshotEnv();
    process.env.OLLAMA_MODEL = "main-model:latest";
    process.env.GZMO_REASON_MODEL = "qwen3:32b";
    expect((getChatModelForRole("reason") as { modelId?: string }).modelId).toBe("qwen3:32b");
  });

  test("uses GZMO_JUDGE_MODEL when set for role=judge", () => {
    snapshotEnv();
    process.env.OLLAMA_MODEL = "main-model:latest";
    process.env.GZMO_JUDGE_MODEL = "phi3:14b";
    expect((getChatModelForRole("judge") as { modelId?: string }).modelId).toBe("phi3:14b");
  });

  test("uses GZMO_RERANK_MODEL when set for role=rerank", () => {
    snapshotEnv();
    process.env.OLLAMA_MODEL = "main-model:latest";
    process.env.GZMO_RERANK_MODEL = "rerank:tiny";
    expect((getChatModelForRole("rerank") as { modelId?: string }).modelId).toBe("rerank:tiny");
  });

  test("treats whitespace-only role env as unset (falls back to OLLAMA_MODEL)", () => {
    snapshotEnv();
    process.env.OLLAMA_MODEL = "main-model:latest";
    process.env.GZMO_REASON_MODEL = "   ";
    expect((getChatModelForRole("reason") as { modelId?: string }).modelId).toBe("main-model:latest");
  });

  test("default role returns OLLAMA_MODEL", () => {
    snapshotEnv();
    process.env.OLLAMA_MODEL = "explicit-default:1b";
    expect((getChatModelForRole("default") as { modelId?: string }).modelId).toBe("explicit-default:1b");
  });
});
