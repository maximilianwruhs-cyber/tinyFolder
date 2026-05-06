import { describe, expect, test } from "bun:test";
import { analyzeGate, retrieveGate, reasonGate } from "../reasoning/gates";
import { classifyTaskType, buildStrategyTips, formatStrategyContext, type StrategyEntry } from "../learning/ledger";
import { discoverFollowUps } from "../tools/chaining";

describe("gates", () => {
  test("retrieveGate passes with tool facts", () => {
    const r = retrieveGate([], 0.15, { hasToolFacts: true });
    expect(r.passed).toBe(true);
  });

  test("analyzeGate fails on empty subtasks", () => {
    const r = analyzeGate([], "find the config file");
    expect(r.passed).toBe(false);
  });

  test("reasonGate flags bogus evidence ids", () => {
    const r = reasonGate([{ text: "x", sources: ["E99"] }], { snippets: [{ id: "E1", kind: "wiki", text: "a" }] } as any);
    expect(r.passed).toBe(false);
  });
});

describe("learning ledger", () => {
  test("classifyTaskType uses body keywords", () => {
    expect(classifyTaskType("Summarize the wiki index")).toBe("synthesis");
    expect(classifyTaskType("Where is the output written to?")).toBe("path_query");
  });

  test("buildStrategyTips needs 3+ rows of same type", () => {
    const rows: StrategyEntry[] = [
      {
        entry_id: "1",
        task_type: "synthesis",
        task_file: "a.md",
        decomposition_style: "broad_scope",
        used_tools: false,
        used_tot: false,
        model: "m",
        ok: true,
        z_score: 0.8,
        citation_rate: 0,
        total_ms: 1,
        timestamp: "",
      },
      {
        entry_id: "2",
        task_type: "synthesis",
        task_file: "b.md",
        decomposition_style: "broad_scope",
        used_tools: false,
        used_tot: false,
        model: "m",
        ok: true,
        z_score: 0.85,
        citation_rate: 0,
        total_ms: 1,
        timestamp: "",
      },
      {
        entry_id: "3",
        task_type: "synthesis",
        task_file: "c.md",
        decomposition_style: "narrow_scope",
        used_tools: false,
        used_tot: false,
        model: "m",
        ok: true,
        z_score: 0.2,
        citation_rate: 0,
        total_ms: 1,
        timestamp: "",
      },
    ];
    const tips = buildStrategyTips(rows, "synthesis");
    expect(tips.length).toBeGreaterThan(0);
    expect(formatStrategyContext(tips).length).toBeGreaterThan(10);
  });
});

describe("tool chaining", () => {
  test("vault_read follow-up suggests .md refs", () => {
    const out = discoverFollowUps("vault_read", {
      ok: true,
      output: "See details in wiki/foo.md for more.",
      elapsed_ms: 0,
    });
    expect(out.some((x) => x.tool === "vault_read")).toBe(true);
  });
});
