/**
 * clarification_gates.test.ts — GAH, think clarify, DSJ decisions, SearchPipeline.prepare
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { shouldEvidenceGateHalt, buildGahClarification } from "../gah_gate";
import { dsjNeedsRewrite, dsjRewriteAccepted } from "../dsj_decision";
import { checkThinkClarification } from "../think_clarification";
import { buildTotRetryHint } from "../reasoning/tot_retry";
import type { EmbeddingStore } from "../embeddings";

const emptyStore: EmbeddingStore = {
  modelName: "nomic-embed-text",
  chunks: [],
  lastFullScan: new Date().toISOString(),
  dirty: false,
};

let vault = "";
let envSnapshot: Record<string, string | undefined> = {};

function saveEnv(keys: string[]) {
  for (const k of keys) envSnapshot[k] = process.env[k];
}

function restoreEnv(keys: string[]) {
  for (const k of keys) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "gzmo-gates-"));
  mkdirSync(join(vault, "GZMO", "Inbox"), { recursive: true });
  mkdirSync(join(vault, "wiki"), { recursive: true });
  envSnapshot = {};
});

afterEach(() => {
  if (vault) try { rmSync(vault, { recursive: true, force: true }); } catch { /* ignore */ }
  vault = "";
  restoreEnv([
    "GZMO_ENABLE_GAH",
    "GZMO_GAH_MIN_SCORE",
    "GZMO_ENABLE_THINK_CLARIFY",
    "GZMO_ENABLE_TOOLS",
  ]);
});

describe("gah_gate", () => {
  test("halts on empty evidence when enabled", () => {
    const r = shouldEvidenceGateHalt({
      gahEnabled: true,
      hasToolEvidence: false,
      evidenceEmpty: true,
      bestTop: 0,
      gahMinScore: 0.25,
    });
    expect(r.halt).toBe(true);
    expect(r.reason).toContain("No relevant evidence");
    expect(buildGahClarification(r.reason!)).toContain("Suggestions");
  });

  test("does not halt when disabled", () => {
    const r = shouldEvidenceGateHalt({
      gahEnabled: false,
      hasToolEvidence: false,
      evidenceEmpty: true,
      bestTop: 0,
      gahMinScore: 0.25,
    });
    expect(r.halt).toBe(false);
  });

  test("does not halt when tool evidence present", () => {
    const r = shouldEvidenceGateHalt({
      gahEnabled: true,
      hasToolEvidence: true,
      evidenceEmpty: true,
      bestTop: 0,
      gahMinScore: 0.25,
    });
    expect(r.halt).toBe(false);
  });
});

describe("dsj_decision", () => {
  test("needs rewrite when score below threshold", () => {
    expect(dsjNeedsRewrite({ parseOk: true, score: 0.3 }, 0.5)).toBe(true);
    expect(dsjNeedsRewrite({ parseOk: false, score: 0.1 }, 0.5)).toBe(false);
  });

  test("rewrite accepted when re-judge passes", () => {
    expect(dsjRewriteAccepted({ parseOk: true, score: 0.6 }, 0.5)).toBe(true);
    expect(dsjRewriteAccepted({ parseOk: true, score: 0.4 }, 0.5)).toBe(false);
  });
});

describe("tot_retry", () => {
  test("includes prosecutor trace in retry hint", () => {
    const hint = buildTotRetryHint("Missing [E1] citations on claim 2.");
    expect(hint).toContain("Prosecutor critique");
    expect(hint).toContain("Missing [E1]");
  });
});

describe("checkThinkClarification", () => {
  test("flags missing explicit md paths", async () => {
    saveEnv(["GZMO_ENABLE_THINK_CLARIFY"]);
    process.env.GZMO_ENABLE_THINK_CLARIFY = "on";
    const msg = await checkThinkClarification({
      vaultRoot: vault,
      body: "Summarize wiki/missing_page.md for me",
    });
    expect(msg).toContain("missing_page.md");
  });

  test("off by default", async () => {
    delete process.env.GZMO_ENABLE_THINK_CLARIFY;
    const msg = await checkThinkClarification({
      vaultRoot: vault,
      body: "wiki/nope.md",
    });
    expect(msg).toBeUndefined();
  });
});

describe("SearchPipeline.prepare GAH integration", () => {
  test("returns haltReason without retrieval hits when GAH on", async () => {
    saveEnv(["GZMO_ENABLE_GAH", "GZMO_ENABLE_TOOLS"]);
    process.env.GZMO_ENABLE_GAH = "on";
    process.env.GZMO_GAH_MIN_SCORE = "0.25";
    process.env.GZMO_ENABLE_TOOLS = "off";

    mock.module("../search", () => ({
      searchVaultHybrid: async () => [],
    }));

    const { SearchPipeline } = await import("../pipelines/search_pipeline");
    const inboxFile = join(vault, "GZMO/Inbox", "gah_test.md");
    writeFileSync(
      inboxFile,
      ["---", "status: pending", "action: search", "---", "", "quantum field theory", ""].join("\n"),
      "utf8",
    );

    const pipeline = new SearchPipeline();
    const ctx = await pipeline.prepare({
      event: {
        filePath: inboxFile,
        fileName: "gah_test.md",
        body: "quantum field theory",
        status: "pending",
        frontmatter: { status: "pending", action: "search" },
        document: null as any,
      },
      vaultRoot: vault,
      embeddingStore: emptyStore,
      hooks: { postEvidence: async () => ({ changed: false }), postAnswer: async () => ({ changed: false }) } as any,
    });

    expect(ctx.haltReason).toBeDefined();
    expect(ctx.haltReason).toContain("No relevant evidence");
    expect(ctx.deterministicAnswer).toBeUndefined();
  });

  test("no haltReason when GAH off (regression)", async () => {
    saveEnv(["GZMO_ENABLE_GAH"]);
    process.env.GZMO_ENABLE_GAH = "off";

    mock.module("../search", () => ({
      searchVaultHybrid: async () => [],
    }));

    const { SearchPipeline } = await import("../pipelines/search_pipeline");
    const inboxFile = join(vault, "GZMO/Inbox", "gah_off.md");
    writeFileSync(
      inboxFile,
      ["---", "status: pending", "action: search", "---", "", "hello", ""].join("\n"),
      "utf8",
    );

    const pipeline = new SearchPipeline();
    const ctx = await pipeline.prepare({
      event: {
        filePath: inboxFile,
        fileName: "gah_off.md",
        body: "hello",
        status: "pending",
        frontmatter: { status: "pending", action: "search" },
        document: null as any,
      },
      vaultRoot: vault,
      embeddingStore: emptyStore,
      hooks: { postEvidence: async () => ({ changed: false }), postAnswer: async () => ({ changed: false }) } as any,
    });

    expect(ctx.haltReason).toBeUndefined();
  });
});

describe("ThinkPipeline.prepare clarify integration", () => {
  test("returns haltReason for missing vault file when enabled", async () => {
    saveEnv(["GZMO_ENABLE_THINK_CLARIFY"]);
    process.env.GZMO_ENABLE_THINK_CLARIFY = "on";

    const { ThinkPipeline } = await import("../pipelines/think_pipeline");
    const inboxFile = join(vault, "GZMO/Inbox", "think_halt.md");
    writeFileSync(
      inboxFile,
      ["---", "status: pending", "action: think", "---", "", "Read wiki/ghost.md", ""].join("\n"),
      "utf8",
    );

    const pipeline = new ThinkPipeline();
    const ctx = await pipeline.prepare({
      event: {
        filePath: inboxFile,
        fileName: "think_halt.md",
        body: "Read wiki/ghost.md",
        status: "pending",
        frontmatter: { status: "pending", action: "think" },
        document: null as any,
      },
      vaultRoot: vault,
      hooks: {} as any,
    });

    expect(ctx.haltReason).toContain("ghost.md");
  });
});
