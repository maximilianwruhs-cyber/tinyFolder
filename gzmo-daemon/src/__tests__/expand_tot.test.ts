import { describe, expect, test } from "bun:test";
import { classifyIntent, parseConfidence, extractVaultReadPath } from "../reasoning/expand";
import { synthesizeToTAnswer } from "../reasoning/synthesis";
import type { ToTNode } from "../reasoning/controller";

describe("classifyIntent", () => {
  test("read file content → vault_read", () => {
    expect(classifyIntent("Read the file contents of wiki/overview.md")).toBe("vault_read");
  });
  test("list files → dir_list", () => {
    expect(classifyIntent("List files in the wiki directory")).toBe("dir_list");
  });
  test("generic → retrieve", () => {
    expect(classifyIntent("Summarize how telemetry works")).toBe("retrieve");
  });
});

describe("parseConfidence", () => {
  test('does not treat "Highlight" as High', () => {
    expect(parseConfidence("Highlight the main points")).toBe(0.5);
  });
  test("explicit confidence: high", () => {
    expect(parseConfidence("CLAIM: x. confidence: high")).toBe(0.9);
  });
  test("structured CLAIM confidence line", () => {
    expect(parseConfidence("CLAIM: foo. CONFIDENCE: Low")).toBe(0.35);
  });
  test("word-boundary confidence phrase", () => {
    expect(parseConfidence("The plot has a medium arc")).toBe(0.5);
    expect(parseConfidence("high confidence in grounding")).toBe(0.9);
  });
});

describe("extractVaultReadPath", () => {
  test("finds markdown path", () => {
    expect(extractVaultReadPath("Sub-task: open wiki/foo.md for review")).toBe("wiki/foo.md");
  });
});

describe("synthesizeToTAnswer", () => {
  test("includes synthesis note and claims", () => {
    const verify: ToTNode = {
      node_id: "v1",
      trace_id: "t",
      parent_id: "r1",
      type: "verify",
      depth: 2,
      prompt_summary: "q",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: "",
      children: [],
      explored: true,
      pruned: false,
      claims: [{ text: "Alpha holds.", confidence: 0.85, sources: ["E1"] }],
      score: 0.85,
    };
    const md = synthesizeToTAnswer([verify], [verify], ["E1"]).markdown;
    expect(md).toContain("Reasoned answer");
    expect(md).toContain("Alpha holds");
  });
});
