import { describe, expect, test } from "bun:test";
import {
  splitCompoundQuestions,
  capRecursionDepth,
  stripFiller,
  enforceDeclarativeOrder,
  extractConditionals,
  expandLogic,
  renderLogicAppendix,
  applyMindFilter,
} from "../mind_filter";

describe("MIND Filter — Linguistic Normalization", () => {
  test("splitCompoundQuestions: splits multiple questions", () => {
    const text = "What is the embedding store? How does the search engine rank results?";
    const parts = splitCompoundQuestions(text);
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain("embedding store");
    expect(parts[1]).toContain("search engine");
  });

  test("splitCompoundQuestions: preserves single question", () => {
    const text = "What is the relationship between X and Y?";
    const parts = splitCompoundQuestions(text);
    expect(parts.length).toBe(1);
  });

  test("splitCompoundQuestions: splits on semicolons", () => {
    const text = "Analyze the architecture; Identify failure points";
    const parts = splitCompoundQuestions(text);
    expect(parts.length).toBe(2);
  });

  test("capRecursionDepth: passes shallow text", () => {
    const result = capRecursionDepth("The cat sat on the mat.", 2);
    expect(result.capped).toBe(false);
    expect(result.text).toBe("The cat sat on the mat.");
  });

  test("stripFiller: removes anti-pattern phrases", () => {
    const result = stripFiller("In today's landscape, it's important to note that X.");
    expect(result.count).toBeGreaterThan(0);
    expect(result.text).not.toContain("In today's");
  });

  test("stripFiller: passes clean text", () => {
    const result = stripFiller("The module processes incoming requests.");
    expect(result.count).toBe(0);
  });

  test("enforceDeclarativeOrder: hoists constraints", () => {
    const text = "Analyze the code.\nDo not use external APIs.\nReport findings.";
    const result = enforceDeclarativeOrder(text);
    expect(result.startsWith("CONSTRAINTS:")).toBe(true);
    expect(result).toContain("Do not use external APIs");
  });

  test("enforceDeclarativeOrder: preserves already-ordered text", () => {
    const text = "CONSTRAINT: no external calls\nAnalyze the code.";
    const result = enforceDeclarativeOrder(text);
    expect(result).toBe(text);
  });
});

describe("MIND Filter — Logic-of-Thought Augmentation", () => {
  test("extractConditionals: finds if-then patterns", () => {
    const text = "If the system fails, then restart the daemon.";
    const conds = extractConditionals(text);
    expect(conds.length).toBeGreaterThanOrEqual(1);
    expect(conds[0]!.antecedent).toContain("system fails");
    expect(conds[0]!.consequent).toContain("restart");
  });

  test("extractConditionals: finds when patterns", () => {
    const text = "When temperature rises, the cooling system activates.";
    const conds = extractConditionals(text);
    expect(conds.length).toBeGreaterThanOrEqual(1);
  });

  test("extractConditionals: finds because patterns (reversed)", () => {
    const text = "The daemon crashed because the memory limit was exceeded.";
    const conds = extractConditionals(text);
    expect(conds.length).toBeGreaterThanOrEqual(1);
    // "because" reverses: the antecedent should be the cause
    expect(conds[0]!.antecedent).toContain("memory limit");
    expect(conds[0]!.consequent).toContain("daemon crashed");
  });

  test("extractConditionals: finds requires patterns", () => {
    const text = "The engine requires embeddings to function.";
    const conds = extractConditionals(text);
    expect(conds.length).toBeGreaterThanOrEqual(1);
  });

  test("expandLogic: generates contrapositions", () => {
    const conds = extractConditionals("If A is true, then B follows.");
    const expansions = expandLogic(conds);
    const contra = expansions.filter(e => e.type === "contraposition");
    expect(contra.length).toBeGreaterThanOrEqual(1);
    expect(contra[0]!.derived).toContain("NOT");
  });

  test("expandLogic: detects transitive chains", () => {
    const conds = [
      { antecedent: "input is valid", consequent: "parser accepts", raw: "if input is valid, parser accepts" },
      { antecedent: "parser accepts", consequent: "engine processes", raw: "if parser accepts, engine processes" },
    ];
    const expansions = expandLogic(conds);
    const trans = expansions.filter(e => e.type === "transitive");
    expect(trans.length).toBeGreaterThanOrEqual(1);
    expect(trans[0]!.derived).toContain("input is valid");
    expect(trans[0]!.derived).toContain("engine processes");
  });

  test("renderLogicAppendix: renders formatted output", () => {
    const conds = [{ antecedent: "X", consequent: "Y", raw: "if X then Y" }];
    const exps = expandLogic(conds);
    const appendix = renderLogicAppendix(conds, exps);
    expect(appendix).toContain("LOGIC CONTEXT");
    expect(appendix).toContain("CONTRAPOSITION");
  });

  test("renderLogicAppendix: returns empty for no conditionals", () => {
    expect(renderLogicAppendix([], [])).toBe("");
  });
});

describe("MIND Filter — Composite", () => {
  test("applyMindFilter: processes text with conditionals", () => {
    const text = "If the embedding store fails, then search returns nothing. When search returns nothing, the engine falls back to raw text.";
    const result = applyMindFilter(text);
    expect(result.applied).toBe(true);
    expect(result.stats.conditionalsFound).toBeGreaterThanOrEqual(2);
    expect(result.stats.expansionsGenerated).toBeGreaterThan(0);
    expect(result.filtered).toContain("LOGIC CONTEXT");
  });

  test("applyMindFilter: passes through clean simple text", () => {
    const text = "Summarize the vault contents.";
    const result = applyMindFilter(text);
    expect(result.stats.conditionalsFound).toBe(0);
    expect(result.stats.fillerStripped).toBe(0);
  });

  test("applyMindFilter: respects skipLogic option", () => {
    const text = "If A then B.";
    const result = applyMindFilter(text, { skipLogic: true });
    expect(result.conditionals.length).toBe(0);
    expect(result.filtered).not.toContain("LOGIC CONTEXT");
  });
});
