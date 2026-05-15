import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runEvalHarness } from "../eval_harness";

// Prevent env pollution from other test files (index.ts sets GZMO_MULTIQUERY=on etc.)
const ISOLATION_KEYS = ["GZMO_MULTIQUERY", "GZMO_RERANK_LLM", "GZMO_ANCHOR_PRIOR"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ISOLATION_KEYS) savedEnv[k] = process.env[k];
  // The harness stubs fetch for embeddings only; disable LLM-dependent search paths.
  process.env.GZMO_MULTIQUERY = "off";
  process.env.GZMO_RERANK_LLM = "off";
  process.env.GZMO_ANCHOR_PRIOR = "off";
});
afterEach(() => {
  for (const k of ISOLATION_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
describe("eval_harness", () => {
  test("passes minimal deterministic + safety gates", async () => {
    const res = await runEvalHarness();
    if (!res.ok) console.error("[EVAL_HARNESS_TEST] details:", JSON.stringify(res.details));
    expect(res.ok).toBe(true);
    expect(res.metrics.scenarioCount).toBeGreaterThan(0);
    expect(res.metrics.retrievalHitCount).toBeGreaterThan(0);
    expect(res.metrics.expectedEmptyCount).toBeGreaterThan(0);
  });
});

