import { describe, expect, test } from "bun:test";
import { buildTripartitePrompt, wrapWithTripartiteLayers } from "../pipelines/tripartite_identity";
import {
  defaultSemanticNoiseState,
  estimateSemanticDrift,
  semanticNoiseExceeded,
  tickSemanticNoise,
} from "../semantic_noise";
import { applySemanticNoiseStress, defaultCortisolState } from "../allostasis";

describe("tripartite_identity", () => {
  test("buildTripartitePrompt includes all layers", () => {
    const p = buildTripartitePrompt({
      task: { objective: "Find X", constraints: ["cite evidence"] },
      context: { sessionLogs: ["prior turn"], empiricalGrounding: "vault snippet" },
      coordination: { role: "EXECUTOR", escalationThreshold: 0.5 },
    });
    expect(p).toContain("TASK LAYER");
    expect(p).toContain("CONTEXT LAYER");
    expect(p).toContain("COORDINATION LAYER");
    expect(p).toContain("Find X");
  });

  test("wrapWithTripartiteLayers embeds base prompt in context", () => {
    const p = wrapWithTripartiteLayers("BASE PROMPT", "do search");
    expect(p).toContain("BASE PROMPT");
    expect(p).toContain("do search");
  });
});

describe("semantic_noise", () => {
  test("high drift increases budget", () => {
    const s = tickSemanticNoise(defaultSemanticNoiseState(0.5), "quantum physics QCD", "recipe for banana bread");
    expect(s.budgetUsed).toBeGreaterThan(0);
    expect(estimateSemanticDrift("hello world test", "hello world test")).toBeLessThan(0.1);
  });

  test("semanticNoiseExceeded at budget max", () => {
    const s = { ...defaultSemanticNoiseState(0.1), budgetUsed: 0.15 };
    expect(semanticNoiseExceeded(s)).toBe(true);
  });

  test("applySemanticNoiseStress raises cortisol on overflow", () => {
    const out = applySemanticNoiseStress(defaultCortisolState(), 1.2, 1.0);
    expect(out.level).toBeGreaterThan(0);
  });
});
