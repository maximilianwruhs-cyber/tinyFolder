import { describe, expect, test } from "bun:test";
import { runEvalHarness } from "../eval_harness";

describe("eval_harness", () => {
  test("passes minimal deterministic + safety gates", async () => {
    const res = await runEvalHarness();
    expect(res.ok).toBe(true);
    expect(res.metrics.scenarioCount).toBeGreaterThan(0);
    expect(res.metrics.retrievalHitCount).toBeGreaterThan(0);
    expect(res.metrics.expectedEmptyCount).toBeGreaterThan(0);
  });
});

