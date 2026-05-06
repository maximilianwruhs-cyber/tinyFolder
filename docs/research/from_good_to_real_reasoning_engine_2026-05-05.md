# From Good to Real: What GZMO Needs to Become a Reasoning Engine

**Date:** 2026-05-05  
**Scope:** `gzmo-daemon/src/` — architecture gap analysis  
**Sources read:** `engine.ts`, `run_tot_search.ts`, `controller.ts`, `feedback.ts`, `fitness_scorer.ts`, `memory.ts`, `self_ask.ts`, `eval_harness.ts`, `reasoning_trace.ts`, `expand.ts`, `evaluate.ts`, `synthesis.ts`

---

## What GZMO Actually Is Today

GZMO v0.3.0 is best described as a **stateless, single-task deterministic pipeline with a tree-structured optional overlay**. Here's the honest inventory:

| Capability | Status | Limitation |
|---|---|---|
| Per-task reasoning traces | ✅ | Never read by future tasks |
| Tree-of-Thought expansion | ✅ | One-shot decomposition, no replanning |
| Shadow-judge evaluation | ✅ | Only at terminal nodes, not intermediate |
| Tool use (read, grep, list) | ✅ | Leaf nodes only, no tool→tool chaining |
| Fitness scoring (z = Q×E×(1−V)) | ✅ | Computed but never fed back into behavior |
| Episodic memory (last 5 tasks) | ✅ | Plain-text summaries, no structured retrieval |
| Chaos-driven parameter modulation | ✅ | Adjusts temperature/tokens, not strategy |
| Retry on failure | ✅ | Same approach with a hint, not a different approach |
| Belief tracking (claims.jsonl) | ✅ | Keyword-level contradiction, no semantic cross-reference |

GZMO is a **very good output compiler**. But a *reasoning engine* is something else: it learns from its mistakes, adapts its strategy, recalls what worked before, and reasons about its own reasoning. GZMO does none of these.

---

## The Seven Architectural Gaps

These are not feature requests. These are **architectural shifts** — changes to the fundamental shape of the system.

---

### Gap 1: No Meta-Reasoning (The "Why Did I Fail?" Problem)

**Current behavior:** When all branches in a ToT task score below threshold, GZMO returns `insufficient evidence`. It does not ask: *"Was my decomposition wrong? Was my retrieval query poorly formed? Should I try a completely different sub-task breakdown?"*

**What real reasoning engines do:**
- **Reflexion** (Shinn et al.): After failure, generates a self-critique and stores it in memory. Next time a similar task arrives, the critique is prepended to the prompt.
- **DeepSeek-R1**: The model's RL training causes it to naturally backtrack — "Wait, that assumption was wrong. Let me reconsider."

**What's needed:** A `critique` node type. When `bestPath()` returns empty:

```
[CRITIQUE] All 3 branches failed (scores: 0.3, 0.35, 0.28).
Hypotheses:
  1. Decomposition too broad — sub-tasks not independently verifiable
  2. Evidence insufficient — vault lacks docs on this topic
  3. Confidence threshold too high for this query type
Recommendation: Re-analyze with narrower scope, or return insufficient evidence.
```

This critique becomes a thought seed (absorbed by the chaos engine) and a trace artifact (queryable later).

---

### Gap 2: The Learning Loop Is Broken (Fitness → Nowhere)

**Current behavior:** Every completed task appends a `task_perf` JSONL entry with:
- `ok: true/false`
- `total_ms`
- `route_judge` metrics (citation rate, backtick compliance, adversarial reject)

These entries accumulate in `GZMO/perf.jsonl` and are **never consumed by the engine**.

**What real reasoning engines do:**
- **DSPy** (Khattab et al.): Evaluates modules against a metric, then compiles (optimizes) prompts and multi-step pipelines to maximize that metric.
- **Voyager** (Wang et al.): Builds a skill library — code that solved past problems is retrieved and reused.

**What's needed:** A `StrategyOptimizer` that runs periodically (or on-demand):

```
Input: Last 50 perf.jsonl entries + reasoning traces
Process:
  1. Cluster by task type (search vs think vs chain)
  2. For search tasks: correlate decomposition style with citation rate
  3. For think tasks: correlate reasoning depth with task completion rate
  4. Identify which prompt templates produce highest z-scores
  5. Mutate low-performing templates; promote high-performing ones
Output: Updated system prompt fragments stored in vault
```

This is not speculative — GZMO already computes z-scores. It just never acts on them.

---

### Gap 3: Cross-Task Reasoning Memory Is Structural, Not Semantic

**Current behavior:** `TaskMemory` holds 5 plain-text summaries:
```
Recent tasks:
- 001_task.md: Explain the Lorenz attractor...
- 002_task.md: Where does the daemon write health.md?...
```

This is injected into the system prompt. But it's **not queryable**. If the current task is "How does allostasis relate to the chaos engine?", the memory doesn't know that Task 47 3 weeks ago also connected these concepts.

**What real reasoning engines do:**
- Use past reasoning traces as a **retrieval corpus**. Embed trace summaries and retrieve them when a new task is semantically similar.
- Maintain a **skill index**: "For queries about file paths, the vault_read-first strategy works 90% of the time."

**What's needed:**
1. Index `GZMO/Reasoning_Traces/*.json` into the embedding store (or a separate trace index)
2. Before `expandAnalyze()`, search past traces for similar tasks
3. Include winning strategies from similar past tasks in the analyze prompt
4. Update a `strategy_success.jsonl` with per-task-type statistics

---

### Gap 4: No Recursive Replanning (The Analyze-Once Trap)

**Current behavior:**
```
analyze → [retrieveA, retrieveB, retrieveC]
  retrieveA → reason → verify (score 0.3) → prune
  retrieveB → reason → verify (score 0.4) → prune
  retrieveC → reason → verify (score 0.35) → prune
→ bestPath() empty → fail-closed
```

The analyze step ran **once**. It never gets another chance. A real reasoner would say: *"All my sub-tasks failed. My original decomposition was wrong. Let me re-analyze the problem from scratch with the knowledge that broad sub-tasks don't work for this query."*

**What real reasoning engines do:**
- **AlphaGo / MCTS**: Every simulation informs the policy. Failed branches update the prior, making re-analysis better.
- **LLMCompiler** (Kim et al.): Plans are DAGs, not trees. When a node fails, the DAG can be rewired.

**What's needed:** A `replan_threshold`. If ≥50% of branches fail:
1. Generate a critique (Gap 1)
2. Re-run `expandAnalyze()` with critique context
3. New decomposition gets `generation: 2` label
4. Capped at 2 generations to avoid combinatorial explosion

---

### Gap 5: Single Model, Single Cost Function

**Current behavior:** Everything goes through `OLLAMA_MODEL` (one model, one temperature, one token budget). The chaos engine modulates temperature (0.3→1.2) and maxTokens (400→800), but it's still the **same model** doing everything.

**What real reasoning engines do:**
- **Mixture-of-Agents** (Wang et al.): Multiple models debate and vote.
- **AlphaGo architecture**: Policy net (fast, cheap) proposes moves. Value net (more expensive) evaluates them. MCTS (deterministic) selects.
- **LM Symphony**: Route queries by complexity. Easy query → 8B model. Hard query → 70B model. Verification → separate judge model.

**What's needed for GZMO:** Multi-model routing without cloud dependency:

```typescript
// Fast model for decomposition and routing (always loaded)
const FAST_MODEL = "qwen2.5:7b" || "hermes3:8b";

// Deep model for reasoning (loaded on demand)
const DEEP_MODEL = process.env.OLLAMA_DEEP_MODEL || "qwq:32b";

// Use fast model for:
//   - expandAnalyze (decomposition)
//   - classifyIntent (routing)
//   - answer synthesis for simple queries

// Use deep model for:
//   - expandReason (claim derivation)
//   - evaluateNode (shadow judge verifications)
//   - critique generation (Gap 1)

// Quantified impact: 70% of calls go through fast model → ~3× cheaper
```

Ollama supports multiple loaded models. `OLLAMA_MAX_LOADED_MODELS` can be tuned. The bottleneck is not hardware — it's the absence of a routing decision.

---

### Gap 6: Tools Are Leaves, Not Chain Links

**Current behavior:** `expandRetrievalBranch` calls one tool per node. The result is compiled into an evidence packet. There's no mechanism where:
- `vault_read("A.md")` discovers a reference to B
- Therefore `vault_read("B.md")` is needed
- Therefore `reason` over combined A+B

**What real reasoning engines do:**
- **ReAct** (Yao et al.): Thought → Action → Observation → Thought → ... The observation directly feeds back into the next thought.
- **Tree of Code** (Liu et al.): The LLM generates Python code to verify its own reasoning. The execution output feeds back into the tree.

**What's needed:** A feedback edge in the reasoning graph:

```
retrieveNode (vault_read "overview.md")
  → tool result: "See details in telemetry.md §3"
  → NEW edge: auto-generate retrieveNode for "telemetry.md §3"
  → Only if budget allows and evidence gap detected
```

This requires a new node type or a post-retrieval analysis pass: "Does this evidence contain pointers to other evidence I should fetch?"

---

### Gap 7: Verification Is End-of-Pipeline Only

**Current behavior:** Shadow judge runs at verify nodes. But what if:
- The retrieve step found 0 relevant documents? (Currently: falls through to tool fallback, no explicit verification that this was the right search)
- The reason step produced claims unsupported by evidence? (Currently: only caught at verify, after the LLM call)
- The analyze step decomposed the task into irrelevant sub-tasks? (Currently: never checked)

**What real reasoning engines do:**
- **Proof assistants** (Lean, Coq): Every inference step is checked by a kernel. Not just the conclusion.
- **Chain-of-Verification** (Dhuliawala et al.): After generating an answer, the model is asked to plan verification steps, then execute them.

**What's needed:** Per-node verification gates:

| Node Type | Verification |
|---|---|
| analyze | Are sub-tasks non-overlapping and covering? (LLM self-check) |
| retrieve | Did evidence retrieval find ≥1 relevant snippet? (cosine threshold) |
| reason | Are claims entailed by evidence? (embedding similarity claim→evidence) |
| verify | Is the answer consistent across all claims? (shadow judge) |
| answer | Does the final output satisfy the original task constraints? (shape check) |

These don't need to be expensive. The retrieve verification is deterministic (score threshold). The analyze verification is one cheap LLM call. The reason verification can use embedding similarity of claim vs evidence text.

---

## What GZMO Is NOT Missing (Common Over-Engineering Traps)

To keep this honest, here are things that sound important but are **not required** for becoming a real reasoning engine:

| Trap | Why skip it |
|---|---|
| Web search / API integrations | Violates sovereignty; tools should remain local |
| Multi-agent debate | Overkill for a single-user daemon; adds coordination complexity |
| Formal proof integration | Requiring Lean/Coq makes the system inaccessible; embedding-based verification is "good enough" for most tasks |
| Real-time streaming reasoning | Traces are for audit, not UX; batch reasoning is fine |
| Distributed computing | Single-machine local is the whole point of GZMO |

---

## The Honest Gap Report: Implementation Path

If you wanted to turn GZMO into a genuine reasoning engine, here's the prioritized path:

### Phase A: Close the Learning Loop (Highest Impact, Lowest Risk)
**Time:** 1 week  
**What:** Make fitness scores actually change behavior.

1. Add a `StrategyLedger` that reads `perf.jsonl` and `reasoning_traces/index.jsonl`
2. After every 10 tasks, compute: which decomposition styles correlate with success?
3. Store winning prompt fragments in `GZMO/strategy_ledger.jsonl`
4. Before `expandAnalyze()`, inject top-2 winning strategies for this task type

**Why first:** This is purely additive. It doesn't change any existing pipeline. It just feeds data back in.

### Phase B: Cross-Task Trace Memory
**Time:** 1 week  
**What:** Past traces become retrievable knowledge.

1. Add trace chunks to the embedding store alongside vault documents
2. Tag trace chunks with metadata: `{ task_type, success, model, depth }`
3. Before task processing, retrieve similar past traces
4. Include "Past similar tasks used this approach..." in analyze prompt

**Why second:** This makes the engine stateful across sessions. A user notices their second similar query gets better answers.

### Phase C: Critique + Replanning
**Time:** 1 week  
**What:** When all branches fail, don't give up — diagnose and retry differently.

1. Add `critiqueNode()` that runs when `bestPath()` is empty
2. Critique analyzes: decomposition quality, evidence sufficiency, threshold appropriateness
3. If critique recommends replanning → re-run `expandAnalyze()` with critique context
4. Cap at 1 replan per task

**Why third:** This is where the engine starts feeling "smart." It doesn't just follow a script; it adjusts its approach.

### Phase D: Intermediate Verification Gates
**Time:** 3–4 days  
**What:** Verify at every node, not just the end.

1. Retrieve gate: fail if evidence max score < 0.2 → trigger tool fallback earlier
2. Reason gate: embedding similarity between claim and evidence < 0.3 → flag as unsupported
3. Analyze gate: self-check that sub-tasks cover the original query

**Why fourth:** Catches errors earlier, saving tokens. Lower risk than Phase C because it's more reactive gates, not active replanning.

### Phase E: Multi-Model Routing + Tool Chaining
**Time:** 1.5 weeks  
**What:** Use the right model for the right job; tools can trigger more tools.

1. Routing: fast model (8B) for decomposition, deep model (32B+) for reasoning
2. Tool chaining: post-retrieval scan for "see also" references → auto-add follow-up reads
3. Budget-aware: track which model calls consumed what tokens, report in trace

**Why last:** Hardware-dependent. Not everyone can run two models. Should be opt-in.

---

## Total Effort Estimate

| Phase | Time | Risk |
|---|---|---|
| A: Learning loop | 1 week | Low |
| B: Trace memory | 1 week | Low |
| C: Critique + replan | 1 week | Medium |
| D: Intermediate gates | 3–4 days | Low |
| E: Multi-model + chaining | 1.5 weeks | Medium |
| **Total** | **5 weeks** | Gradual |

---

## The Single Most Important Change

If you only did **one thing**, make it **Phase A: Close the Learning Loop**.

GZMO already computes z-scores. It already has reasoning traces. It already has task performance data. The only missing piece is **a small module that reads this data and whispers it into the next task's ear**.

```typescript
// Pseudocode for the highest-impact 50-line change:
async function loadWinningStrategies(vaultPath: string, taskType: string): Promise<string[]> {
  const ledger = await readJsonl(`${vaultPath}/GZMO/strategy_ledger.jsonl`);
  const relevant = ledger
    .filter((e) => e.task_type === taskType && e.z_score > 0.8)
    .sort((a, b) => b.z_score - a.z_score)
    .slice(0, 2);
  return relevant.map((e) => `Strategy: ${e.decomposition_style} (z=${e.z_score})`);
}
```

This is the difference between a system that **does** things and a system that **learns**.

---

## Conclusion

GZMO is not a reasoning engine yet. It is an **exceptionally well-engineered deterministic LLM pipeline with reasoning-shaped scaffolding**. The gaps are architectural: learning, memory, meta-reasoning, and adaptive strategy.

The good news: each gap is well-understood in the research literature, and none require cloud APIs or massive hardware. They require ** code** — specifically, modules that consume the data GZMO already produces.

The project has built the nervous system. What's missing is the cortex that looks at the nervous system's output and says: *"Next time, do it differently."*

---

*End of gap analysis. Ready for implementation planning on any phase.*
