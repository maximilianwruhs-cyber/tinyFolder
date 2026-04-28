import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { computePerfFitness } from "../perf_fitness";

describe("perf_fitness", () => {
  test("loads recent route_judge trials from perf.jsonl", () => {
    const root = mkdtempSync(join(tmpdir(), "gzmo-perf-fit-"));
    mkdirSync(join(root, "GZMO"), { recursive: true });
    const lines = [
      JSON.stringify({ type: "task_perf", created_at: "t1", fileName: "a.md", action: "search", ok: true, total_ms: 1200, spans: [], route_judge: { score: 1, partValidCitationRate: 1, partBackticksComplianceRate: 1, partAdversarialRejectRate: 1 } }),
      JSON.stringify({ type: "task_perf", created_at: "t2", fileName: "b.md", action: "search", ok: true, total_ms: 1600, spans: [], route_judge: { score: 0.8, partValidCitationRate: 0.8, partBackticksComplianceRate: 1, partAdversarialRejectRate: 1 } }),
      JSON.stringify({ type: "task_perf", created_at: "t3", fileName: "c.md", action: "think", ok: true, total_ms: 900, spans: [] }),
    ].join("\n") + "\n";
    writeFileSync(join(root, "GZMO", "perf.jsonl"), lines, "utf-8");

    const res = computePerfFitness({
      vaultRoot: root,
      limit: 10,
      requireRouteJudge: true,
      actions: ["search"],
      energyJoules: 1,
      scoringConfig: { baselineTimeMs: 2000, baselineEnergyJoules: 1, minQuality: 0, minEfficiency: 0, minZScore: 0 },
    });

    expect(res.trials.length).toBe(2);
    expect(res.trials[0]!.outputSimilarity).toBe(1);
    // default weights: 0.6*cite + 0.2*backticks + 0.2*adversarial
    // => 0.6*0.8 + 0.2*1 + 0.2*1 = 0.88
    expect(res.trials[1]!.outputSimilarity).toBeCloseTo(0.88, 6);
  });
});

