# Tree-of-Thought Controller — Improvement Plan

**Status:** Ready for implementation  
**Date:** 2026-05-05  
**Scope:** `gzmo-daemon/src/reasoning/` — controller, expand, evaluate, run_tot_search  
**Baseline:** Current code verified functional (see `implementation_verification_2026-05-05.md`). Six gaps identified.

---

## 1. Current State (What Works Today)

### Architecture

```
[ processTask ]
     ↓ (if GZMO_ENABLE_TOT=1)
[ runSearchTot() ]
     ├── budgetFromChaos(snap) → ToTConfig
     ├── new ToTController(config, traceId, query)
     │
     ├── expandAnalyze(root) ──→ ExpansionChild[] (always type="retrieve")
     │      └── LLM call: "decompose into 2–4 sub-tasks"
     │
     ├── addChild() for each sub-task
     │
     ├── expandRetrieve(node) ──→ SearchResult[] + ToolCallRecord[]
     │      └── hybrid search (+ fs_grep fallback if empty)
     │
     ├── addChild() reason node
     │
     ├── expandReason(node) ──→ ExpansionChild[] (type="verify")
     │      └── LLM call: "derive claims from evidence"
     │
     ├── addChild() verify nodes
     │
     ├── evaluateNode(verifyNode) ──→ score (shadow judge + confidence)
     │
     ├── prune() if score < threshold
     │
     └── bestPath() → highest-scoring terminal path

          [ answer = claims from bestPath ]
```

### Verified Capabilities
- ✅ Tree structure with parent/child relationships
- ✅ Chaos-driven budget (energy→depth, phase→bonus, valence→branches)
- ✅ Hard node cap (
- ✅ Pruning below evaluation threshold
- ✅ Shadow judge per-node scoring
- ✅ Best-path selection (weakest-link: min score along path)
- ✅ Flattening for trace persistence
- ✅ Integration with tools, beliefs, evidence packets

### Verified Gaps
1. `enableRetry` flag exists but is **never read** in expansion logic
2. **No unit tests** — zero coverage across all four reasoning files
3. `expandAnalyze` always emits `type: "retrieve"` regardless of what the sub-task actually needs
4. Confidence parsing is **regex-based** (`/high/i`) — fragile
5. Fixed pipeline depth (analyze→retrieve→reason→verify) with no dynamic deepening
6. Answer synthesis is claim concatenation with confidence labels — no quality post-processing

---

## 2. Priority 1: Unit Test Suite (2 days)

### Goal
Cover the controller and expanders with fast, deterministic tests. These run without Ollama.

### Test File 1: `src/__tests__/reasoning_controller.test.ts`

```typescript
// Tests for ToTController class (pure logic, no LLM calls)

describe("ToTController", () => {
  // 1.1 Budget basics
  test("budgetFromChaos: energy 100 + Build phase = max depth 5", () => {
    const config = budgetFromChaos({ energy: 100, phase: Phase.Build, llmValence: 0 });
    expect(config.maxDepth).toBe(5);
  });

  test("budgetFromChaos: energy 10 + Drop phase = min depth 1", () => {
    const config = budgetFromChaos({ energy: 10, phase: Phase.Drop, llmValence: 0 });
    expect(config.maxDepth).toBe(1);
  });

  test("budgetFromChaos: high valence = more branches", () => {
    const high = budgetFromChaos({ energy: 50, phase: Phase.Idle, llmValence: 0.8 });
    const low = budgetFromChaos({ energy: 50, phase: Phase.Idle, llmValence: -0.8 });
    expect(high.maxBranchesPerNode).toBeGreaterThan(low.maxBranchesPerNode);
  });

  test("budgetFromChaos: env caps are respected", () => {
    process.env.GZMO_TOT_MAX_NODES = "8";
    const config = budgetFromChaos({ energy: 100, phase: Phase.Build, llmValence: 0 });
    expect(config.maxTotalNodes).toBe(8);
    delete process.env.GZMO_TOT_MAX_NODES;
  });

  // 1.2 Tree construction
  test("create controller with root", () => {
    const tot = new ToTController(config(), "trace-1", "test query");
    expect(tot.root).toBeDefined();
    expect(tot.root!.type).toBe("analyze");
    expect(tot.totalNodes).toBe(1);
  });

  test("addChild increases totalNodes", () => {
    const tot = new ToTController(config(), "trace-1", "test");
    tot.addChild(tot.root!, { node_id: "c1", parent_id: "tot_root", type: "retrieve", depth: 1, prompt_summary: "s", outcome: "success", elapsed_ms: 0, timestamp: "" });
    expect(tot.totalNodes).toBe(2);
    expect(tot.root!.children.length).toBe(1);
  });

  // 1.3 Expansion rules
  test("canExpand: returns false for explored nodes", () => {
    const tot = new ToTController(config(), "t", "q");
    tot.root!.explored = true;
    expect(tot.canExpand(tot.root!)).toBe(false);
  });

  test("canExpand: returns false when maxTotalNodes reached", () => {
    const cfg = { ...config(), maxTotalNodes: 1 };
    const tot = new ToTController(cfg, "t", "q");
    expect(tot.canExpand(tot.root!)).toBe(false);
  });

  test("canExpand: verify nodes are NOT expandable", () => {
    const tot = new ToTController(config(), "t", "q");
    const verify: ToTNode = { ...makeNode("v1", tot.root!, "verify"), children: [], explored: false, pruned: false };
    tot.addChild(tot.root!, verify);
    expect(tot.canExpand(verify)).toBe(false);
  });

  // 1.4 Pruning
  test("prune removes node and all descendants", () => {
    const tot = new ToTController(config(), "t", "q");
    const child = tot.addChild(tot.root!, makeNode("c1", tot.root!, "retrieve"));
    const grandchild = tot.addChild(child, makeNode("g1", child, "reason"));
    tot.prune(child);
    expect(child.pruned).toBe(true);
    expect(grandchild.pruned).toBe(true);
    expect(tot.root!.pruned).toBe(false);
  });

  // 1.5 Best path selection
  test("bestPath: returns empty when no terminal nodes", () => {
    const tot = new ToTController(config(), "t", "q");
    expect(tot.bestPath().length).toBe(0);
  });

  test("bestPath: prefers higher-scoring verify node", () => {
    const tot = new ToTController(config(), "t", "q");
    const retrieve = tot.addChild(tot.root!, makeNode("r1", tot.root!, "retrieve"));
    const reason = tot.addChild(retrieve, makeNode("re1", retrieve, "reason"));
    const verifyA = tot.addChild(reason, makeNode("vA", reason, "verify"));
    verifyA.score = 0.9;
    const verifyB = tot.addChild(reason, makeNode("vB", reason, "verify"));
    verifyB.score = 0.3;

    const path = tot.bestPath();
    expect(path[path.length - 1]!.node_id).toBe("vA");
  });

  test("bestPath: pruned nodes are excluded", () => {
    const tot = new ToTController(config(), "t", "q");
    const retrieve = tot.addChild(tot.root!, makeNode("r1", tot.root!, "retrieve"));
    const reason = tot.addChild(retrieve, makeNode("re1", retrieve, "reason"));
    const verifyBad = tot.addChild(reason, makeNode("vB", reason, "verify"));
    verifyBad.score = 0.1;
    tot.prune(verifyBad);

    expect(tot.bestPath().length).toBe(0);
  });

  test("bestPath: weakest-link scoring", () => {
    const tot = new ToTController(config(), "t", "q");
    const r = tot.addChild(tot.root!, makeNode("r", tot.root!, "retrieve"));
    r.score = 0.9;
    const re = tot.addChild(r, makeNode("re", r, "reason"));
    re.score = 0.5; // weak link
    const v = tot.addChild(re, makeNode("v", re, "verify"));
    v.score = 0.95;

    const re2 = tot.addChild(r, makeNode("re2", r, "reason"));
    re2.score = 0.8;
    const v2 = tot.addChild(re2, makeNode("v2", re2, "verify"));
    v2.score = 0.85;

    const path = tot.bestPath();
    // Path through re2 (min=0.8) beats path through re (min=0.5)
    expect(path[path.length - 1]!.node_id).toBe("v2");
  });

  // 1.6 Node ID generation
  test("nextNodeId is deterministic", () => {
    const tot = new ToTController(config(), "t", "q");
    expect(tot.nextNodeId()).toBe("tot_1");
    tot.addChild(tot.root!, makeNode(tot.nextNodeId(), tot.root!, "retrieve"));
    expect(tot.nextNodeId()).toBe("tot_2");
  });

  // 1.7 Flatten for trace
  test("flattenForTrace strips implementation fields", () => {
    const tot = new ToTController(config(), "t", "q");
    const flat = tot.flattenForTrace();
    expect(flat[0]).not.toHaveProperty("children");
    expect(flat[0]).not.toHaveProperty("explored");
    expect(flat[0]).not.toHaveProperty("pruned");
  });
});
```

### Acceptance Criteria (Priority 1)

- [ ] `bun test src/__tests__/reasoning_controller.test.ts` passes with 12+ assertions
- [ ] All tests are deterministic (no LLM calls, no filesystem, no randomness)
- [ ] Tests cover budget logic, tree ops, pruning, path selection, flattening
- [ ] Coverage of `controller.ts` ≥ 80% (measured via `--coverage` if available)

---

## 3. Priority 2: Retry Logic (1 day)

### Problem

`budgetFromChaos()` computes `enableRetry: snap.energy > 40`, but `runSearchTot()` never reads this flag. When a verification node scores below threshold, it is simply pruned — no recovery attempt.

### Proposed Behavior

```
verifyNode scores 0.3 (below threshold 0.5)
  ├── IF enableRetry AND node has not been retried:
  │     ├── Create retry child with adjusted prompt
  │     │   ("Your previous claim scored low. Re-examine the evidence.\n" +
  │     │    "Focus on claims directly supported by quoted text.")
  │     ├── Run expandReason again on parent
  │     └── Re-evaluate the new verify node
  │
  └── ELSE: prune as before
```

### Implementation Steps

**Step 1: Add retry tracking to `ToTNode`**

```typescript
// In controller.ts, add to ToTNode type:
export type ToTNode = ReasoningNode & {
  children: ToTNode[];
  explored: boolean;
  pruned: boolean;
  retryCount?: number;  // how many times this node's parent was retried
};
```

**Step 2: Add `retryChild()` method to `ToTController`**

```typescript
/**
 * Create a retry sibling for a failed node.
 * The retry node shares the same parent but gets a fresh chance.
 */
retryNode(failedNode: ToTNode, retrySummary: string): ToTNode | null {
  if (!failedNode.parent_id) return null;
  const parent = this.nodes.find((n) => n.node_id === failedNode.parent_id) as ToTNode | undefined;
  if (!parent) return null;
  if (this.totalNodes >= this.config.maxTotalNodes) return null;

  const retry: ToTNode = {
    node_id: this.nextNodeId(),
    trace_id: this.traceId,
    parent_id: parent.node_id,
    type: failedNode.type,
    depth: failedNode.depth,
    prompt_summary: `Retry: ${retrySummary.slice(0, 100)}`,
    outcome: "success",
    elapsed_ms: 0,
    timestamp: new Date().toISOString(),
    children: [],
    explored: false,
    pruned: false,
    retryCount: (failedNode.retryCount ?? 0) + 1,
  };
  parent.children.push(retry);
  this.nodes.push(retry);
  return retry;
}
```

**Step 3: Integrate retry into `runSearchTot()`**

In the verify loop, after scoring:

```typescript
if ((verifyNode.score ?? 0) < budget.evaluationThreshold) {
  if (budget.enableRetry && !verifyNode.retryCount) {
    // Retry: re-run reasoning on the parent evidence
    const retryNode = tot.retryNode(verifyNode, "re-examine evidence for stronger claims");
    if (retryNode) {
      const retrySpecs = await expandReason(
        reasonNode, // parent reason node (has evidence context)
        p.systemPrompt,
        evidenceCtx,
        retrieveNode.prompt_summary + "\n\nRetry guidance: focus on claims directly supported by verbatim quotes.",
        inferDetailed,
        temp,
        maxTok,
      );
      // Evaluate retry node, accept if better, else prune both
      // ... (similar to original verify loop but limited to 1 retry)
    }
  }
  tot.prune(verifyNode);
}
```

### Acceptance Criteria (Priority 2)

- [ ] `enableRetry` flag affects behavior when energy > 40
- [ ] Verify node below threshold with retry enabled creates a retry sibling
- [ ] Retry sibling is evaluated and kept if score improves above threshold
- [ ] Retry does not exceed maxTotalNodes
- [ ] Retry is capped at 1 per original node (no infinite loops)
- [ ] Controller test suite covers retry logic

---

## 4. Priority 3: Dynamic Node Typing (1 day)

### Problem

`expandAnalyze()` always returns `type: "retrieve"` for every sub-task. A sub-task like "read the exact file contents of wiki/overview.md" should use `vault_read` directly, not hybrid search.

### Proposed Solution: Intent Classifier

```typescript
// In expand.ts, before returning children:
function classifyIntent(subTaskText: string): "retrieve" | "vault_read" | "dir_list" {
  const t = subTaskText.toLowerCase();
  if (/read\s+(?:the\s+)?(?:contents?|file)/.test(t)) return "vault_read";
  if (/list\s+(?:files?|directory|contents)/.test(t)) return "dir_list";
  return "retrieve";
}
```

The `ExpansionChild` type stays the same (`type: ReasoningNodeType`), but `expandAnalyze` uses the intent to set the appropriate type.

### Implementation

```typescript
// In expandAnalyze():
const children: ExpansionChild[] = lines.slice(0, 4).map((line, i) => {
  const text = line.trim().replace(/^\d+[\).]\s*/, "");
  const intent = classifyIntent(text);
  return {
    type: intent,
    prompt_summary: `Sub-task ${i + 1}: ${text.slice(0, 120)}`,
  };
});
```

Then `runSearchTot()` handles each node type appropriately:

```typescript
// In runSearchTot() retrieval loop:
for (const retrieveNode of retrieves) {
  if (retrieveNode.type === "vault_read") {
    // Direct tool call, skip hybrid search
    const pathMatch = retrieveNode.prompt_summary.match(/([\w\/\-]+\.md)/);
    if (pathMatch && toolEnabled) {
      const { record } = await dispatchTool("vault_read", { path: pathMatch[1], max_chars: 8000 }, toolCtx);
      // Create evidence from tool result directly
    }
  } else {
    // Original hybrid search path
    const { children, evidence, toolRecords } = await expandRetrieve(...);
  }
}
```

### Acceptance Criteria (Priority 3)

- [ ] Sub-task mentioning "read file X.md" skips hybrid search and uses `vault_read`
- [ ] Sub-task mentioning "list files" uses `dir_list`
- [ ] Default behavior (hybrid search) preserved for generic queries
- [ ] Intent classifier tested with 5+ examples

---

## 5. Priority 4: Confidence Parsing Fix (½ day)

### Problem

```typescript
const conf = /high/i.test(text) ? 0.9 : /medium/i.test(text) ? 0.6 : /low/i.test(text) ? 0.35 : 0.5;
```

Breaks on: `"Highlight the main points"` → matches `/high/i` → confidence 0.9 incorrectly.

### Fix: Anchor the pattern

```typescript
function parseConfidence(text: string): number {
  // Look for explicit confidence annotation patterns
  const t = text.toLowerCase();

  // Ordered: most specific first
  if (/\bconfidence\s*[:=]?\s*(?:high|0\.8|0\.9)/.test(t)) return 0.9;
  if (/\bconfidence\s*[:=]?\s*(?:medium|0\.5|0\.6)/.test(t)) return 0.6;
  if (/\bconfidence\s*[:=]?\s*(?:low|0\.2|0\.3)/.test(t)) return 0.35;

  // Fallback: word boundaries around standalone confidence words
  if (/\bhigh\b/.test(t) && /\b(confidence|certainty|sure)\b/.test(t)) return 0.9;
  if (/\bmedium\b/.test(t) && /\b(confidence|certainty|sure)\b/.test(t)) return 0.6;
  if (/\blow\b/.test(t) && /\b(confidence|certainty|sure)\b/.test(t)) return 0.35;

  return 0.5;
}
```

### Better: Ask model to output structured confidence

Modify `expandReason()` prompt:

```
Based ONLY on the evidence above, derive concrete claims.
Format each claim as:
- CLAIM: <single sentence>
  CONFIDENCE: High | Medium | Low
  SOURCES: <evidence IDs, e.g. E1, E3>
```

Then parse with a more robust regex:
```typescript
const claimMatch = line.match(/CLAIM:\s*(.+?)\s*CONFIDENCE:\s*(High|Medium|Low)/i);
```

### Acceptance Criteria (Priority 4)

- [ ] `"Highlight the main points"` parses as default (0.5), not High
- [ ] `"CLAIM: X is Y. CONFIDENCE: High"` parses as 0.9
- [ ] Test covers 8+ edge cases including false positives

---

## 6. Priority 5: Dynamic Depth / Beam Search (2 days)

### Problem

The current pipeline is fixed-depth: analyze → retrieve → reason → verify. There's no mechanism to:
- Go deeper when a branch looks promising ("this claim needs more evidence")
- Expand horizontally when retrieval returns ambiguous results
- Re-rank branches after new evidence arrives

### Proposed: Beam Search with Dynamic Expansion

Replace the fixed loop in `runSearchTot()` with a generic expansion loop:

```typescript
// New algorithm:
const beamWidth = budget.maxBranchesPerNode;
let iteration = 0;
const maxIterations = budget.maxTotalNodes;

while (iteration < maxIterations) {
  // Find all unexplored nodes that can be expanded
  const candidates = tot.activeNodes.filter((n) => tot.canExpand(n));
  if (candidates.length === 0) break;

  // Score and rank candidates by potential (parent score + depth penalty)
  const ranked = candidates
    .map((n) => ({
      node: n,
      priority: estimatePriority(n), // see below
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, beamWidth);

  // Expand top candidates
  for (const { node } of ranked) {
    if (tot.totalNodes >= budget.maxTotalNodes) break;
    await expandNode(node, tot, /* ...context... */);
    node.explored = true;
  }

  iteration++;
}
```

### Priority Function

```typescript
function estimatePriority(node: ToTNode): number {
  const parentScore = node.parent_id
    ? (tot.nodes.find((n) => n.node_id === node.parent_id)?.score ?? 0.5)
    : 0.5;

  // Prefer nodes closer to root (early exploration)
  const depthBonus = 1.0 / (node.depth + 1);

  // Prefer nodes with evidence (retrieval that found something)
  const evidenceBonus = (node.evidence_cited?.length ?? 0) * 0.05;

  return parentScore * 0.6 + depthBonus * 0.3 + evidenceBonus * 0.1;
}
```

### Benefits

1. **No fixed pipeline** — nodes expand based on priority, not position
2. **Beam width controls breadth** — exactly the chaos-controlled `maxBranchesPerNode`
3. **Promising branches get more compute** — high parent score → higher priority
4. **Retrieval with poor results gets less follow-up** — low evidence_bonus

### Implementation Complexity

This is a moderate refactor of `runSearchTot()`. The current fixed-loop code is approximately 80 lines. The beam-search version would be ~120 lines but significantly more flexible.

### Acceptance Criteria (Priority 5)

- [ ] `runSearchTot()` uses beam-search expansion loop
- [ ] `expandNode()` dispatches to appropriate expander based on `node.type`
- [ ] Priority function is unit-tested with mock trees
- [ ] A branch with high parent score gets expanded before a branch with low score
- [ ] Token budget is still respected (maxTotalNodes cap)
- [ ] Existing ToT scenarios still produce traces of similar quality

---

## 7. Priority 6: Richer Answer Synthesis (1 day)

### Problem

Current answer synthesis:
```typescript
answer = bestClaims.map(c => `- ${c.text} _(confidence: ...)_`).join("\n");
```

This is just a list. It doesn't:
- Group related claims
- Note conflicts between branches
- Explain why the best path was chosen
- Include the evidence directly in the answer

### Proposed: Structured Synthesis

```typescript
interface SynthesisResult {
  claims: Array<{ text: string; confidence: string; evidence: string[] }>;
  discarded: Array<{ text: string; reason: string }>;
  synthesis_note: string;
}

function synthesizeAnswer(path: ToTNode[], allNodes: ToTNode[]): SynthesisResult {
  const claims = path.flatMap((n) =>
    (n.claims ?? []).map((c) => ({
      text: c.text,
      confidence: c.confidence >= 0.7 ? "High" : c.confidence >= 0.4 ? "Medium" : "Low",
      evidence: c.sources,
    })),
  );

  // Collect pruned siblings for transparency
  const discarded: Array<{ text: string; reason: string }> = [];
  for (const node of path) {
    const parent = allNodes.find((n) => n.node_id === node.parent_id);
    if (!parent) continue;
    for (const sibling of parent.children) {
      if (sibling.pruned && sibling.claims) {
        discarded.push({
          text: sibling.claims.map((c) => c.text).join("; "),
          reason: `score ${sibling.score?.toFixed(2) ?? "?"} below threshold`,
        });
      }
    }
  }

  const synthesis_note =
    discarded.length > 0
      ? `Selected from ${path.length} reasoning steps. ${discarded.length} alternative path(s) were discarded.`
      : `Selected from ${path.length} reasoning steps.`;

  return { claims, discarded, synthesis_note };
}
```

Then render as:
```
## Reasoned Answer

<synthesis_note>

- <claim> _(confidence: High — evidence: E1, E3)_
- <claim> _(confidence: Medium — evidence: E2)_

---
*Alternative paths explored but not selected:*
- <discarded claim> _(reason: score 0.3 below threshold)_
```

### Acceptance Criteria (Priority 6)

- [ ] Discarded branches are noted in the answer (transparency)
- [ ] Claims include evidence IDs inline
- [ ] Synthesis note explains the reasoning process
- [ ] Format is still valid Markdown with bullet points

---

## Implementation Order

| Priority | Feature | Effort | Dependencies |
|----------|---------|--------|-------------|
| 1 | Unit test suite | 2 days | None |
| 2 | Retry logic | 1 day | Controller tests (to verify behavior) |
| 4 | Confidence parsing fix | ½ day | None |
| 3 | Dynamic node typing | 1 day | Expand tests |
| 6 | Richer answer synthesis | 1 day | Best-path logic tests |
| 5 | Beam search / dynamic depth | 2 days | All above (refactors core loop) |

**Total: 7.5 days**

**Recommended order:** 1 → 4 → 2 → 3 → 6 → 5

Reason: Tests first (safety), then small fixes (confidence, retry), then structural improvements (typing, synthesis), then the big refactor (beam search).

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Beam search refactor breaks existing behavior | Keep old `runSearchTot()` as `runSearchTotLegacy()`, enable beam via env |
| Retry loop increases token usage | Cap at 1 retry per node, respect maxTotalNodes |
| Dynamic typing causes unexpected tool calls | Intent classifier whitelist: only vault_read/dir_list/retrieve |
| Richer synthesis makes eval harness fail | Keep format compatible — bullets + confidence labels same as before |
| Tests require exposing internal ToTController methods | Use `export` for test-only methods; mark with `/** @internal */` |

---

## Success Criteria (End of All Priorities)

1. `bun test src/__tests__/reasoning_*.test.ts` passes with ≥ 30 assertions
2. `bun run eval:quality` still passes (zero regressions)
3. ToT with `GZMO_ENABLE_TOT=1` produces observable differences:
   - Retry nodes appear in traces when energy > 40
   - Dynamic typing causes `vault_read` nodes for read-oriented sub-tasks
   - Answers include synthesis notes
4. Performance: ToT task takes ≤ 3× single-shot time (measured on 5 representative queries)

---

*Plan complete. Start with Priority 1 (tests) and work down.*
