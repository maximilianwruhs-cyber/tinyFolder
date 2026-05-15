import { describe, expect, mock, test } from "bun:test";
import type { ToTNode } from "../reasoning/controller";

describe("evaluateNodeWithJudge", () => {
  test("returns trace from shadow judge", async () => {
    mock.module("../shadow_judge", () => ({
      shadowJudge: async () => ({
        score: 0.35,
        trace: "Citations missing on bullet 2.",
        raw: "",
        parseOk: true,
      }),
    }));

    const { evaluateNodeWithJudge } = await import("../reasoning/evaluate");
    const node = {
      claims: [{ text: "Claim A", confidence: 0.8, sources: ["E1"] }],
    } as ToTNode;

    const r = await evaluateNodeWithJudge(node, {}, "user q", "evidence ctx");
    expect(r.trace).toContain("Citations missing");
    expect(r.score).toBeLessThan(0.6);
  });
});
