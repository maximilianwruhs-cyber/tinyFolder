import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { KnowledgeGraph, extractEntities } from "../knowledge_graph/graph";

describe("extractEntities", () => {
  test("extracts file references (no .. traversal)", () => {
    const text = "See `wiki/overview.md` and src/engine.ts and `../etc/passwd`.";
    const entities = extractEntities(text, "task.md");
    const files = entities.filter((e) => e.type === "file").map((e) => e.text);
    expect(files).toContain("wiki/overview.md");
    expect(files).toContain("src/engine.ts");
    expect(files.some((f) => f.includes(".."))).toBe(false);
  });

  test("extracts CamelCase code symbols", () => {
    const text = "The ToTController uses KnowledgeGraph in Engine.";
    const entities = extractEntities(text, "task.md");
    const syms = entities.filter((e) => e.type === "code_symbol").map((e) => e.text);
    expect(syms).toContain("ToTController");
    expect(syms).toContain("KnowledgeGraph");
  });
});

describe("KnowledgeGraph", () => {
  let vaultA: string;
  let vaultB: string;

  beforeEach(() => {
    vaultA = mkdtempSync(join(tmpdir(), "gzmo-kg-a-"));
    vaultB = mkdtempSync(join(tmpdir(), "gzmo-kg-b-"));
    KnowledgeGraph.resetAll();
  });

  afterEach(() => {
    rmSync(vaultA, { recursive: true, force: true });
    rmSync(vaultB, { recursive: true, force: true });
    KnowledgeGraph.resetAll();
  });

  test("forVault is singleton per vault", () => {
    const a1 = KnowledgeGraph.forVault(vaultA);
    const a2 = KnowledgeGraph.forVault(vaultA);
    const b1 = KnowledgeGraph.forVault(vaultB);
    expect(a2).toBe(a1);
    expect(b1).not.toBe(a1);
  });

  test("upsertClaim deduplicates and increments confidence", async () => {
    const kg = KnowledgeGraph.forVault(vaultA);
    await kg.init();
    const src = kg.upsertSource("GZMO/Inbox/task.md", { sourceFile: "GZMO/Inbox/task.md" });
    const id1 = kg.upsertClaim("The daemon writes health.md.", src, 0.8);
    const id2 = kg.upsertClaim("The daemon writes health.md.", src, 0.8);
    expect(id2).toBe(id1);
    const node = kg.getNode(id1)!;
    expect(node.type).toBe("claim");
    expect((node.confidence ?? 0)).toBeGreaterThan(0.8);
  });

  test("subgraph returns neighborhood", async () => {
    const kg = KnowledgeGraph.forVault(vaultA);
    await kg.init();
    const src = kg.upsertSource("task.md", { sourceFile: "task.md" });
    const ent = kg.upsertEntity("Chaos Engine", { sourceFile: "task.md" });
    kg.addEdge(src, ent, "mentions", 0.7);
    const sg = kg.subgraph(src, 1);
    expect(sg.nodes.some((n) => n.id === src)).toBe(true);
    expect(sg.nodes.some((n) => n.id === ent)).toBe(true);
    expect(sg.edges.length).toBeGreaterThan(0);
  });

  test("persist writes snapshot.json when dirty", async () => {
    const kg = KnowledgeGraph.forVault(vaultA);
    await kg.init();
    kg.upsertSource("task.md", { sourceFile: "task.md" });
    await kg.persist();
    expect(existsSync(join(vaultA, "GZMO", "Knowledge_Graph", "snapshot.json"))).toBe(true);
  });
});

