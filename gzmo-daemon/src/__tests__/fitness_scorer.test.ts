import { describe, expect, test } from "bun:test";
import { evaluateFitness } from "../fitness_scorer";

describe("fitness_scorer", () => {
  test("approves good, stable, faster-than-baseline trials", () => {
    const fit = evaluateFitness({
      energyJoules: 1,
      config: { baselineTimeMs: 1000, baselineEnergyJoules: 1, minQuality: 0.75, minEfficiency: 1.0, minZScore: 0.7 },
      trials: [
        { passed: true, executionTimeMs: 500, outputSimilarity: 1 },
        { passed: true, executionTimeMs: 600, outputSimilarity: 0.95 },
        { passed: true, executionTimeMs: 550, outputSimilarity: 1 },
      ],
    });
    expect(fit.approved).toBe(true);
    expect(fit.zScore).toBeGreaterThan(0.7);
  });

  test("rejects when quality is low", () => {
    const fit = evaluateFitness({
      energyJoules: 1,
      config: { baselineTimeMs: 1000, baselineEnergyJoules: 1, minQuality: 0.75, minEfficiency: 1.0, minZScore: 0.7 },
      trials: [
        { passed: false, executionTimeMs: 500, outputSimilarity: 0.2 },
        { passed: false, executionTimeMs: 600, outputSimilarity: 0.1 },
      ],
    });
    expect(fit.approved).toBe(false);
    expect(fit.reason ?? "").toContain("low_quality");
  });
});

