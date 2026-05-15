import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { buildTotRetryHint } from "../reasoning/tot_retry";
import {
  defaultTrustState,
  trustAdjustedDsjThreshold,
  updateTrust,
} from "../learning/trust_ledger";
import { KnowledgeGraph } from "../knowledge_graph/graph";

describe("DialecticMachine", () => {
  test("noop when judge score passes threshold", async () => {
    mock.module("../shadow_judge", () => ({
      shadowJudge: async () => ({ score: 0.9, trace: "ok", raw: "", parseOk: true }),
    }));
    const { runDialecticLoop: runLoop } = await import("../reasoning/dialectic_machine");
    const r = await runLoop({
      userPrompt: "q",
      initialAnswer: "good answer with evidence [E1]",
      systemPrompt: "sys",
      threshold: 0.5,
      temperature: 0.7,
      maxTokens: 100,
      infer: async () => ({ answer: "rewrite", elapsed_ms: 1, thinking: "", raw: "" }),
    });
    expect(r.kind).toBe("noop");
  });
});

describe("trust_ledger", () => {
  test("completed raises trust, unbound lowers", () => {
    const s0 = defaultTrustState();
    const s1 = updateTrust(s0, "completed");
    expect(s1.score).toBeGreaterThan(0.5);
    const s2 = updateTrust(s1, "unbound");
    expect(s2.score).toBeLessThan(s1.score);
    expect(trustAdjustedDsjThreshold(0.5, s1)).toBeLessThan(trustAdjustedDsjThreshold(0.5, s2));
  });
});

describe("KnowledgeGraph.queryCollisions", () => {
  test("finds constraint metadata", async () => {
    const vault = mkdtempSync(join(tmpdir(), "gzmo-kg-"));
    try {
      const kg = KnowledgeGraph.forVault(vault);
      await kg.init();
      const id = kg.upsertEntity("ProjectAlpha", { constraint: "Must not delete production data" });
      expect(id).toBeTruthy();
      const hits = kg.queryCollisions("ProjectAlpha");
      expect(hits.some((h) => h.constraint?.includes("production"))).toBe(true);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe("strategy_review", () => {
  test("writes REVIEW markdown when enabled", async () => {
    const vault = mkdtempSync(join(tmpdir(), "gzmo-review-"));
    process.env.GZMO_ENABLE_STRATEGY_REVIEWS = "on";
    try {
      const { writeStrategyReview } = await import("../learning/strategy_review");
      const path = await writeStrategyReview(vault, {
        entry_id: "test-entry",
        task_type: "unknown",
        task_file: "GZMO/Inbox/x.md",
        decomposition_style: "direct_read",
        used_tools: false,
        used_tot: false,
        model: "test",
        ok: true,
        z_score: 0.8,
        citation_rate: 0.9,
        total_ms: 100,
        timestamp: new Date().toISOString(),
      });
      expect(path).toBeTruthy();
      const md = await readFile(path!, "utf8");
      expect(md).toMatch(/type:\s*REVIEW/);
      expect(md).toMatch(/pending_human_review/);
    } finally {
      delete process.env.GZMO_ENABLE_STRATEGY_REVIEWS;
      rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe("tot_retry", () => {
  test("trace in retry hint", () => {
    expect(buildTotRetryHint("fix citations")).toContain("fix citations");
  });
});
