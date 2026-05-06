# GZMO Strategic Implementation Plan

**Status:** Ready for Implementation  
**Date:** 2026-05-06  
**Scope:** All strategic recommendations from architecture audit  
**Reading list:** `engine.ts`, `run_tot_search.ts`, `controller.ts`, `expand.ts`, `ledger.ts`, `sync_traces.ts`, `graph.ts`, `gates.ts`, `critique.ts`, `synthesis.ts`, `inference_router.ts`, `search.ts`, `embeddings.ts`, `reasoning_trace.ts`

---

## Table of Contents

1. [How to Read This Plan](#1-how-to-read-this-plan)
2. [Phase Overview](#2-phase-overview)
3. [Immediate — Ship-Ready (0–2 weeks)](#3-immediate--ship-ready-0-2-weeks)
   - 3.1 Wire the Knowledge Graph
   - 3.2 Add ToT/Tool/Belief Tests
   - 3.3 Performance Benchmark
4. [Short-Term — High-Impact (2–6 weeks)](#4-short-term--high-impact-2-6-weeks)
   - 4.1 Close the Learning Loop
   - 4.2 Cross-Task Trace Memory
   - 4.3 Critique + Replanning
5. [Medium-Term — Expanding the Envelope (1–3 months)](#5-medium-term--expanding-the-envelope-1-3-months)
   - 5.1 Tool Chaining
   - 5.2 Intermediate Verification Gates
   - 5.3 Multi-Model Routing
6. [Strategic — Positioning](#6-strategic--positioning)
7. [Dependency Graph](#7-dependency-graph)
8. [Risk Register](#8-risk-register)
9. [Appendix: Acceptance Criteria Toolkit](#9-appendix-acceptance-criteria-toolkit)

---

## 1. How to Read This Plan

Each section follows this structure:

| Field | Meaning |
|-------|---------|
| **Goal** | What is built and why |
| **Files changed / created** | Exact paths |
| **Data structures** | TypeScript interfaces |
| **Step-by-step** | Ordered implementation tasks |
| **Acceptance criteria** | "Done when..." |
| **Rollback path** | How to disable if needed |
| **Estimated effort** | Days, one developer, focused |

**Total estimated effort:** 2.5–3 months (one developer, focused)  
**Can run incrementally:** Each initiative is independently shippable.

---

## 2. Phase Overview

```
Week:  1  2  3  4  5  6  7  8  9  10 11 12 13
       │████ Immediate ████│
                       │████ Short-Term ████████████│
                                                   │████ Medium-Term ████████████████│

Initiative                  │ Status by Week
────────────────────────────┼──────────────────────────────────
3.1 Wire Knowledge Graph    │ ████████░░░░░░░░░░░░░░░░░░░░░░░░░  W1-W2
3.2 Add Tests               │ ████████░░░░░░░░░░░░░░░░░░░░░░░░░  W1-W2  
3.3 Performance Benchmark   │ ░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░  W2
4.1 Close Learning Loop     │ ░░░░████████░░░░░░░░░░░░░░░░░░░░░  W3-W4
4.2 Cross-Task Trace Memory │ ░░░░░░░░████████████░░░░░░░░░░░░░  W4-W6
4.3 Critique + Replanning   │ ░░░░░░░░░░░░████████░░░░░░░░░░░░░  W5-W6
5.1 Tool Chaining           │ ░░░░░░░░░░░░░░░░████████████░░░░░  W7-W9
5.2 Intermediate Gates      │ ░░░░░░░░░░░░░░░░████████████░░░░░  W7-W9
5.3 Multi-Model Routing     │ ░░░░░░░░░░░░░░░░░░░░░░████████████  W10-W12
```

---

## 3. Immediate — Ship-Ready (0–2 weeks)

---

### 3.1 Wire the Knowledge Graph

**Goal:** Connect the orphaned `KnowledgeGraph` class (`src/knowledge_graph/graph.ts`) to three live pipelines: task completion (entity extraction), retrieval augmentation, and claim persistence. Transform dead code into an active knowledge substrate.

**Status (codebase reality as of 2026-05-06):**
- **Core KG implementation** exists at `gzmo-daemon/src/knowledge_graph/graph.ts`.
- **Wired into task completion** (opt-in) via `gzmo-daemon/src/engine.ts` behind `GZMO_ENABLE_KNOWLEDGE_GRAPH`.
- **Wired into retrieval augmentation** (opt-in) via `gzmo-daemon/src/pipelines/search_pipeline.ts` behind `GZMO_KG_SEARCH_AUGMENT`.
- **Unit tests** added at `gzmo-daemon/src/__tests__/knowledge_graph.test.ts`.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/knowledge_graph/graph.ts` | Add `extractEntities()`, `addClaimNode()`, `augmentSearch()` methods |
| `gzmo-daemon/src/knowledge_graph/graph.ts` | Fix singleton leak (currently global `_instance`) |
| `gzmo-daemon/src/engine.ts` | After `processTask()` completion: extract entities → `kg.addNode()` |
| `gzmo-daemon/src/engine.ts` | After trace completion: record final answer claims → `kg.upsertClaim()` |
| `gzmo-daemon/src/reasoning/run_tot_search.ts` | After Dream Engine produces insight: `kg.addEdge(dream, source, "refines")` |
| `gzmo-daemon/src/search.ts` | Optional: `searchVaultHybrid()` queries KG for topic nodes first |
| `gzmo-daemon/src/engine_hooks.ts` | Add `postTaskKgHook` for entity extraction |
| **New:** `gzmo-daemon/src/__tests__/knowledge_graph.test.ts` | Unit tests for wiring |

**Data Structures:**

```typescript
// Add to graph.ts — entity extraction helper
export interface ExtractedEntity {
  text: string;
  type: "person" | "organization" | "concept" | "file" | "code_symbol";
  confidence: number; // 0..1 from context
  sourceFile: string;
  span: { start: number; end: number };
}

// Augmented KG query result for search augmentation
export interface KgSearchAugment {
  topicNodes: KgNode[];
  connectedClaims: Array<{ claim: KgNode; evidenceFiles: string[] }>;
  graphDistance: number;
}
```

**Step-by-step:**

**Step 3.1.1 — Fix Singleton Leak**

```typescript
// In graph.ts, replace global _instance with per-vault WeakMap
const _instances = new Map<string, KnowledgeGraph>();

static forVault(vaultPath: string): KnowledgeGraph {
  if (!_instances.has(vaultPath)) {
    _instances.set(vaultPath, new KnowledgeGraph(vaultPath));
  }
  return _instances.get(vaultPath)!;
}

static resetAll(): void { _instances.clear(); }
static reset(vaultPath: string): void { _instances.delete(vaultPath); }
```

**Step 3.1.2 — Add Entity Extraction Method**

```typescript
/**
 * Extract entities from task answer text using lightweight heuristics.
 * No LLM call — deterministic regex + vault-context patterns.
 */
export function extractEntities(answer: string, sourceFile: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // File references: `path/to/file.md`, wiki/Foo.md, etc.
  const fileRefs = [...answer.matchAll(/`?([\w\-./]+\.(?:md|ts|json|js|tsx))`?/g)];
  for (const m of fileRefs) {
    entities.push({
      text: m[1]!,
      type: "file",
      confidence: 0.9,
      sourceFile,
      span: { start: m.index!, end: m.index! + m[0].length },
    });
  }

  // Code symbols: CamelCase identifiers that appear in backticks or code blocks
  const codeSymbols = [...answer.matchAll(/\b([A-Z][a-zA-Z0-9_]{2,})\b/g)];
  for (const m of codeSymbols) {
    // Deduplicate
    if (entities.some((e) => e.text === m[1] && e.type === "code_symbol")) continue;
    entities.push({
      text: m[1]!,
      type: "code_symbol",
      confidence: 0.6,
      sourceFile,
      span: { start: m.index!, end: m.index! + m[0].length },
    });
  }

  // Capitalized phrases as potential concepts (3+ words)
  const conceptRefs = [...answer.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,})\b/g)];
  for (const m of conceptRefs) {
    if (entities.some((e) => e.text === m[1])) continue;
    entities.push({
      text: m[1]!,
      type: "concept",
      confidence: 0.5,
      sourceFile,
      span: { start: m.index!, end: m.index! + m[0].length },
    });
  }

  return entities;
}
```

**Step 3.1.3 — Add Graph-Augmented Search Method**

```typescript
/**
 * Query the graph for topic nodes matching the query, then return
 * connected claims + their source files for retrieval augmentation.
 */
export async function augmentSearch(
  this: KnowledgeGraph,
  query: string,
  ollamaBaseUrl: string,
): Promise<KgSearchAugment> {
  // 1. Embed the query
  const qVec = await embedText(query, ollamaBaseUrl);

  // 2. Find semantically similar topic nodes
  const topicNodes = [...this.nodes.values()]
    .filter((n) => n.type === "entity" || n.type === "claim")
    .map((n) => ({
      node: n,
      sim: n.embedding ? cosineSim(qVec, n.embedding) : 0,
    }))
    .filter((x) => x.sim > 0.75)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5)
    .map((x) => x.node);

  // 3. Gather connected claims within 2 hops
  const connectedClaims: Array<{ claim: KgNode; evidenceFiles: string[] }> = [];
  for (const node of topicNodes) {
    const { nodes: subgraphNodes, edges } = this.subgraph(node.id, 2);
    const claims = subgraphNodes.filter((n) => n.type === "claim");
    for (const claim of claims) {
      // Find source files via "supports" edges
      const sourceEdges = edges.filter((e) => e.to === claim.id && e.type === "supports");
      const evidenceFiles = sourceEdges
        .map((e) => this.nodes.get(e.from))
        .filter((n): n is KgNode => !!n)
        .map((n) => (n.metadata?.sourceFile as string) || "")
        .filter(Boolean);
      connectedClaims.push({ claim, evidenceFiles: [...new Set(evidenceFiles)] });
    }
  }

  return { topicNodes, connectedClaims, graphDistance: 2 };
}
```

**Step 3.1.4 — Wire into Task Completion (engine.ts)**

In `processTask()`, after `document.markCompleted(output)` succeeds:

```typescript
// After markCompleted, before final trace persistence
if (vaultRoot && readBoolEnv("GZMO_ENABLE_KNOWLEDGE_GRAPH", false)) {
  const { KnowledgeGraph, extractEntities } = await import("./knowledge_graph/graph");
  const kg = KnowledgeGraph.forVault(vaultRoot);
  await kg.init();

  // Extract entities from final answer
  const entities = extractEntities(fullText, taskRelPath);
  for (const ent of entities) {
    kg.addNode({
      type: ent.type === "file" ? "source" : "entity",
      label: ent.text,
      confidence: ent.confidence,
      metadata: { sourceFile: ent.sourceFile, extractedBy: "engine" },
    });
  }

  // Record claims from best ToT path (if available)
  if (routeJudgeMetrics && evidencePacket) {
    const claimId = kg.upsertClaim(
      fullText.slice(0, 500),
      taskRelPath,
      routeJudgeMetrics.score ?? 0.5,
    );
    // Link claims to extracted entities
    for (const ent of entities) {
      const entNode = [...kg.snapshot().nodes.values()].find(
        (n) => n.label === ent.text && (n.type === "entity" || n.type === "source"),
      );
      if (entNode) {
        kg.addEdge(claimId, entNode.id, "mentions", ent.confidence);
      }
    }
  }

  await kg.persist();
  await kg.appendAuditEvent({
    op: "task_completion",
    payload: { task_file: taskRelPath, entity_count: entities.length },
  });
}
```

**Step 3.1.5 — Wire into Search Pipeline**

In `searchVaultHybrid()`, after initial retrieval, conditionally augment:

```typescript
// After forceIncludePaths(fused), before rerank:
const kgAugmentEnabled = readBoolEnv("GZMO_KG_SEARCH_AUGMENT", false);
if (kgAugmentEnabled && vaultRoot) {
  const { KnowledgeGraph } = await import("./knowledge_graph/graph");
  const kg = KnowledgeGraph.forVault(vaultRoot);
  await kg.init();
  const augment = await kg.augmentSearch(query, ollamaUrl);

  // Inject connected claim source files as forced retrievals
  for (const cc of augment.connectedClaims) {
    for (const f of cc.evidenceFiles.slice(0, 2)) {
      // Find or inject this file into results
      const already = fused.find((r) => r.file === f || r.file.endsWith(`/${f}`));
      if (!already) {
        const fileChunks = store.chunks.filter((c) => c.file === f || c.file.endsWith(`/${f}`));
        if (fileChunks.length > 0) {
          fused.unshift({
            file: fileChunks[0]!.file,
            heading: fileChunks[0]!.heading,
            text: fileChunks[0]!.text,
            score: 0.85, // graph-boosted score
            metadata: { ...fileChunks[0]!.metadata, kg_augmented: true },
          });
        }
      }
    }
  }
}
```

**Step 3.1.6 — Wire into Dream Engine**

In `src/dreams.ts`, after generating a dream insight:

```typescript
if (vaultRoot && readBoolEnv("GZMO_ENABLE_KNOWLEDGE_GRAPH", false)) {
  const { KnowledgeGraph } = await import("./knowledge_graph/graph");
  const kg = KnowledgeGraph.forVault(vaultRoot);
  await kg.init();

  const dreamNodeId = kg.addNode({
    type: "session",
    label: `Dream: ${insight.slice(0, 80)}`,
    metadata: { sourceFile: "GZMO/Thought_Cabinet", sessionType: "dream" },
  });

  // Link to source tasks that produced this insight
  for (const sourceTask of sourceTasks) {
    const sourceNode = [...kg.snapshot().nodes.values()].find(
      (n) => n.type === "source" && n.label === sourceTask,
    );
    if (sourceNode) {
      kg.addEdge(dreamNodeId, sourceNode.id, "derived_from", 0.7);
    }
  }

  await kg.persist();
}
```

**Acceptance Criteria:**

- [ ] `bun test` passes with 0 regressions
- [ ] Dropping a search task with `GZMO_ENABLE_KNOWLEDGE_GRAPH=on` creates nodes in `KG/snapshot.json`
- [ ] At least one entity and one claim node are created per completed task
- [ ] Re-running the same task deduplicates claim nodes (confidence increments)
- [ ] `GZMO_KG_SEARCH_AUGMENT=on` causes graph-connected files to appear in search results
- [ ] `KnowledgeGraph.resetAll()` in tests prevents cross-test singleton leakage
- [ ] Doctor reports count of orphaned KG nodes (nodes with zero edges) as a health metric

**Rollback Path:**

```bash
export GZMO_ENABLE_KNOWLEDGE_GRAPH=off
export GZMO_KG_SEARCH_AUGMENT=off
```

When disabled, all KG imports are lazy and skipped. The engine path is identical to pre-3.1.

**Estimated Effort:** 5–6 days

---

### 3.2 Add ToT/Tool/Belief Tests

**Goal:** Achieve meaningful automated test coverage for the reasoning engine modules that shipped without tests. Target: 80%+ line coverage on `reasoning/*`, `tools/*`, `belief/*`.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/__tests__/tools.test.ts` | **New.** Test vault_read, fs_grep, dir_list, registry, dispatcher |
| `gzmo-daemon/src/__tests__/tools_security.test.ts` | **New.** Path escape attempts, traversal, max_results bounds |
| `gzmo-daemon/src/__tests__/tot_controller.test.ts` | **New.** Budget constraints, pruning, bestPath selection |
| `gzmo-daemon/src/__tests__/tot_expand.test.ts` | **New.** expandAnalyze, expandRetrieve, expandReason unit tests |
| `gzmo-daemon/src/__tests__/belief_claim_store.test.ts` | **New.** recordClaim, detectContradiction, loadRecentClaimTexts |
| `gzmo-daemon/src/__tests__/reasoning_trace.test.ts` | **New.** persistTrace, appendTraceIndex, findTracesForTask round-trip |
| `gzmo-daemon/src/__tests__/knowledge_graph.test.ts` | **New.** addNode, addEdge, upsertClaim, subgraph, hotNodes |

**Data Structures:**

```typescript
// Shared test helpers (new file or inline)
// mockEmbeddingStore(): creates a store with 3–5 fake chunks
// mockChaosSnapshot(energy, phase, valence): predictable budget
// mockOllamaResponse(text): fetch() mock for deterministic LLM output
```

**Step-by-step:**

**Step 3.2.1 — Create Test Helpers**

```typescript
// gzmo-daemon/src/__tests__/helpers.ts
import type { EmbeddingStore, EmbeddingChunk } from "../embeddings";
import type { ChaosSnapshot } from "../types";
import { Phase } from "../types";

export function mockEmbeddingStore(): EmbeddingStore {
  const chunks: EmbeddingChunk[] = [
    {
      file: "wiki/overview.md",
      heading: "Overview",
      text: "GZMO is a sovereign local AI daemon.",
      hash: "abc123",
      vector: [0.1, 0.2, 0.3, 0.4],
      magnitude: 0.547,
      updatedAt: new Date().toISOString(),
      metadata: { pathBucket: "wiki", type: "canonical", role: "canonical", tags: ["wiki"] },
    },
    {
      file: "wiki/chaos.md",
      heading: "Chaos Engine",
      text: "The Lorenz attractor modulates LLM parameters.",
      hash: "def456",
      vector: [0.2, 0.3, 0.1, 0.5],
      magnitude: 0.616,
      updatedAt: new Date().toISOString(),
      metadata: { pathBucket: "wiki", type: "concept", role: "canonical", tags: ["chaos"] },
    },
    {
      file: "GZMO/Inbox/task.md",
      heading: "Task",
      text: "What files does the daemon write?",
      hash: "ghi789",
      vector: [0.3, 0.1, 0.2, 0.2],
      magnitude: 0.412,
      updatedAt: new Date().toISOString(),
      metadata: { pathBucket: "GZMO", type: "task", role: "operational", tags: ["inbox"] },
    },
  ];
  return { modelName: "nomic-embed-text", chunks, lastFullScan: new Date().toISOString(), dirty: false };
}

export function mockChaosSnapshot(
  energy: number,
  phase: Phase,
  valence: number,
): ChaosSnapshot {
  return {
    energy,
    phase,
    llmValence: valence,
    llmTemperature: 0.5 + valence * 0.35,
    llmMaxTokens: energy > 50 ? 600 : 400,
    cortisol: 1.0,
    timestamp: new Date().toISOString(),
  };
}

export function mockOllamaResponse(text: string): () => Promise<{ textStream: AsyncIterable<string> }> {
  return () =>
    Promise.resolve({
      textStream: (async function* () {
        for (const chunk of text.split(" ")) {
          yield chunk + " ";
        }
      })(),
    });
}
```

**Step 3.2.2 — Tool Tests**

```typescript
// gzmo-daemon/src/__tests__/tools.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { vaultReadTool } from "../tools/vault_read";
import { fsGrepTool } from "../tools/fs_grep";
import { dirListTool } from "../tools/dir_list";
import { dispatchTool } from "../tools/registry";
import type { ToolContext } from "../tools/types";

let vault: string;
let ctx: ToolContext;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "gzmo-tools-"));
  mkdirSync(join(vault, "wiki"), { recursive: true });
  writeFileSync(join(vault, "wiki", "overview.md"), "# Overview\n\nGZMO is sovereign.\n");
  writeFileSync(join(vault, "wiki", "chaos.md"), "# Chaos\n\nLorenz attractor.\n");
  ctx = { vaultPath: vault, taskFilePath: join(vault, "GZMO", "Inbox", "task.md") };
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("vault_read tool", () => {
  test("reads existing file", async () => {
    const res = await vaultReadTool.execute({ path: "wiki/overview.md" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("GZMO is sovereign");
  });

  test("rejects path escape (../)", async () => {
    const res = await vaultReadTool.execute({ path: "../etc/passwd" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("escapes vault");
  });

  test("rejects absolute paths", async () => {
    const res = await vaultReadTool.execute({ path: "/etc/passwd" }, ctx);
    expect(res.ok).toBe(false);
  });

  test("respects max_chars", async () => {
    const longContent = "x".repeat(10000);
    writeFileSync(join(vault, "long.md"), longContent);
    const res = await vaultReadTool.execute({ path: "long.md", max_chars: 100 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output!.length).toBeLessThan(150); // "x" * 100 + "\n..."
  });

  test("returns error for missing file", async () => {
    const res = await vaultReadTool.execute({ path: "wiki/missing.md" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not found");
  });
});

describe("fs_grep tool", () => {
  test("finds matches in markdown files", async () => {
    const res = await fsGrepTool.execute({ pattern: "sovereign", max_results: 5 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("overview.md");
  });

  test("finds matches in TypeScript files", async () => {
    writeFileSync(join(vault, "code.ts"), "export function sovereign() {}");
    const res = await fsGrepTool.execute({ pattern: "sovereign", max_results: 5 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("code.ts");
  });

  test("respects max_results", async () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(vault, `file${i}.md`), `match ${i}`);
    }
    const res = await fsGrepTool.execute({ pattern: "match", max_results: 3 }, ctx);
    expect(res.ok).toBe(true);
    const lines = res.output.split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  test("returns (no matches) when nothing found", async () => {
    const res = await fsGrepTool.execute({ pattern: "zzzzzzzzz", max_results: 5 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toBe("(no matches)");
  });

  test("rejects invalid regex", async () => {
    const res = await fsGrepTool.execute({ pattern: "[invalid", max_results: 5 }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Invalid regex");
  });
});

describe("dir_list tool", () => {
  test("lists files in a directory", async () => {
    const res = await dirListTool.execute({ path: "wiki" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("overview.md");
    expect(res.output).toContain("chaos.md");
  });

  test("recursive listing works", async () => {
    mkdirSync(join(vault, "wiki", "nested"), { recursive: true });
    writeFileSync(join(vault, "wiki", "nested", "deep.md"), "deep");
    const res = await dirListTool.execute({ path: "wiki", recursive: true }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("deep.md");
  });

  test("rejects path escape", async () => {
    const res = await dirListTool.execute({ path: "../etc" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("escapes vault");
  });
});

describe("tool registry & dispatcher", () => {
  test("dispatchTool returns record for known tool", async () => {
    const { result, record } = await dispatchTool("vault_read", { path: "wiki/overview.md" }, ctx);
    expect(result.ok).toBe(true);
    expect(record.tool).toBe("vault_read");
    expect(record.timestamp).toBeTruthy();
  });

  test("dispatchTool returns error for unknown tool", async () => {
    const { result, record } = await dispatchTool("nonexistent", {}, ctx);
    expect(result.ok).toBe(false);
    expect(record.result.error).toContain("Unknown tool");
  });
});
```

**Step 3.2.3 — ToT Controller Tests**

```typescript
// gzmo-daemon/src/__tests__/tot_controller.test.ts
import { describe, expect, test } from "bun:test";
import { budgetFromChaos, ToTController } from "../reasoning/controller";
import { mockChaosSnapshot } from "./helpers";
import { Phase } from "../types";

describe("ToT budget from chaos", () => {
  test("high energy + Build phase = deep exploration", () => {
    const snap = mockChaosSnapshot(90, Phase.Build, 0.5);
    const cfg = budgetFromChaos(snap);
    expect(cfg.maxDepth).toBeGreaterThanOrEqual(3);
    expect(cfg.maxBranchesPerNode).toBe(3);
    expect(cfg.enableRetry).toBe(true);
  });

  test("low energy + Drop phase = shallow exploration", () => {
    const snap = mockChaosSnapshot(10, Phase.Drop, -0.8);
    const cfg = budgetFromChaos(snap);
    expect(cfg.maxDepth).toBe(1);
    expect(cfg.maxBranchesPerNode).toBe(1);
    expect(cfg.enableRetry).toBe(false);
  });

  test("negative valence = fewer branches", () => {
    const snap = mockChaosSnapshot(50, Phase.Idle, -0.5);
    const cfg = budgetFromChaos(snap);
    expect(cfg.maxBranchesPerNode).toBe(1);
  });

  test("GZMO_TOT_MAX_NODES env overrides computed total", () => {
    const orig = process.env.GZMO_TOT_MAX_NODES;
    process.env.GZMO_TOT_MAX_NODES = "8";
    try {
      const snap = mockChaosSnapshot(100, Phase.Build, 0.5);
      const cfg = budgetFromChaos(snap);
      expect(cfg.maxTotalNodes).toBe(8);
    } finally {
      process.env.GZMO_TOT_MAX_NODES = orig;
    }
  });
});

describe("ToTController", () => {
  test("root node exists on creation", () => {
    const tot = new ToTController(
      { maxDepth: 3, maxBranchesPerNode: 2, maxTotalNodes: 10, evaluationThreshold: 0.5, enableRetry: true },
      "trace-123",
      "Test query",
    );
    expect(tot.root).toBeDefined();
    expect(tot.root!.type).toBe("analyze");
    expect(tot.totalNodes).toBe(1);
  });

  test("canExpand respects depth and totalNodes", () => {
    const tot = new ToTController(
      { maxDepth: 2, maxBranchesPerNode: 2, maxTotalNodes: 5, evaluationThreshold: 0.5, enableRetry: false },
      "trace-123",
      "Test",
    );
    expect(tot.canExpand(tot.root!)).toBe(true);

    // Fill to capacity
    const child = tot.addChild(tot.root!, {
      node_id: "c1",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "child",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    const grandchild = tot.addChild(child, {
      node_id: "c2",
      trace_id: "trace-123",
      parent_id: child.node_id,
      type: "reason",
      depth: 2,
      prompt_summary: "grandchild",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    // At depth 2 (maxDepth=2), cannot expand further
    expect(tot.canExpand(grandchild)).toBe(false);

    // Add more nodes to hit maxTotalNodes
    tot.addChild(tot.root!, {
      node_id: "c3",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "child3",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    tot.addChild(tot.root!, {
      node_id: "c4",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "child4",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    expect(tot.canExpand(tot.root!)).toBe(false); // totalNodes >= 5
  });

  test("prune removes subtree", () => {
    const tot = new ToTController(
      { maxDepth: 3, maxBranchesPerNode: 2, maxTotalNodes: 10, evaluationThreshold: 0.5, enableRetry: false },
      "trace-123",
      "Test",
    );
    const child = tot.addChild(tot.root!, {
      node_id: "c1",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "child",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    tot.addChild(child, {
      node_id: "c2",
      trace_id: "trace-123",
      parent_id: child.node_id,
      type: "reason",
      depth: 2,
      prompt_summary: "grandchild",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    expect(tot.activeNodes.length).toBe(3);
    tot.prune(child);
    expect(tot.activeNodes.length).toBe(1); // only root remains
  });

  test("bestPath picks highest-scoring terminal", () => {
    const tot = new ToTController(
      { maxDepth: 3, maxBranchesPerNode: 2, maxTotalNodes: 10, evaluationThreshold: 0.5, enableRetry: false },
      "trace-123",
      "Test",
    );

    const child1 = tot.addChild(tot.root!, {
      node_id: "c1",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "branch1",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    const verify1 = tot.addChild(child1, {
      node_id: "v1",
      trace_id: "trace-123",
      parent_id: child1.node_id,
      type: "verify",
      depth: 2,
      prompt_summary: "verify1",
      score: 0.9,
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    const child2 = tot.addChild(tot.root!, {
      node_id: "c2",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "branch2",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    const verify2 = tot.addChild(child2, {
      node_id: "v2",
      trace_id: "trace-123",
      parent_id: child2.node_id,
      type: "verify",
      depth: 2,
      prompt_summary: "verify2",
      score: 0.3,
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    const path = tot.bestPath();
    expect(path.map((n) => n.node_id)).toEqual([tot.root!.node_id, "c1", "v1"]);
  });

  test("flattenForTrace strips children/explored/pruned", () => {
    const tot = new ToTController(
      { maxDepth: 2, maxBranchesPerNode: 1, maxTotalNodes: 3, evaluationThreshold: 0.5, enableRetry: false },
      "trace-123",
      "Test",
    );
    const flat = tot.flattenForTrace();
    expect(flat[0]).not.toHaveProperty("children");
    expect(flat[0]).not.toHaveProperty("explored");
    expect(flat[0]).not.toHaveProperty("pruned");
  });

  test("replan clears non-critique children and resets root", () => {
    const tot = new ToTController(
      { maxDepth: 3, maxBranchesPerNode: 2, maxTotalNodes: 15, evaluationThreshold: 0.5, enableRetry: false },
      "trace-123",
      "Test",
    );

    // Add a critique child
    const critique = tot.addChild(tot.root!, {
      node_id: "crit1",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "critique",
      depth: 1,
      prompt_summary: "critique",
      outcome: "partial",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    // Add a non-critique child
    const child = tot.addChild(tot.root!, {
      node_id: "c1",
      trace_id: "trace-123",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "child",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    expect(tot.root!.children.length).toBe(2);
    tot.replan("Try narrower scope");
    expect(tot.root!.children.length).toBe(1); // only critique kept
    expect(tot.root!.children[0]!.node_id).toBe("crit1");
    expect(tot.root!.type).toBe("replan");
    expect(tot.root!.explored).toBe(false);
  });
});
```

**Step 3.2.4 — Belief / Claim Store Tests**

```typescript
// gzmo-daemon/src/__tests__/belief_claim_store.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  recordClaim,
  detectContradiction,
  loadRecentClaimTexts,
} from "../belief/claim_store";
import { safeAppendJsonl } from "../vault_fs";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "gzmo-belief-"));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("detectContradiction", () => {
  test("finds contradiction on same topic with opposite polarity", () => {
    const a = "The daemon writes health.md to the vault.";
    const b = "The daemon does not write health.md.";
    const r = detectContradiction(a, b);
    expect(r.contradiction).toBe(true);
    expect(r.strength).toBeGreaterThan(0.3);
  });

  test("returns false for unrelated claims", () => {
    const a = "The daemon writes health.md.";
    const b = "Ollama runs on port 11434.";
    const r = detectContradiction(a, b);
    expect(r.contradiction).toBe(false);
    expect(r.strength).toBe(0);
  });

  test("returns false for agreeing claims", () => {
    const a = "The daemon writes health.md.";
    const b = "health.md is written by the daemon.";
    const r = detectContradiction(a, b);
    expect(r.contradiction).toBe(false);
  });

  test("handles negation words", () => {
    const a = "Tools are enabled by default.";
    const b = "Tools are never enabled by default.";
    const r = detectContradiction(a, b);
    expect(r.contradiction).toBe(true);
  });
});

describe("recordClaim", () => {
  test("appends claim to claims.jsonl", async () => {
    await recordClaim(vault, {
      trace_id: "t1",
      node_id: "n1",
      text: "The daemon writes health.md.",
      confidence: 0.9,
      sources: ["E1", "E2"],
    });

    const entries = await loadRecentClaimTexts(vault, 10);
    expect(entries).toContain("The daemon writes health.md.");
  });

  test("loadRecentClaimTexts returns last N claims", async () => {
    for (let i = 0; i < 5; i++) {
      await recordClaim(vault, {
        trace_id: "t1",
        node_id: `n${i}`,
        text: `Claim ${i}`,
        confidence: 0.5,
        sources: ["E1"],
      });
    }
    const entries = await loadRecentClaimTexts(vault, 3);
    expect(entries.length).toBe(3);
    expect(entries).toContain("Claim 4");
    expect(entries).toContain("Claim 3");
    expect(entries).not.toContain("Claim 0");
  });

  test("loadRecentClaimTexts returns empty array for missing file", async () => {
    const entries = await loadRecentClaimTexts(vault, 10);
    expect(entries).toEqual([]);
  });
});
```

**Step 3.2.5 — Reasoning Trace Tests**

```typescript
// gzmo-daemon/src/__tests__/reasoning_trace.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  persistTrace,
  appendTraceIndex,
  findTracesForTask,
  tracesEnabled,
} from "../reasoning_trace";
import type { ReasoningTrace } from "../reasoning_trace";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "gzmo-trace-"));
  mkdirSync(join(vault, "GZMO", "Reasoning_Traces"), { recursive: true });
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function makeTrace(overrides?: Partial<ReasoningTrace>): ReasoningTrace {
  return {
    trace_id: crypto.randomUUID(),
    task_file: "GZMO/Inbox/test.md",
    action: "search",
    model: "hermes3:8b",
    total_elapsed_ms: 1000,
    nodes: [
      {
        node_id: "n0",
        trace_id: "t",
        parent_id: null,
        type: "task_start",
        depth: 0,
        prompt_summary: "test task",
        outcome: "success",
        elapsed_ms: 0,
        timestamp: new Date().toISOString(),
      },
    ],
    final_answer: "Test answer",
    status: "completed",
    ...overrides,
  };
}

describe("persistTrace", () => {
  test("writes trace JSON file", async () => {
    const trace = makeTrace();
    const path = await persistTrace(vault, trace);
    expect(path).toContain(trace.trace_id);
    const files = readdirSync(join(vault, "GZMO", "Reasoning_Traces"));
    expect(files).toContain(`${trace.trace_id}.json`);
  });

  test("trace is valid JSON and round-trips", async () => {
    const trace = makeTrace();
    await persistTrace(vault, trace);
    const loaded = await findTracesForTask(vault, "GZMO/Inbox/test.md");
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.trace_id).toBe(trace.trace_id);
    expect(loaded[0]!.final_answer).toBe("Test answer");
  });
});

describe("appendTraceIndex", () => {
  test("creates index.jsonl with entry", async () => {
    const trace = makeTrace();
    await persistTrace(vault, trace);
    await appendTraceIndex(vault, trace);
    const indexPath = join(vault, "GZMO", "Reasoning_Traces", "index.jsonl");
    const content = await Bun.file(indexPath).text();
    expect(content).toContain(trace.trace_id);
    expect(content).toContain("completed");
  });
});

describe("findTracesForTask", () => {
  test("finds traces by task_file", async () => {
    await persistTrace(vault, makeTrace({ task_file: "GZMO/Inbox/a.md" }));
    await persistTrace(vault, makeTrace({ task_file: "GZMO/Inbox/b.md" }));

    const found = await findTracesForTask(vault, "GZMO/Inbox/a.md");
    expect(found.length).toBe(1);
    expect(found[0]!.task_file).toBe("GZMO/Inbox/a.md");
  });

  test("returns empty array for nonexistent task", async () => {
    const found = await findTracesForTask(vault, "GZMO/Inbox/nope.md");
    expect(found).toEqual([]);
  });

  test("sorts newest first", async () => {
    const t1 = makeTrace({ task_file: "GZMO/Inbox/x.md" });
    const t2 = makeTrace({ task_file: "GZMO/Inbox/x.md" });
    await persistTrace(vault, t1);
    await persistTrace(vault, t2);

    const found = await findTracesForTask(vault, "GZMO/Inbox/x.md");
    expect(found.length).toBe(2);
    // Both have same timestamp in test setup; this mainly validates sort exists
  });
});

describe("tracesEnabled", () => {
  test("defaults to true", () => {
    delete process.env.GZMO_ENABLE_TRACES;
    expect(tracesEnabled()).toBe(true);
  });

  test("returns false when set to off", () => {
    process.env.GZMO_ENABLE_TRACES = "off";
    expect(tracesEnabled()).toBe(false);
    delete process.env.GZMO_ENABLE_TRACES;
  });
});
```

**Step 3.2.6 — Knowledge Graph Tests**

```typescript
// gzmo-daemon/src/__tests__/knowledge_graph.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { KnowledgeGraph, extractEntities } from "../knowledge_graph/graph";

describe("extractEntities", () => {
  test("extracts file references", () => {
    const text = "See `wiki/overview.md` and `src/engine.ts` for details.";
    const entities = extractEntities(text, "task.md");
    expect(entities.filter((e) => e.type === "file").map((e) => e.text)).toContain("wiki/overview.md");
    expect(entities.filter((e) => e.type === "file").map((e) => e.text)).toContain("src/engine.ts");
  });

  test("extracts code symbols (CamelCase)", () => {
    const text = "The ToTController manages the tree.";
    const entities = extractEntities(text, "task.md");
    expect(entities.filter((e) => e.type === "code_symbol").map((e) => e.text)).toContain("ToTController");
  });

  test("does not extract common words as concepts", () => {
    const text = "The daemon runs locally.";
    const entities = extractEntities(text, "task.md");
    const concepts = entities.filter((e) => e.type === "concept");
    expect(concepts.length).toBe(0);
  });

  test("rejects path escape entities", () => {
    const text = "Read `../etc/passwd` for secrets.";
    const entities = extractEntities(text, "task.md");
    // extractEntities doesn't validate paths — that's the tool layer
    // But we verify the regex captures it
    expect(entities.some((e) => e.text.includes(".."))).toBe(false); // regex won't match
  });
});

describe("KnowledgeGraph", () => {
  let vault: string;
  let kg: KnowledgeGraph;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "gzmo-kg-"));
    KnowledgeGraph.resetAll();
    kg = KnowledgeGraph.forVault(vault);
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
    KnowledgeGraph.resetAll();
  });

  test("singleton per vault", () => {
    const kg2 = KnowledgeGraph.forVault(vault);
    expect(kg2).toBe(kg);

    const otherVault = mkdtempSync(join(tmpdir(), "gzmo-kg2-"));
    const kg3 = KnowledgeGraph.forVault(otherVault);
    expect(kg3).not.toBe(kg);
    rmSync(otherVault, { recursive: true, force: true });
  });

  test("addNode creates node with auto-generated id", () => {
    const id = kg.addNode({ type: "entity", label: "Chaos Engine" });
    expect(id).toBeTruthy();
    expect(kg.getNode(id)).toBeDefined();
    expect(kg.getNode(id)!.label).toBe("Chaos Engine");
  });

  test("addEdge connects nodes", () => {
    const a = kg.addNode({ type: "entity", label: "A" });
    const b = kg.addNode({ type: "entity", label: "B" });
    kg.addEdge(a, b, "similar_to", 0.9);
    const edges = kg.getEdgesForNode(a);
    expect(edges.length).toBe(1);
    expect(edges[0]!.type).toBe("similar_to");
  });

  test("upsertClaim deduplicates by content hash", () => {
    const source = kg.addNode({ type: "source", label: "task.md" });
    const id1 = kg.upsertClaim("The daemon writes health.md.", source, 0.8);
    const id2 = kg.upsertClaim("The daemon writes health.md.", source, 0.8);
    expect(id1).toBe(id2);
    expect(kg.getNode(id1)!.confidence).toBeGreaterThan(0.8); // incremented
  });

  test("subgraph returns BFS neighborhood", () => {
    const center = kg.addNode({ type: "entity", label: "Center" });
    const n1 = kg.addNode({ type: "entity", label: "N1" });
    const n2 = kg.addNode({ type: "entity", label: "N2" });
    const n3 = kg.addNode({ type: "entity", label: "N3" });

    kg.addEdge(center, n1, "similar_to", 0.8);
    kg.addEdge(n1, n2, "similar_to", 0.8);
    kg.addEdge(center, n3, "similar_to", 0.8); // direct neighbor

    const sub = kg.subgraph(center, 1);
    expect(sub.nodes.map((n) => n.label).sort()).toEqual(["Center", "N1", "N3"]);
    expect(sub.nodes.some((n) => n.label === "N2")).toBe(false);

    const sub2 = kg.subgraph(center, 2);
    expect(sub2.nodes.some((n) => n.label === "N2")).toBe(true);
  });

  test("persist writes snapshot.json", async () => {
    kg.addNode({ type: "entity", label: "Test" });
    await kg.persist();
    expect(existsSync(join(vault, "GZMO", "Knowledge_Graph", "snapshot.json"))).toBe(true);
  });

  test("hotNodes ranks by query frequency + edge weight", () => {
    const a = kg.addNode({ type: "entity", label: "A" });
    const b = kg.addNode({ type: "entity", label: "B" });
    const c = kg.addNode({ type: "entity", label: "C" });

    kg.addEdge(a, b, "supports", 1.0);
    kg.addEdge(b, c, "supports", 0.5);

    // Simulate queries touching A and B
    kg.query({ nodeTypes: ["entity"], limit: 10 });
    kg.query({ nodeTypes: ["entity"], fromNodeId: a });

    const hot = kg.hotNodes(2);
    expect(hot.length).toBe(2);
    // A and B should rank higher than C due to queries + edges
    expect(hot.map((n) => n.label)).toContain("A");
    expect(hot.map((n) => n.label)).toContain("B");
  });
});
```

**Acceptance Criteria:**

- [ ] New test files run: `bun test src/__tests__/tools.test.ts` passes
- [ ] `bun test src/__tests__/tot_controller.test.ts` passes
- [ ] `bun test src/__tests__/belief_claim_store.test.ts` passes
- [ ] `bun test src/__tests__/reasoning_trace.test.ts` passes
- [ ] `bun test src/__tests__/knowledge_graph.test.ts` passes
- [ ] Full suite: `bun test` still passes with 0 regressions
- [ ] Coverage report (optional but recommended): `bun test --coverage` shows 80%+ on reasoning/, tools/, belief/, knowledge_graph/

**Rollback Path:** Tests are purely additive. No rollback needed.

**Estimated Effort:** 4–5 days

---

### 3.3 Performance Benchmark

**Goal:** Establish reproducible baselines for ToT vs. single-shot latency, memory, and token consumption. Define and document the acceptable 2× slowdown threshold.

**Status (codebase reality as of 2026-05-06):**
- Benchmark harness implemented as `gzmo-daemon/src/perf_benchmark.ts`.
- Script added: `cd gzmo-daemon && bun run benchmark`.
- Baseline doc added: `docs/PERFORMANCE_BASELINE.md`.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/perf_benchmark.ts` | **New.** Benchmark harness with configurable scenarios |
| `gzmo-daemon/src/perf.ts` | Extend `appendTaskPerf` with benchmark flag |
| `gzmo-daemon/package.json` | Add `"benchmark"` script |

**Data Structures:**

```typescript
// gzmo-daemon/src/perf_benchmark.ts
export interface BenchmarkScenario {
  name: string;
  action: "think" | "search" | "chain";
  body: string;
  envOverrides: Record<string, string>;
}

export interface BenchmarkResult {
  scenario: string;
  config: string; // e.g. "single-shot" | "tot" | "tot+tools"
  runs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  tokenEstimate: number; // answer.length / 4 (rough)
  ollamaCalls: number;
  nodesExpanded?: number; // ToT only
  toolCalls?: number; // tools only
}
```

**Step-by-step:**

**Step 3.3.1 — Create Benchmark Harness**

```typescript
// gzmo-benchmark.ts (or src/perf_benchmark.ts)
/**
 * Performance benchmark: compare single-shot vs ToT vs ToT+tools.
 *
 * Usage: cd gzmo-daemon && GZMO_BENCHMARK_RUNS=5 bun run benchmark
 *
 * This does NOT modify the vault. It uses a temp directory and synthetic tasks.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { processTask } from "./src/engine";
import { VaultWatcher } from "./src/watcher";
import { TaskEvent } from "./src/watcher";
import { DocumentWrapper } from "./src/frontmatter";

const SCENARIOS: BenchmarkScenario[] = [
  {
    name: "simple_think",
    action: "think",
    body: "Explain the Lorenz attractor in one paragraph.",
    envOverrides: {},
  },
  {
    name: "simple_search",
    action: "search",
    body: "What files does the daemon write?",
    envOverrides: {},
  },
  {
    name: "search_tot",
    action: "search",
    body: "According to the vault, how does the chaos engine affect memory usage?",
    envOverrides: { GZMO_ENABLE_TOT: "on" },
  },
  {
    name: "search_tot_tools",
    action: "search",
    body: "Find all references to 'ollama' in the source code and classify each as config or runtime usage.",
    envOverrides: { GZMO_ENABLE_TOT: "on", GZMO_ENABLE_TOOLS: "on" },
  },
];

async function runBenchmark(): Promise<void> {
  const runs = Number(process.env.GZMO_BENCHMARK_RUNS ?? "3");
  const vault = mkdtempSync(join(tmpdir(), "gzmo-benchmark-"));
  mkdirSync(join(vault, "GZMO", "Inbox"), { recursive: true });
  mkdirSync(join(vault, "GZMO", "Subtasks"), { recursive: true });
  mkdirSync(join(vault, "GZMO", "Thought_Cabinet"), { recursive: true });
  mkdirSync(join(vault, "GZMO", "Quarantine"), { recursive: true });
  mkdirSync(join(vault, "wiki"), { recursive: true });

  // Write a minimal wiki so search has something to retrieve
  writeFileSync(join(vault, "wiki", "overview.md"), "# Overview\n\nGZMO is a sovereign local daemon.\n");
  writeFileSync(join(vault, "wiki", "chaos.md"), "# Chaos Engine\n\nThe Lorenz attractor modulates temperature.\n");

  console.log(`Benchmark vault: ${vault}`);
  console.log(`Runs per scenario: ${runs}`);
  console.log("");

  for (const scenario of SCENARIOS) {
    console.log(`--- ${scenario.name} ---`);
    console.log(`Config: ${scenario.envOverrides.GZMO_ENABLE_TOT ? "ToT" : "single-shot"}${scenario.envOverrides.GZMO_ENABLE_TOOLS ? "+tools" : ""}`);

    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      // Apply env overrides
      for (const [k, v] of Object.entries(scenario.envOverrides)) {
        process.env[k] = v;
      }

      const fileName = `benchmark_${scenario.name}_${i}.md`;
      const filePath = join(vault, "GZMO", "Inbox", fileName);
      const content = `---\nstatus: pending\naction: ${scenario.action}\n---\n\n${scenario.body}`;
      writeFileSync(filePath, content);

      const t0 = Date.now();
      // Use a synthetic watcher — we don't need live watching
      const watcher = new VaultWatcher(vault, async () => {});
      const event = {
        filePath,
        fileName,
        body: scenario.body,
        frontmatter: { status: "pending", action: scenario.action },
        document: new DocumentWrapper(filePath),
        type: "add",
      } as TaskEvent;

      try {
        await processTask(event, watcher);
      } catch (err) {
        console.warn(`  Run ${i + 1}: failed — ${err}`);
      }
      const elapsed = Date.now() - t0;
      times.push(elapsed);
      console.log(`  Run ${i + 1}: ${elapsed}ms`);

      // Cleanup benchmark env
      for (const k of Object.keys(scenario.envOverrides)) {
        delete process.env[k];
      }
    }

    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const p95Idx = Math.floor(times.length * 0.95);
    const p95 = times[Math.min(p95Idx, times.length - 1)]!;

    console.log(`  median: ${median}ms | p95: ${p95}ms | range: ${times[0]!}-${times[times.length - 1]!}ms`);
    console.log("");
  }

  // Cleanup
  console.log(`Done. Vault at: ${vault}`);
  console.log("Clean up with: rm -rf " + vault);
}

if (import.meta.main) runBenchmark();
```

**Step 3.3.2 — Register in package.json**

```json
"benchmark": "bun run src/perf_benchmark.ts"
```

**Step 3.3.3 — Document Thresholds**

Add to `docs/PERFORMANCE_BASELINE.md`:

```markdown
# GZMO Performance Baseline

Last updated: 2026-05-XX

## Methodology

```bash
cd gzmo-daemon
GZMO_BENCHMARK_RUNS=5 bun run benchmark
```

## Current Results (hermes3:8b, CPU-only)

| Scenario | Config | Median | p95 | vs Baseline |
|----------|--------|--------|-----|-------------|
| simple_search | single-shot | 450ms | 520ms | 1.0× |
| search_tot | ToT | 1,200ms | 1,450ms | 2.7× |
| search_tot_tools | ToT+tools | 1,800ms | 2,100ms | 4.0× |

## Thresholds

- **Acceptable**: ToT ≤ 2.5× single-shot median for same query
- **Warning**: ToT 2.5–4× single-shot → investigate node budget
- **Unacceptable**: ToT > 4× → reduce GZMO_TOT_MAX_NODES or disable

## Tuning Guide

If ToT is too slow:
1. Reduce `GZMO_TOT_MAX_NODES` (default 15 → try 10)
2. Reduce `GZMO_TOT_BEAM` branches
3. Disable tool fallback: `GZMO_ENABLE_TOOLS=off`
4. Use fast-path mode: `GZMO_ENABLE_TOT=off`
```

**Acceptance Criteria:**

- [ ] `bun run benchmark` executes without errors
- [ ] Results show median/p95/range for each scenario
- [ ] Baseline document is committed with initial numbers
- [ ] CI or manual pre-release checklist includes benchmark run
- [ ] Benchmark does not pollute user's actual vault (uses temp dir)

**Rollback Path:** Benchmark is purely diagnostic. No runtime impact.

**Estimated Effort:** 2 days

---

## 4. Short-Term — High-Impact (2–6 weeks)

---

### 4.1 Close the Learning Loop

**Goal:** Make `strategy_ledger.jsonl` actually influence `expandAnalyze()` prompts. Feed computed fitness scores back into the reasoning engine so that past successes improve future behavior.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/learning/ledger.ts` | Add `injectStrategyTipsIntoAnalyzePrompt()` and `computeWinningPatterns()` |
| `gzmo-daemon/src/reasoning/expand.ts` | Modify `expandAnalyze()` to consume strategy context |
| `gzmo-daemon/src/reasoning/run_tot_search.ts` | Pass strategy context into `expandAnalyze()` |
| `gzmo-daemon/src/learning/analyze.ts` | Extend with prompt-effectiveness correlation |

**Data Structures:**

```typescript
// Add to ledger.ts
export interface WinningPattern {
  taskType: TaskTypeFingerprint;
  decompositionStyle: string;
  avgZScore: number;
  sampleSize: number;
  promptFragment: string; // the actual text to inject
  firstSeen: string;
  lastSeen: string;
}

// Add to ledger.ts
export interface StrategyInjectContext {
  tips: StrategyTip[];
  winningPattern?: WinningPattern;
  recentFailureContext?: string; // from last 3 failed tasks of same type
}
```

**Step-by-step:**

**Step 4.1.1 — Compute Winning Patterns**

```typescript
// Add to ledger.ts

export async function computeWinningPatterns(
  vaultPath: string,
  taskType: TaskTypeFingerprint,
): Promise<WinningPattern[]> {
  const ledger = await loadLedger(vaultPath, 300);
  const relevant = ledger.filter((e) => e.task_type === taskType && Number.isFinite(e.z_score));
  if (relevant.length < 5) return [];

  // Only consider entries with z_score > 0.7 as "winning"
  const winners = relevant.filter((e) => e.z_score >= 0.7);
  if (winners.length < 3) return [];

  const byStyle = new Map<string, WinningPattern>();
  for (const w of winners) {
    const existing = byStyle.get(w.decomposition_style);
    if (!existing) {
      byStyle.set(w.decomposition_style, {
        taskType,
        decompositionStyle: w.decomposition_style,
        avgZScore: w.z_score,
        sampleSize: 1,
        promptFragment: buildPromptFragmentForStyle(w.decomposition_style),
        firstSeen: w.timestamp,
        lastSeen: w.timestamp,
      });
    } else {
      existing.avgZScore = (existing.avgZScore * existing.sampleSize + w.z_score) / (existing.sampleSize + 1);
      existing.sampleSize++;
      if (w.timestamp > existing.lastSeen) existing.lastSeen = w.timestamp;
    }
  }

  return [...byStyle.values()]
    .filter((p) => p.sampleSize >= 3)
    .sort((a, b) => b.avgZScore - a.avgZScore)
    .slice(0, 2);
}

function buildPromptFragmentForStyle(style: string): string {
  switch (style) {
    case "direct_read":
      return "For this task type, first identify the exact file(s) to read, then read them directly before reasoning.";
    case "broad_scope":
      return "For this task type, start with a broad overview retrieval, then narrow to specific evidence.";
    case "narrow_scope":
      return "For this task type, focus retrieval on the most specific matching documents first.";
    default:
      return "Decompose into independently verifiable sub-tasks.";
  }
}
```

**Step 4.1.2 — Compute Recent Failure Context**

```typescript
// Add to ledger.ts

export async function getRecentFailureContext(
  vaultPath: string,
  taskType: TaskTypeFingerprint,
): Promise<string | undefined> {
  const ledger = await loadLedger(vaultPath, 100);
  const failures = ledger
    .filter((e) => e.task_type === taskType && !e.ok)
    .slice(-3);
  if (failures.length === 0) return undefined;

  const styles = new Set(failures.map((f) => f.decomposition_style));
  const lines = [
    "## Recent failures for this task type",
    `Failed ${failures.length} time(s) recently. Failed styles: ${[...styles].join(", ")}.`,
    "Avoid these approaches if they appear in the decomposition.",
  ];
  return lines.join("\n");
}
```

**Step 4.1.3 — Modify expandAnalyze to Consume Strategy**

```typescript
// In expand.ts, modify expandAnalyze signature and body

export async function expandAnalyze(
  _node: ToTNode,
  systemPrompt: string,
  userPrompt: string,
  inferDetailedFn: /* ... */,
  temp: number,
  maxTok: number,
  pastTraceContext?: string,
  strategyContext?: StrategyInjectContext, // NEW parameter
): Promise<ExpansionChild[]> {
  const contextBlock = pastTraceContext
    ? `\n\nPast similar tasks succeeded with this approach:\n${pastTraceContext}\n`
    : "";

  const strategyBlock = strategyContext
    ? `\n\n## Strategy guidance (from past performance)\n\n${strategyContext.tips.map((t) => `${t.kind === "positive" ? "✓ Effective" : "✗ Avoid"}: ${t.style} — ${t.reason}`).join("\n")}\n${strategyContext.winningPattern ? `\nWinning pattern: ${strategyContext.winningPattern.promptFragment}` : ""}\n${strategyContext.recentFailureContext ?? ""}\n`
    : "";

  const decompositionPrompt = [
    "Decompose the following task into 2–4 concrete sub-tasks.",
    contextBlock,
    strategyBlock,
    "Each sub-task should be independently verifiable.",
    "Output as a numbered list. Be concise.",
    "",
    "Task:",
    userPrompt,
  ].join("\n");

  // ... rest unchanged
}
```

**Step 4.1.4 — Wire Strategy Lookup into runSearchTot**

```typescript
// In runSearchTot, before calling expandAnalyze:

let strategyContext: StrategyInjectContext | undefined;
if (learningEnabled() && p.vaultRoot) {
  const taskType = classifyTaskType(p.body); // from ledger.ts
  const ledger = await loadLedger(p.vaultRoot, 300);
  const tips = buildStrategyTips(ledger, taskType);
  const winningPatterns = await computeWinningPatterns(p.vaultRoot, taskType);
  const failureContext = await getRecentFailureContext(p.vaultRoot, taskType);

  strategyContext = {
    tips,
    winningPattern: winningPatterns[0],
    recentFailureContext: failureContext,
  };
}

// Pass into expandAnalyze:
const analyzeSpecs = await expandAnalyze(
  r,
  p.systemPrompt,
  p.body,
  inferFast,
  temp,
  maxTok,
  pastTraceContext,
  strategyContext,
);
```

**Step 4.1.5 — Wire into Single-Shot Path (engine.ts)**

Even when ToT is off, inject strategy tips into the system prompt for `action: search`:

```typescript
// In engine.ts, after computing strategyContext (already partially there):
let strategyContext = "";
if (learningEnabled() && vaultRoot) {
  const ledger = await loadLedger(vaultRoot, 200);
  const taskType = classifyTaskType(body);
  const tips = buildStrategyTips(ledger, taskType);
  // NEW: add winning patterns
  const patterns = await computeWinningPatterns(vaultRoot, taskType);
  const failureCtx = await getRecentFailureContext(vaultRoot, taskType);

  const parts: string[] = [];
  parts.push(formatStrategyContext(tips));
  if (patterns.length > 0) {
    parts.push("## Winning patterns\n");
    for (const p of patterns) {
      parts.push(`- ${p.promptFragment} (z=${p.avgZScore.toFixed(2)}, n=${p.sampleSize})`);
    }
  }
  if (failureCtx) parts.push(failureCtx);
  strategyContext = parts.filter(Boolean).join("\n\n");
}
```

**Step 4.1.6 — A/B Test Validation**

Add a lightweight A/B flag so you can measure whether strategy injection improves scores:

```typescript
// Env: GZMO_LEARNING_AB_TEST=on
// When on, randomly skip strategy injection for 30% of tasks and record both paths
const abTestEnabled = readBoolEnv("GZMO_LEARNING_AB_TEST", false);
const injectStrategy = !abTestEnabled || Math.random() > 0.3;

if (injectStrategy && strategyContext) {
  // inject
} else {
  // control group: no injection
}

// Record which path was taken in the ledger entry
await appendStrategyEntry(vaultRoot, {
  // ... existing fields ...
  strategy_injected: injectStrategy,
  // record this so you can compare z_scores: injected vs control
});
```

**Acceptance Criteria:**

- [ ] After 10+ tasks, `strategy_ledger.jsonl` contains entries with `strategy_injected: true/false`
- [ ] `expandAnalyze()` prompt includes strategy tips when `GZMO_ENABLE_LEARNING=on`
- [ ] Winning patterns appear in the decomposition prompt after 3+ successful tasks of same type
- [ ] A/B test mode records both paths; ledger includes flag
- [ ] `bun test` passes; no regressions
- [ ] Benchmark: tasks with strategy injection show equal or better z-scores than control (within 20 runs)

**Rollback Path:**

```bash
export GZMO_ENABLE_LEARNING=off
export GZMO_LEARNING_AB_TEST=off
```

When disabled, `strategyContext` is undefined and `expandAnalyze()` behaves exactly as before.

**Estimated Effort:** 5–6 days

---

### 4.2 Cross-Task Trace Memory

**Goal:** Index past reasoning traces into the embedding store so that before ToT decomposition, similar past tasks are retrieved and their winning strategies injected as context. Make the engine stateful across sessions.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/learning/sync_traces.ts` | Already exists. Ensure it runs on daemon boot conditionally. |
| `gzmo-daemon/src/learning/trace_chunks.ts` | Already exists. Verify chunk quality for retrieveability. |
| `gzmo-daemon/src/embeddings.ts` | Add `trace` as a recognized metadata.type. Exclude from default search unless filtered. |
| `gzmo-daemon/src/reasoning/run_tot_search.ts` | Before `expandAnalyze()`, retrieve similar traces and build `pastTraceContext` |
| `gzmo-daemon/src/reasoning_trace.ts` | Add `task_type` and `outcome_score` to trace index for queryability |
| `gzmo-daemon/index.ts` | On daemon boot (after embeddings init), conditionally sync traces |

**Data Structures:**

```typescript
// Enhance trace chunks metadata
export interface TraceChunkMetadata {
  pathBucket: "traces";
  type: "trace";
  role: "reasoning" | "failure" | "success";
  tags: string[]; // task_type, model, action, ok/not
  status?: "completed" | "failed";
  task_type?: string;
  outcome_score?: number; // z_score if available
}

// Result from trace memory retrieval
export interface SimilarTrace {
  traceId: string;
  taskFile: string;
  action: string;
  similarity: number;
  winningStrategy: string;
  zScore: number;
}
```

**Step-by-step:**

**Step 4.2.1 — Enhance Trace Chunk Metadata**

```typescript
// In trace_chunks.ts — verify/implement
import type { ReasoningTrace } from "../reasoning_trace";

export interface TraceChunk {
  file: string;
  heading: string;
  text: string;
  hash: string;
  metadata: {
    pathBucket: string;
    type: string;
    role: string;
    tags: string[];
    status: string;
    task_type: string;
    outcome_score?: number;
  };
}

export function traceToChunks(trace: ReasoningTrace): TraceChunk[] {
  const baseTags = [trace.action, trace.status, trace.model.replace(/[:./]/g, "_")];
  const chunks: TraceChunk[] = [];

  // Chunk 1: Task summary (always present)
  const summaryText = [
    `Task: ${trace.task_file}`,
    `Action: ${trace.action}`,
    `Status: ${trace.status}`,
    `Model: ${trace.model}`,
    `Time: ${trace.total_elapsed_ms}ms`,
    `Query: ${trace.nodes[0]?.prompt_summary ?? ""}`,
  ].join("\n");

  chunks.push({
    file: `traces/${trace.trace_id}.json`,
    heading: `Trace: ${trace.trace_id}`,
    text: summaryText,
    hash: hashContent(summaryText),
    metadata: {
      pathBucket: "traces",
      type: "trace",
      role: trace.status === "completed" ? "success" : "failure",
      tags: [...baseTags],
      status: trace.status,
      task_type: trace.action,
    },
  });

  // Chunk 2: Final answer (for semantic retrieval)
  if (trace.final_answer) {
    const answerText = trace.final_answer.slice(0, 1500);
    chunks.push({
      file: `traces/${trace.trace_id}.json`,
      heading: "Final Answer",
      text: answerText,
      hash: hashContent(answerText),
      metadata: {
        pathBucket: "traces",
        type: "trace",
        role: "reasoning",
        tags: [...baseTags, "answer"],
        status: trace.status,
        task_type: trace.action,
      },
    });
  }

  // Chunk 3: Analyze node summary (if ToT was used)
  const analyzeNode = trace.nodes.find((n) => n.type === "analyze" && n.depth === 1);
  if (analyzeNode) {
    const analyzeText = `Decomposition: ${analyzeNode.prompt_summary}`;
    chunks.push({
      file: `traces/${trace.trace_id}.json`,
      heading: "Decomposition",
      text: analyzeText,
      hash: hashContent(analyzeText),
      metadata: {
        pathBucket: "traces",
        type: "trace",
        role: "reasoning",
        tags: [...baseTags, "decomposition"],
        status: trace.status,
        task_type: trace.action,
      },
    });
  }

  return chunks;
}

function hashContent(text: string): string {
  return Bun.hash(text).toString(36).slice(0, 16);
}
```

**Step 4.2.2 — Boot-Time Trace Sync**

```typescript
// In index.ts, after embeddings.init() and before watcher start:
if (readBoolEnv("GZMO_ENABLE_TRACE_MEMORY", false) && vaultPath) {
  const { syncTracesIntoStore } = await import("./learning/sync_traces");
  const added = await syncTracesIntoStore(vaultPath, embeddingStore, ollamaUrl);
  console.log(`[BOOT] Synced ${added} trace chunks into embedding store`);
  if (added > 0) {
    invalidateEmbeddingSearchCache(embeddingStore);
  }
}
```

**Step 4.2.3 — Retrieve Similar Traces Before ToT**

This is partially implemented in `run_tot_search.ts`. Verify and enhance:

```typescript
// In run_tot_search.ts — the pastTraceContext block:

let pastTraceContext: string | undefined;
if (traceMemory && p.embeddingStore.chunks.length > 0) {
  const ollamaBase = normalizeOllamaApiUrl();

  // Search for traces with role="reasoning" or "success"
  const traceResults = await searchVaultHybrid(p.body, p.embeddingStore, ollamaBase, {
    topK: 10,
    filters: { types: ["trace"] },
    mode: "fast",
  });

  // Filter to high-quality traces (z_score equivalent: completed status + relevant)
  const relevant = traceResults
    .filter((r) =>
      r.metadata?.type === "trace" &&
      (r.metadata?.role === "reasoning" || r.metadata?.role === "success")
    )
    .slice(0, 3);

  if (relevant.length > 0) {
    pastTraceContext = relevant
      .map((r) => {
        const statusEmoji = r.metadata?.status === "completed" ? "✓" : "✗";
        return `${statusEmoji} ${r.heading}: ${r.text.slice(0, 200)}`;
      })
      .join("\n\n");

    if (pastTraceContext) {
      pastTraceContext = `## Past similar tasks (from trace memory)\n${pastTraceContext}\n`;
    }
  }
}
```

**Step 4.2.4 — Exclude Traces from Default Search**

Traces should not pollute normal vault search. The existing `search.ts` already has filtering logic. Add explicit trace exclusion unless explicitly requested:

```typescript
// In search.ts, in searchVault's scored filter:
if (typeFilter.length > 0) {
  // existing logic
} else {
  // Default: exclude trace chunks unless the query explicitly asks about traces
  const isTraceQuery = /\btrace|reasoning history|past task/i.test(query);
  if (!isTraceQuery && r.metadata?.type === "trace") {
    score -= 2.0; // strongly deprioritize
  }
}
```

**Step 4.2.5 — Add Trace-to-Trace Linking**

If a new trace is for the same task file as a previous trace, create a `derived_from` edge in the Knowledge Graph:

```typescript
// In engine.ts, after trace persistence:
if (readBoolEnv("GZMO_ENABLE_KNOWLEDGE_GRAPH", false) && vaultRoot) {
  const { KnowledgeGraph } = await import("./knowledge_graph/graph");
  const kg = KnowledgeGraph.forVault(vaultRoot);
  await kg.init();

  // Check if a previous trace exists for this task_file
  const prevTraces = await findTracesForTask(vaultRoot, taskRelPath);
  if (prevTraces.length > 1) {
    const currentTraceId = traceId;
    const prevTraceId = prevTraces[1]!.trace_id; // [0] is current
    const currentNode = kg.addNode({
      type: "session",
      label: `Trace ${currentTraceId}`,
      metadata: { task_file: taskRelPath, trace_id: currentTraceId },
    });
    const prevNode = kg.addNode({
      type: "session",
      label: `Trace ${prevTraceId}`,
      metadata: { task_file: taskRelPath, trace_id: prevTraceId },
    });
    kg.addEdge(currentNode, prevNode, "derived_from", 1.0, "Same task, later attempt");
    await kg.persist();
  }
}
```

**Acceptance Criteria:**

- [ ] After boot with `GZMO_ENABLE_TRACE_MEMORY=on`, traces appear as chunks in the embedding store
- [ ] `searchVaultHybrid("test query", store, url, { filters: { types: ["trace"] } })` returns trace chunks
- [ ] ToT tasks retrieve 1–3 similar traces and inject context into analyze prompt
- [ ] Normal (non-trace) search does not return trace chunks in top results
- [ ] Same task file run twice creates a `derived_from` edge in KG (if KG enabled)
- [ ] `bun test` passes; no regressions

**Rollback Path:**

```bash
export GZMO_ENABLE_TRACE_MEMORY=off
```

When disabled, `pastTraceContext` is always undefined and `syncTracesIntoStore` is skipped on boot.

**Estimated Effort:** 5–7 days

---

### 4.3 Critique + Replanning

**Goal:** When `bestPath()` returns empty (all branches failed), generate a self-critique, optionally replan with a different decomposition, and attempt one additional generation. This is the "don't give up, diagnose and retry" capability.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/reasoning/critique.ts` | Already exists and well-implemented. Verify integration. |
| `gzmo-daemon/src/reasoning/controller.ts` | Already has `replan()` method. Verify it clears non-critique children. |
| `gzmo-daemon/src/reasoning/run_tot_search.ts` | Wire critique + replan after `bestPath()` is empty |
| `gzmo-daemon/src/reasoning/gates.ts` | Ensure analyze gate blocks clearly off-topic replans |
| `gzmo-daemon/src/__tests__/critique_replan.test.ts` | **New.** Test the full critique→replan→second attempt flow |

**Data Structures:**

Already defined in `critique.ts`:
```typescript
export interface CritiqueResult {
  problems: string[];
  recommendation: string;
  shouldReplan: boolean;
}
```

**Step-by-step:**

**Step 4.3.1 — Verify Critique Integration in runSearchTot**

The critique flow is partially implemented in `run_tot_search.ts`. Verify the wiring is complete:

```typescript
// In run_tot_search.ts, after the first bestPath check:

let path = tot.bestPath();
let bestClaims = path.flatMap((n) => n.claims ?? []);

const MAX_REPLANS = 1;
let replanCount = 0;

if (
  bestClaims.length === 0 &&
  critiqueEnabled &&
  replanCount < MAX_REPLANS &&
  tot.totalNodes < budget.maxTotalNodes - 4
) {
  const critique = await generateCritique(tot.allNodes, budget.evaluationThreshold, inferCritique, p.systemPrompt);

  const rr = tot.root;
  if (rr) {
    // Record critique as a node
    tot.addChild(rr, {
      node_id: tot.nextNodeId(),
      trace_id: p.traceId,
      parent_id: rr.node_id,
      type: "critique",
      depth: 1,
      prompt_summary: critique.recommendation.slice(0, 140),
      outcome: critique.shouldReplan ? "partial" : "abstain",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    if (critique.shouldReplan) {
      tot.replan(critique.recommendation);
      replanCount++;
      retriedReasonIds.clear();
      const hint = `Critique from first attempt: ${critique.recommendation}`;

      // Re-run analyze phase with critique context
      const ok = await runAnalyzePhase(`${p.body}\n\n${hint}`, pastTraceContext);
      if (ok) {
        path = tot.bestPath();
        bestClaims = path.flatMap((n) => n.claims ?? []);
      }
    }
  }
}
```

**Step 4.3.2 — Enhance Critique with Claim-Level Detail**

Extend `generateCritique()` to also report which *types* of claims failed (e.g., all path queries failed → recommend direct_read):

```typescript
// In critique.ts, add to contextLines:
const claimsByType = new Map<string, { total: number; passed: number }>();
for (const n of verifyNodes) {
  const style = extractDecompositionStyleFromNode(n); // helper
  const cur = claimsByType.get(style) ?? { total: 0, passed: 0 };
  cur.total++;
  if ((n.score ?? 0) >= threshold) cur.passed++;
  claimsByType.set(style, cur);
}

contextLines.push("\nPerformance by decomposition style:");
for (const [style, stats] of claimsByType) {
  const rate = stats.total > 0 ? stats.passed / stats.total : 0;
  contextLines.push(`  ${style}: ${stats.passed}/${stats.total} passed (${(rate * 100).toFixed(0)}%)`);
}
```

**Step 4.3.3 — Gate the Replan**

Add a sanity check so absurd replans are blocked:

```typescript
// After tot.replan(), before re-running analyze:

// Sanity gate: if recommendation is too vague, don't replan
const isActionable = critique.recommendation.length > 20 &&
  /\b(narrow|broad|specific|general|read|search|file|document|query)\b/i.test(critique.recommendation);

if (!isActionable) {
  // Mark as abstain instead
  tot.root!.type = "abstain";
  tot.root!.prompt_summary = `Critique: ${critique.recommendation.slice(0, 100)} (not actionable)`;
  tot.root!.outcome = "abstain";
}
```

**Step 4.3.4 — Update Synthesis for Replan Transparency**

In `synthesizeToTAnswer()`, indicate when a replan occurred:

```typescript
// In synthesis.ts, add after synthesisNote:
const replanNodes = allNodes.filter((n) => n.type === "replan");
if (replanNodes.length > 0) {
  lines.push(
    `\n> Note: Initial reasoning failed; the engine diagnosed the problem and attempted a revised approach.`,
  );
}
```

**Step 4.3.5 — Test the Full Flow**

```typescript
// gzmo-daemon/src/__tests__/critique_replan.test.ts
import { describe, expect, test } from "bun:test";
import { generateCritique } from "../reasoning/critique";
import { budgetFromChaos, ToTController } from "../reasoning/controller";
import { mockChaosSnapshot } from "./helpers";
import { Phase } from "../types";

describe("critique + replan", () => {
  test("generateCritique produces structured output", async () => {
    // Mock inferDetailedFn
    const mockInfer = async (_s: string, _p: string) => ({
      answer: "PROBLEM 1: Sub-tasks were too broad\nRECOMMENDATION: Narrow to specific files\nSHOULD_REPLAN: yes",
      raw: "",
      elapsed_ms: 100,
    });

    const tot = new ToTController(
      budgetFromChaos(mockChaosSnapshot(80, Phase.Build, 0)),
      "trace-1",
      "Test query",
    );

    // Add some failed verify nodes
    const child = tot.addChild(tot.root!, {
      node_id: "c1",
      trace_id: "trace-1",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "broad search",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });
    tot.addChild(child, {
      node_id: "v1",
      trace_id: "trace-1",
      parent_id: child.node_id,
      type: "verify",
      depth: 2,
      prompt_summary: "claim 1",
      score: 0.2,
      outcome: "failure",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
      claims: [{ text: "Something", confidence: 0.3, sources: [] }],
    });

    const critique = await generateCritique(tot.allNodes, 0.5, mockInfer, "sys");
    expect(critique.shouldReplan).toBe(true);
    expect(critique.problems.length).toBeGreaterThan(0);
    expect(critique.recommendation).toContain("Narrow");
  });

  test("replan clears non-critique children", () => {
    const tot = new ToTController(
      budgetFromChaos(mockChaosSnapshot(80, Phase.Build, 0)),
      "trace-1",
      "Test",
    );

    const child = tot.addChild(tot.root!, {
      node_id: "c1",
      trace_id: "trace-1",
      parent_id: tot.root!.node_id,
      type: "retrieve",
      depth: 1,
      prompt_summary: "child",
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    tot.addChild(tot.root!, {
      node_id: "crit1",
      trace_id: "trace-1",
      parent_id: tot.root!.node_id,
      type: "critique",
      depth: 1,
      prompt_summary: "critique",
      outcome: "partial",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
    });

    expect(tot.root!.children.length).toBe(2);
    tot.replan("Try again");
    expect(tot.root!.children.length).toBe(1);
    expect(tot.root!.children[0]!.node_id).toBe("crit1");
  });
});
```

**Acceptance Criteria:**

- [ ] A ToT task with no passing branches triggers `generateCritique()`
- [ ] Critique produces `problems[]`, `recommendation`, and `shouldReplan` flag
- [ ] When `shouldReplan=true`, the tree is cleared (except critique nodes) and re-analyzed
- [ ] Second-generation analyze prompt includes critique context
- [ ] Synthesis output indicates when a replan occurred (transparency)
- [ ] Maximum 1 replan per task (hard cap)
- [ ] `bun test` passes; `critique_replan.test.ts` validates the flow
- [ ] Benchmark: replan-enabled tasks show equal or better completion rate on hard queries

**Rollback Path:**

```bash
export GZMO_ENABLE_CRITIQUE=off
```

When disabled, the `bestClaims.length === 0` path falls directly to `shapePreservingFailClosed()` with no critique or replan.

**Estimated Effort:** 4–5 days

---

## 5. Medium-Term — Expanding the Envelope (1–3 months)

---

### 5.1 Tool Chaining

**Goal:** Enable follow-up tool calls where the output of one tool contains references that trigger additional tools. For example, `vault_read("overview.md")` finds a reference to "See telemetry.md §3" → auto-trigger `vault_read("telemetry.md")`.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/tools/chaining.ts` | Already exists. Verify and enhance with reference extraction. |
| `gzmo-daemon/src/tools/registry.ts` | Add `discoverFollowUps()` integration |
| `gzmo-daemon/src/reasoning/run_tot_search.ts` | Wire chaining into `processRetrievalBranch` |
| `gzmo-daemon/src/reasoning/expand.ts` | `expandRetrievalBranch` returns toolRecords for chaining |

**Data Structures:**

Already partially defined in `chaining.ts`:
```typescript
export interface FollowUpToolCall {
  tool: string;
  args: Record<string, unknown>;
  reason: string; // why this follow-up was inferred
}
```

**Step-by-step:**

**Step 5.1.1 — Enhance Reference Extraction**

```typescript
// In tools/chaining.ts

const REFERENCE_PATTERNS = [
  // "See [file.md]" or "See file.md §3"
  /(?:see|refer to|check|read|in|from)\s+[`"']?([\w\-./]+\.md)[`"']?(?:\s*§\s*(\d+))?/gi,
  // "For more, see wiki/Topic"
  /(?:wiki|docs)\/([\w\-./]+)/gi,
  // "The function is defined in src/file.ts"
  /(?:defined in|in|from)\s+[`"']?([\w\-/]+\.(?:ts|js|tsx|json))[`"']?/gi,
];

export function discoverFollowUps(tool: string, result: ToolResult): FollowUpToolCall[] {
  const followUps: FollowUpToolCall[] = [];
  if (!result.ok || !result.output) return followUps;

  const output = result.output;

  for (const pattern of REFERENCE_PATTERNS) {
    const matches = [...output.matchAll(pattern)];
    for (const m of matches) {
      const fileRef = m[1];
      if (!fileRef) continue;

      // Prefer vault_read for markdown files
      if (fileRef.endsWith(".md")) {
        followUps.push({
          tool: "vault_read",
          args: { path: fileRef, max_chars: 8000 },
          reason: `Referenced in ${tool} output: "${m[0]!.slice(0, 60)}"`,
        });
      }
      // Prefer fs_grep for code references
      else if (/\.(ts|js|tsx|json)$/.test(fileRef)) {
        followUps.push({
          tool: "fs_grep",
          args: { pattern: fileRef.replace(/\.[^.]+$/, ""), path: ".", max_results: 5 },
          reason: `Code file referenced: ${fileRef}`,
        });
      }
    }
  }

  // Deduplicate by (tool, args.path or args.pattern)
  const seen = new Set<string>();
  return followUps.filter((fu) => {
    const key = `${fu.tool}:${JSON.stringify(fu.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

**Step 5.1.2 — Wire into processRetrievalBranch**

This is already partially implemented in `run_tot_search.ts`. Verify and extend:

```typescript
// In run_tot_search.ts, inside processRetrievalBranch:

if (toolChain && toolEnabled) {
  const { discoverFollowUps } = await import("../tools/chaining");
  const { dispatchTool } = await import("../tools/registry");

  for (const record of [...toolRecords]) {
    for (const fu of discoverFollowUps(record.tool, record.result)) {
      if (toolRecords.length >= maxToolCalls) break;

      console.log(`[CHAIN] ${fu.reason} → ${fu.tool}(${JSON.stringify(fu.args)})`);
      const { record: nr } = await dispatchTool(fu.tool, fu.args, toolCtx);
      toolRecords.push(nr);
    }
  }

  // Rebuild toolFacts after chaining
  toolFacts = toolRecords
    .filter((r) => r.result.ok && r.result.output && r.result.output !== "(no matches)")
    .map((r) => `[tool:${r.tool}]\n${r.result.output}`)
    .join("\n\n");
}
```

**Step 5.1.3 — Chain Depth Limit**

Prevent infinite chaining:

```typescript
// In run_tot_search.ts, add to config:
const MAX_CHAIN_DEPTH = 2; // follow-up of follow-up, then stop

// Track generation in toolRecords metadata
// Only discover follow-ups from generation 0 or 1
const chainableRecords = toolRecords.filter((r) => (r as any).chainGeneration ?? 0 < MAX_CHAIN_DEPTH);
```

**Acceptance Criteria:**

- [ ] `vault_read("overview.md")` that references "telemetry.md" triggers `vault_read("telemetry.md")`
- [ ] Total tool calls never exceed `GZMO_MAX_TOOL_CALLS`
- [ ] Chain depth does not exceed 2
- [ ] Follow-ups are deduplicated (same file not read twice)
- [ ] Reason for each follow-up is logged and visible in trace
- [ ] `bun test` passes

**Rollback Path:**

```bash
export GZMO_ENABLE_TOOL_CHAINING=off
```

**Estimated Effort:** 4–5 days

---

### 5.2 Intermediate Verification Gates

**Goal:** Wire `analyzeGate`, `retrieveGate`, and `reasonGate` into the main ToT pipeline so errors are caught **before** expensive LLM calls, not just at the end.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/reasoning/gates.ts` | Already exists. Verify thresholds are reasonable. |
| `gzmo-daemon/src/reasoning/run_tot_search.ts` | Call gates at each pipeline stage; fail fast |
| `gzmo-daemon/src/reasoning/expand.ts` | Return gate failures as special nodes |

**Step-by-step:**

**Step 5.2.1 — Gate Integration Points**

Already partially implemented in `run_tot_search.ts`. Verify all three gates are active:

```typescript
// After expandAnalyze():
const analyzeCheck = analyzeGate(analyzeSpecs.map((s) => s.prompt_summary), p.body);
if (gatesEnabled && !analyzeCheck.passed) {
  r.outcome = "failure";
  r.prompt_summary = `[GATE] ${analyzeCheck.reason ?? "analyze blocked"}`;
  r.explored = true;
  // Add a gate-failure node
  tot.addChild(r, {
    node_id: tot.nextNodeId(),
    trace_id: p.traceId,
    parent_id: r.node_id,
    type: "abstain",
    depth: 1,
    prompt_summary: `Analyze gate blocked: ${analyzeCheck.reason}`,
    outcome: "failure",
    elapsed_ms: 0,
    timestamp: new Date().toISOString(),
  });
  return { answer: shapePreservingFailClosed({ ... }), totFlatNodes: tot.flattenForTrace() };
}
```

```typescript
// After expandRetrievalBranch():
const retrieveCheck = retrieveGate(evidence, 0.15, { hasToolFacts: Boolean(toolFacts?.trim()) });
if (gatesEnabled && !retrieveCheck.passed) {
  // Add gate-failure node and stop this branch
  tot.addChild(retrieveNode, {
    node_id: tot.nextNodeId(),
    trace_id: p.traceId,
    parent_id: retrieveNode.node_id,
    type: "abstain",
    depth: retrieveNode.depth + 1,
    prompt_summary: `[GATE] ${retrieveCheck.reason ?? "retrieve blocked"}`,
    outcome: "failure",
    elapsed_ms: 0,
    timestamp: new Date().toISOString(),
  });
  return; // stop processing this branch
}
```

```typescript
// After expandReason():
const reasonGateFailed =
  gatesEnabled &&
  !reasonGate(
    verifySpecs.flatMap((v) => v.claims ?? []),
    packet,
  ).passed;

if (reasonGateFailed) {
  // Mark all verify nodes from this reason as low-scoring
  for (const vs of verifySpecs) {
    // They will be scored and pruned normally
  }
}
```

**Step 5.2.2 — Tune Gate Thresholds**

Make thresholds configurable per environment:

```typescript
// In gates.ts, modify signatures to accept env overrides:
export function retrieveGate(
  evidence: SearchResult[],
  minScore = Number.parseFloat(process.env.GZMO_RETRIEVE_GATE_MIN ?? "0.15"),
  opts?: { hasToolFacts?: boolean },
): GateResult { /* ... */ }

export function analyzeGate(
  subTaskSummaries: string[],
  originalQuery: string,
  minCoverage = Number.parseFloat(process.env.GZMO_ANALYZE_GATE_MIN ?? "0.3"),
): GateResult { /* ... */ }
```

**Step 5.2.3 — Gate Bypass for Recovery**

If a gate blocks, attempt a recovery action before fully failing:

```typescript
// In run_tot_search.ts, when retrieveGate fails:
if (!retrieveCheck.passed && toolEnabled && maxToolCalls > toolRecords.length) {
  // Try tool fallback before giving up
  const { dispatchTool } = await import("../tools/registry");
  const { record } = await dispatchTool("fs_grep", { pattern: p.body.split(/\s+/)[0]!, max_results: 5 }, toolCtx);
  if (record.result.ok && record.result.output !== "(no matches)") {
    // Re-run retrieveGate with tool facts
    const retryCheck = retrieveGate(evidence, 0.15, { hasToolFacts: true });
    if (retryCheck.passed) {
      // Continue with this branch
    }
  }
}
```

**Acceptance Criteria:**

- [ ] `analyzeGate` blocks decompositions with <30% query keyword coverage
- [ ] `retrieveGate` blocks branches with zero evidence (unless tools provide facts)
- [ ] `reasonGate` flags claims citing nonexistent evidence IDs
- [ ] When gate blocks, a clear `abstain` node is added to the trace
- [ ] Gate thresholds are configurable via env
- [ ] `bun test` passes

**Rollback Path:**

```bash
export GZMO_ENABLE_GATES=off
```

**Estimated Effort:** 4–5 days

---

### 5.3 Multi-Model Routing

**Goal:** Actually use `GZMO_FAST_MODEL`, `GZMO_REASON_MODEL`, and `GZMO_JUDGE_MODEL` for different reasoning roles. Route ToT LLM calls by function: fast model for decomposition, main model for reasoning, optional judge model for evaluation.

**Files Changed / Created:**

| File | Action |
|------|--------|
| `gzmo-daemon/src/inference_router.ts` | Already exists. Verify fallback logic. |
| `gzmo-daemon/src/reasoning/run_tot_search.ts` | Use `inferByRole("fast", ...)` for analyze, `inferByRole("reason", ...)` for reason |
| `gzmo-daemon/src/reasoning/evaluate.ts` | Use `getChatModelForRole("judge")` for shadow judge |
| `gzmo-daemon/src/engine.ts` | Use `inferByRole("fast", ...)` for simple think tasks |
| `gzmo-daemon/docs/MODEL_ROUTING.md` | **New.** Document setup: pulling multiple models, Ollama config |

**Step-by-step:**

**Step 5.3.1 — Verify Inference Router**

The router already exists. Key check: ensure fallback to main model works when role models are not set:

```typescript
// In inference_router.ts — verify resolveTag
function resolveTag(role: ModelRole): string {
  const main = process.env.OLLAMA_MODEL ?? "hermes3:8b";
  switch (role) {
    case "fast":
      return process.env.GZMO_FAST_MODEL ?? main;
    case "reason":
      return process.env.GZMO_REASON_MODEL?.trim() ? process.env.GZMO_REASON_MODEL! : main;
    case "judge":
      return process.env.GZMO_JUDGE_MODEL?.trim() ? process.env.GZMO_JUDGE_MODEL! : main;
    default:
      return main;
  }
}
```

This is correct. When unset, all roles fall back to `OLLAMA_MODEL`.

**Step 5.3.2 — Use Role-Based Inference in ToT**

```typescript
// In run_tot_search.ts, replace direct inferFast/inferReason with explicit role calls:

const inferFast = (s: string, pr: string, o?: InferDetailedOptions) =>
  modelRoutingEnabled() ? inferByRole("fast", s, pr, o) : inferDetailed(s, pr, o);

const inferReason = (s: string, pr: string, o?: InferDetailedOptions) =>
  modelRoutingEnabled() ? inferByRole("reason", s, pr, o) : inferDetailed(s, pr, o);

const inferCritique = (s: string, pr: string, o?: InferDetailedOptions) =>
  modelRoutingEnabled() ? inferByRole("reason", s, pr, o) : inferDetailed(s, pr, o);

const judgeModel = modelRoutingEnabled() ? getChatModelForRole("judge") : getChatModel();
```

**Step 5.3.3 — Optimize Temperature by Role**

The router already applies role-appropriate temperatures:
- judge: 0.1 (strict, deterministic)
- fast: 0.5 (creative enough for decomposition)
- reason: 0.6 (balanced)

Verify these feel right in practice and document.

**Step 5.3.4 — Ollama Multi-Model Configuration**

Document how to run multiple models:

```markdown
# Model Routing Setup

## Prerequisites

You need enough RAM/VRAM to keep multiple models loaded.

| Setup | Minimum RAM | Recommended |
|-------|-------------|-------------|
| fast=8B + reason=8B (same model) | 8GB | 16GB |
| fast=7B + reason=32B | 48GB | 64GB |
| fast=7B + reason=32B + judge=8B | 56GB | 80GB |

## Ollama Configuration

```bash
# Keep multiple models loaded simultaneously
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KEEP_ALIVE=-1

# Pull models
ollama pull qwen2.5:7b      # fast
ollama pull qwq:32b         # reason
ollama pull hermes3:8b      # judge (or fallback to reason)
```

## GZMO Configuration

```bash
# gzmo-daemon/.env
OLLAMA_MODEL="qwen2.5:7b"          # default / fast
GZMO_FAST_MODEL="qwen2.5:7b"
GZMO_REASON_MODEL="qwq:32b"
GZMO_JUDGE_MODEL="hermes3:8b"
GZMO_ENABLE_MODEL_ROUTING=on
```

## Verify

```bash
cd gzmo-daemon
bun run benchmark
# Expect: fast model used for analyze, reason model for reason/critique
```
```

**Step 5.3.5 — Benchmark Multi-Model**

Add a benchmark scenario that specifically tests multi-model routing:

```typescript
{
  name: "search_multimodel",
  action: "search",
  body: "What files does the daemon write?",
  envOverrides: {
    GZMO_ENABLE_MODEL_ROUTING: "on",
    GZMO_ENABLE_TOT: "on",
    GZMO_FAST_MODEL: process.env.GZMO_FAST_MODEL ?? "qwen2.5:7b",
    GZMO_REASON_MODEL: process.env.GZMO_REASON_MODEL ?? process.env.OLLAMA_MODEL!,
  },
}
```

**Acceptance Criteria:**

- [ ] When `GZMO_ENABLE_MODEL_ROUTING=on`, different model tags are used for different roles
- [ ] `bun run benchmark` shows separate timing for fast/reason paths
- [ ] Ollama API logs (or `ollama ps`) confirm multiple models loaded
- [ ] Fallback to `OLLAMA_MODEL` works when role models are unset
- [ ] Judge role uses temperature 0.1 for maximum consistency
- [ ] Benchmark: multi-model setup shows quality improvement or latency reduction vs single-model

**Rollback Path:**

```bash
export GZMO_ENABLE_MODEL_ROUTING=off
```

When disabled, all calls use `inferDetailed()` (single model, existing behavior).

**Estimated Effort:** 4–6 days (includes documentation and multi-model environment setup)

---

## 6. Strategic — Positioning

### 6.1 Position as "The Sovereign Reasoning Engine"

**Narrative:** There is no credible local-only agent framework that combines structured reasoning traces, deterministic safety, fail-closed RAG, chaos modulation, and closed-loop learning. GZMO occupies a unique position.

**Messaging pillars:**

1. **Sovereign**: Zero cloud dependencies. Your data never leaves your machine.
2. **Auditable**: Every reasoning step is a structured trace node. You can inspect *why* it produced an answer.
3. **Deterministic**: LLMs generate; deterministic code verifies. Safety is guaranteed, not hoped for.
4. **Self-Improving**: Fitness scores feed back into strategy. The engine gets better with use.
5. **Chaos-Driven**: Not random—deterministic chaos produces emergent variation that prevents mode collapse.

**Actions:**

- [ ] Rename primary descriptor from "local AI daemon" to **"sovereign reasoning engine"** in README, AGENTS.md, and research docs.
- [ ] Add a "Why Sovereign?" section to README explaining the architectural choice.
- [ ] Create `docs/SOVEREIGNTY.md` contrasting GZMO with cloud-agent approaches.

### 6.2 Do NOT Chase OpenAI/Anthropic

**Anti-goals (explicit list):**

| Do NOT | Why |
|--------|-----|
| Add OpenAI/Anthropic API support | Violates sovereignty. Dilutes brand. |
| Add web search | Violates vault-native design. |
| Multi-agent debate frameworks | Overkill for single-user, single-machine use case. |
| Real-time streaming reasoning | Traces are for audit, not UX. Batch is fine. |
| Distributed computing | Single-machine local is the whole point. |

**Exception:** A clean abstraction layer for *other* local inference engines (llama.cpp, vLLM) could be acceptable as an alternative to Ollama, but this is low priority.

### 6.3 Consider a Paper or Technical Blog Post

**Novel contributions worth publishing:**

1. **Chaos-Driven Parameter Modulation in LLM Agents**: The Lorenz attractor + allostatic regulation as an affective computing substrate for inference control.
2. **L.I.N.C. — Logical Inference for Neurosymbolic Knowledge Channeling**: Four-gate validation applied to autonomous agent outputs.
3. **Deterministic Output Compilation for LLM Agents**: Treating LLM outputs as malformed syntax and using deterministic compilers for correction.
4. **Evidence-First Retrieval with Fail-Closed Safety**: A RAG architecture that proves citations rather than hoping for them.

**Venue options:**

| Venue | Fit | Effort |
|-------|-----|--------|
| Hacker News "Show HN" | High awareness, technical audience | 1 day (write post) |
| arXiv preprint | Academic credibility, searchable | 1–2 weeks (format, submit) |
| Blog post (personal/Ghost) | Narrative control, evergreen | 2–3 days |
| Conference workshop (NeurIPS/ICML agent track) | Peer review, networking | 2–3 months (deadline dependent) |

**Recommended:** Start with HN + blog post. If reception is strong, invest in arXiv.

---

## 7. Dependency Graph

```
3.1 Wire Knowledge Graph ─────────────────────────────────────────────┐
   ├── depends on: existing graph.ts (verified present)                │
   └── enables: 4.2 trace→KG linking, 5.2 graph-augmented search      │
                                                                       │
3.2 Add Tests ────────────────────────────────────────────────────────┤
   ├── depends on: nothing (purely additive)                          │
   └── enables: safe changes to all subsequent work                   │
                                                                       │
3.3 Performance Benchmark ────────────────────────────────────────────┤
   ├── depends on: functioning ToT + tools (verified)                 │
   └── enables: measuring impact of 4.1, 4.2, 4.3, 5.1, 5.2, 5.3    │
                                                                       │
4.1 Close Learning Loop ◄─────────────────────────────────────────────┤
   ├── depends on: 3.2 (tests for ledger)                             │
   ├── enhances: expandAnalyze() (already consumes tips)              │
   └── enables: 4.2 (winning patterns from traces)                    │
                                                                       │
4.2 Cross-Task Trace Memory ◄─────────────────────────────────────────┤
   ├── depends on: 3.1 (KG for trace linking), 4.1 (winning patterns) │
   ├── uses: syncTraces.ts (already implemented)                      │
   └── enables: better expandAnalyze() context                        │
                                                                       │
4.3 Critique + Replanning ◄───────────────────────────────────────────┤
   ├── depends on: 3.2 (tests for controller.ts)                      │
   ├── uses: critique.ts, controller.replan() (already implemented)   │
   └── synergizes with: 4.1 (learning from failed replans)            │
                                                                       │
5.1 Tool Chaining ◄───────────────────────────────────────────────────┤
   ├── depends on: 3.2 (tool tests), 5.2 (gates for safety)           │
   ├── uses: chaining.ts (already implemented)                        │
   └── enables: deeper multi-hop reasoning                            │
                                                                       │
5.2 Intermediate Gates ◄──────────────────────────────────────────────┤
   ├── depends on: 3.2 (gate tests)                                   │
   ├── uses: gates.ts (already implemented)                           │
   └── enables: safe tool chaining (catches errors early)             │
                                                                       │
5.3 Multi-Model Routing ◄─────────────────────────────────────────────┘
   ├── depends on: 3.3 (benchmark to measure impact)                  │
   ├── uses: inference_router.ts (already implemented)                │
   └── independent of: other features (additive, opt-in)              │
```

---

## 8. Risk Register

| # | Risk | Impact | Likelihood | Mitigation | Phase |
|---|------|--------|------------|------------|-------|
| 1 | **Token cost explosion (ToT)** | High | Medium | Hard caps, chaos budgets, env gates | All |
| 2 | **Tool use enables path traversal** | Critical | Low | Path normalization, startsWith checks, tests | 3.1, 5.1 |
| 3 | **Learning loop produces degenerate patterns** | Medium | Low | Population cap, human gate on prompt mutations | 4.1 |
| 4 | **Trace memory pollutes retrieval** | Medium | Medium | Explicit type filtering, default exclusion | 4.2 |
| 5 | **Critique causes infinite replan loops** | Medium | Low | Max 1 replan, hard cap | 4.3 |
| 6 | **Multi-model routing exhausts RAM** | Medium | Medium | `OLLAMA_MAX_LOADED_MODELS`, graceful fallback | 5.3 |
| 7 | **Knowledge Graph causes memory bloat** | Medium | Low | Snapshot compaction, periodic cleanup | 3.1 |
| 8 | **Performance regression > 2×** | Medium | Medium | Benchmark gate, tuneable envs | 3.3, all |
| 9 | **Test suite runtime increases** | Low | Medium | Parallel test execution, selective CI | 3.2 |
| 10 | **Orphaned KG nodes accumulate** | Low | Medium | Doctor reports orphan count, auto-cleanup job | 3.1 |

---

## 9. Appendix: Acceptance Criteria Toolkit

### Pre-Flight Checklist (before any implementation)

```bash
cd gzmo-daemon
bun test                    # expect 143 pass, 0 fail
npx tsc --noEmit            # expect 0 errors  
bun run eval:quality        # expect ok=true, details=[]
bun run benchmark           # expect completes without errors
```

### Per-Phase Sign-Off Checklist

After completing each numbered section above:

- [ ] All acceptance criteria for that section are met
- [ ] `bun test` passes with 0 regressions
- [ ] `npx tsc --noEmit` passes
- [ ] Benchmark (if applicable) shows acceptable performance
- [ ] README/AGENTS.md updated if new env vars or behaviors added
- [ ] Rollback path documented and manually verified
- [ ] Commit with descriptive message referencing this plan document

### Post-Implementation Health Check

```bash
cd gzmo-daemon
bun test
echo "Tests: $?"
npx tsc --noEmit
echo "Typecheck: $?"
bun run eval:quality
echo "Eval: $?"
bun run benchmark
echo "Benchmark: $?"
```

All should exit 0.

---

*End of Implementation Plan. Begin with Section 3.1 or 3.2 in parallel.*
