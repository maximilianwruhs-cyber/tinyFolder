import { describe, expect, test } from "bun:test";
import { budgetFromChaos, ToTController, type ToTConfig, type ToTNode } from "../reasoning/controller";
import { defaultSnapshot, type ChaosSnapshot, Phase } from "../types";
import { estimatePriority } from "../reasoning/priority";

function snap(partial: Partial<ChaosSnapshot>): ChaosSnapshot {
  return { ...defaultSnapshot(), ...partial, timestamp: defaultSnapshot().timestamp };
}

function cfg(over: Partial<ToTConfig> = {}): ToTConfig {
  return { ...budgetFromChaos(snap({ energy: 80, phase: Phase.Build, llmValence: 0 })), ...over };
}

function makeNode(
  id: string,
  parent: ToTNode,
  type: ToTNode["type"],
  depth: number,
): Omit<ToTNode, "children" | "explored" | "pruned"> {
  return {
    node_id: id,
    trace_id: parent.trace_id,
    parent_id: parent.node_id,
    type,
    depth,
    prompt_summary: "x",
    outcome: "success",
    elapsed_ms: 0,
    timestamp: new Date().toISOString(),
  };
}

describe("budgetFromChaos", () => {
  test("energy 100 + Build phase → max depth 5", () => {
    const c = budgetFromChaos(snap({ energy: 100, phase: Phase.Build, llmValence: 0 }));
    expect(c.maxDepth).toBe(5);
  });

  test("low energy + Drop phase → shallow depth", () => {
    const c = budgetFromChaos(snap({ energy: 10, phase: Phase.Drop, llmValence: 0 }));
    expect(c.maxDepth).toBe(1);
  });

  test("high valence → more branches than low valence", () => {
    const high = budgetFromChaos(snap({ energy: 50, phase: Phase.Idle, llmValence: 0.8 }));
    const low = budgetFromChaos(snap({ energy: 50, phase: Phase.Idle, llmValence: -0.8 }));
    expect(high.maxBranchesPerNode).toBeGreaterThan(low.maxBranchesPerNode);
  });

  test("GZMO_TOT_MAX_NODES env respected", () => {
    const prev = process.env.GZMO_TOT_MAX_NODES;
    process.env.GZMO_TOT_MAX_NODES = "8";
    const c = budgetFromChaos(snap({ energy: 100, phase: Phase.Build, llmValence: 0 }));
    expect(c.maxTotalNodes).toBe(8);
    if (prev !== undefined) process.env.GZMO_TOT_MAX_NODES = prev;
    else delete process.env.GZMO_TOT_MAX_NODES;
  });
});

describe("ToTController", () => {
  test("root analyze exists", () => {
    const tot = new ToTController(cfg(), "trace-1", "test query");
    expect(tot.root).toBeDefined();
    expect(tot.root!.type).toBe("analyze");
    expect(tot.totalNodes).toBe(1);
  });

  test("addChild increases node count", () => {
    const tot = new ToTController(cfg(), "trace-1", "test");
    tot.addChild(tot.root!, {
      ...makeNode("c1", tot.root!, "retrieve", 1),
    });
    expect(tot.totalNodes).toBe(2);
    expect(tot.root!.children.length).toBe(1);
  });

  test("canExpand false when explored", () => {
    const tot = new ToTController(cfg(), "t", "q");
    tot.root!.explored = true;
    expect(tot.canExpand(tot.root!)).toBe(false);
  });

  test("canExpand false at maxTotalNodes", () => {
    const c = cfg({ maxTotalNodes: 1 });
    const tot = new ToTController(c, "t", "q");
    expect(tot.canExpand(tot.root!)).toBe(false);
  });

  test("verify not expandable", () => {
    const tot = new ToTController(cfg(), "t", "q");
    tot.addChild(tot.root!, makeNode("v1", tot.root!, "verify", 2));
    const added = tot.allNodes.find((n) => n.node_id === "v1")!;
    expect(tot.canExpand(added)).toBe(false);
  });

  test("replan keeps critique children and clears other branches", () => {
    const tot = new ToTController(budgetFromChaos(snap({})), "t1", "q");
    const root = tot.root!;
    tot.addChild(root, {
      node_id: tot.nextNodeId(),
      trace_id: "t1",
      parent_id: root.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "r",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    tot.addChild(root, {
      node_id: tot.nextNodeId(),
      trace_id: "t1",
      parent_id: root.node_id,
      type: "critique",
      depth: 1,
      prompt_summary: "c",
      outcome: "partial",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    tot.replan("try broader retrieval");
    expect(root.type).toBe("replan");
    expect(root.children.filter((c) => !c.pruned).length).toBe(1);
    expect(root.children[0]?.type).toBe("critique");
    expect(root.explored).toBe(false);
  });

  test("prune removes subtree", () => {
    const tot = new ToTController(cfg(), "t", "q");
    const child = tot.addChild(tot.root!, makeNode("c1", tot.root!, "retrieve", 1));
    const grandchild = tot.addChild(child, makeNode("g1", child, "reason", 2));
    tot.prune(child);
    expect(child.pruned).toBe(true);
    expect(grandchild.pruned).toBe(true);
    expect(tot.root!.pruned).toBe(false);
  });

  test("bestPath empty without terminals", () => {
    const tot = new ToTController(cfg(), "t", "q");
    expect(tot.bestPath().length).toBe(0);
  });

  test("bestPath prefers higher min-score path", () => {
    const tot = new ToTController(cfg(), "t", "q");
    const r = tot.addChild(tot.root!, makeNode("r", tot.root!, "retrieve", 1));
    const re = tot.addChild(r, makeNode("re", r, "reason", 2));
    re.score = 0.5;
    const v = tot.addChild(re, makeNode("v", re, "verify", 3));
    v.score = 0.95;

    const re2 = tot.addChild(r, makeNode("re2", r, "reason", 2));
    re2.score = 0.8;
    const v2 = tot.addChild(re2, makeNode("v2", re2, "verify", 3));
    v2.score = 0.85;

    const path = tot.bestPath();
    expect(path[path.length - 1]!.node_id).toBe("v2");
  });

  test("bestPath excludes pruned", () => {
    const tot = new ToTController(cfg(), "t", "q");
    const r = tot.addChild(tot.root!, makeNode("r1", tot.root!, "retrieve", 1));
    const re = tot.addChild(r, makeNode("re1", r, "reason", 2));
    const bad = tot.addChild(re, makeNode("vB", re, "verify", 3));
    bad.score = 0.1;
    tot.prune(bad);
    expect(tot.bestPath().length).toBe(0);
  });

  test("nextNodeId increments", () => {
    const tot = new ToTController(cfg(), "t", "q");
    expect(tot.nextNodeId()).toBe("tot_1");
    tot.addChild(tot.root!, { ...makeNode(tot.nextNodeId(), tot.root!, "retrieve", 1) });
    expect(tot.nextNodeId()).toBe("tot_2");
  });

  test("flattenForTrace strips tree fields", () => {
    const tot = new ToTController(cfg(), "t", "q");
    const flat = tot.flattenForTrace()[0]!;
    expect(flat).not.toHaveProperty("children");
    expect(flat).not.toHaveProperty("explored");
    expect(flat).not.toHaveProperty("pruned");
  });

  test("estimatePriority increases with evidence_cited", () => {
    const tot = new ToTController(cfg(), "t", "q");
    const a = tot.addChild(tot.root!, makeNode("a", tot.root!, "retrieve", 1));
    a.evidence_cited = ["E1", "E2"];
    const b = tot.addChild(tot.root!, makeNode("b", tot.root!, "retrieve", 1));
    expect(estimatePriority(a, tot)).toBeGreaterThan(estimatePriority(b, tot));
  });
});
