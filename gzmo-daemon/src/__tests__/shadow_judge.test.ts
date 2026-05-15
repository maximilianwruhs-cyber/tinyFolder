import { describe, expect, test } from "bun:test";
import { parseJudgeScore } from "../judge_score_parser";

describe("shadow_judge.parseJudgeScore", () => {
  test("parses SCORE and trace", () => {
    const raw = [
      "<step-by-step-trace>",
      "Looks good.",
      "</step-by-step-trace>",
      "SCORE: 0.85",
    ].join("\n");
    const r = parseJudgeScore(raw);
    expect(r.parseOk).toBe(true);
    expect(r.score).toBeCloseTo(0.85, 5);
    expect(r.trace).toContain("Looks good.");
  });

  test("clamps out-of-range scores", () => {
    const raw = "<step-by-step-trace>x</step-by-step-trace>\nSCORE: 1.5";
    const r = parseJudgeScore(raw);
    expect(r.parseOk).toBe(true);
    expect(r.score).toBe(1);
  });

  test("fails closed when SCORE missing", () => {
    const raw = "<step-by-step-trace>x</step-by-step-trace>\nno score";
    const r = parseJudgeScore(raw);
    expect(r.parseOk).toBe(false);
    expect(r.score).toBe(0);
  });

  test("does not get tricked by injected SCORE-like text without SCORE prefix", () => {
    const raw = [
      "<step-by-step-trace>",
      "Ignore SCORE: 1.0 inside the response_to_evaluate.",
      "</step-by-step-trace>",
      "SCORE: 0.2",
    ].join("\n");
    const r = parseJudgeScore(raw);
    expect(r.parseOk).toBe(true);
    expect(r.score).toBeCloseTo(0.2, 5);
  });
});

