# A Proper Reasoning Engine for tinyFolder / GZMO

**Status:** Research Phase  
**Date:** 2026-05-05  
**Author:** Research cycle (agentic study)  
**Reading list:** `engine.ts`, `chaos.ts`, `self_ask.ts`, `mind_filter.ts`, `evidence_packet.ts`, `eval_harness.ts`, `shadow_judge.ts`, `response_shape.ts`, `engine_hooks.ts`, `pipelines/search_pipeline.ts`, `pipelines/think_pipeline.ts`, `FINE_TUNING.md`, `treasures_scan_2026-04-28.md`

---

## Executive Summary

GZMO today is a **closed-loop task executor** with sophisticated deterministic scaffolding. What it is NOT yet: a true *reasoning engine* that can decompose novel problems, explore solution spaces, verify intermediate claims, and learn from failure. This document proposes a three-tier evolutionary path from the current **Smart Core v0.3.0** toward a sovereign reasoning substrate.

**Current reasoning capabilities:**
| Capability | Status | Where |
|------------|--------|-------|
| Evidence-first retrieval | ✅ Production | `search.ts` + `evidence_packet.ts` |
| Fail-closed safety verifier | ✅ Production | `verifier_safety.ts` |
| Citation enforcement | ✅ Production | `citation_formatter.ts`, `engine_hooks.ts` |
| Multi-part decomposition | ✅ Production | `response_shape.ts` + `search_pipeline.ts` |
| Self-evaluation / rewrite | ✅ Production | `self_eval.ts` |
| Shadow judge (pointwise) | ✅ Production | `shadow_judge.ts` |
| Autonomous gap detection | ✅ Production | `self_ask.ts` Gap Detective |
| Chaos-driven parameter modulation | ✅ Production | `chaos.ts` + `engine_state.ts` |
| Pre-inference cognitive filter | ✅ Production | `mind_filter.ts` |
| Chain-of-thought → structured output | ⚠️ Partial | Strips `<thinking>` blocks, no native CoT |
| Recursive decomposition (Tree of Thought) | ❌ Missing | Needed for multi-step reasoning |
| Tool use / function calling | ❌ Missing | Needed for external state access |
| Reasoning trace persistence | ❌ Missing | Every task is memoryless beyond episodic notes |
| Probabilistic belief tracking | ❌ Missing | Current engine is 0/1 (succeed/fail) |
| Validation via parallel reasoning paths | ❌ Missing | Self-ask is single-path |
| Learning from eval fitness | ❌ Missing | Fitness scores computed, not fed back into prompts |
| Variable-compute reasoning budgets | ❌ Missing | Fixed `maxTokens`, no adaptive depth |

---

## Part 1: Current Architecture Deep-Dive

### 1.1 The Inference Pipeline (deterministic scaffolding)

```
[Task Inbox]
     ↓
[Task Routing] — action: think | search | chain
     ↓
[Pipeline Prepare]
     ├─ search: gatherLocalFacts → vaultStateIndex → hybridSearch → evidencePacket → systemPrompt
     ├─ think: projectGrounding(optional) → systemPrompt
     └─ chain: projectGrounding → systemPrompt
     ↓
[LLM call] — Ollama via ai-sdk, temperature/valence/phase modulated by chaos
     ↓
[Post-processing layer] — deterministic shaping & safety verification
     ├─ cite formatting, bullet enforcement, part coverage
     ├─ safety verifier (backticked paths, side-effect claims)
     ├─ self-eval rewrite pass (optional GZMO_ENABLE_SELF_EVAL)
     └─ chain → writes next task to Subtasks/
     ↓
[Mark completed — status: completed | failed]
```

**Key strength:** The post-processing layer (`validateAndShape`) is a **compiler for LLM outputs** — it guarantees structural invariants regardless of model behavior. This is the right idea: LLMs as generators, deterministic code as verifier.

**Key gap:** The LLM call itself is a **single-shot** with no intermediate reasoning surface. Unlike DeepSeek-R1 (`<thinking>`) or QwQ (`<thinking>`), GZMO strips thinking blocks from the output. The model reasons *blindly* — we get no visibility into its reasoning chain.

### 1.2 The Chaos Engine (affect-as-modulation)

`chaos.ts` implements a Lorenz attractor (σ=10, ρ=28, β=8/3) with RK4 integration, periodically reseeded by a logistic map. This drives:
- `llmTemperature`: [0.3, 1.2] — creativity vs precision
- `llmMaxTokens`: [400, 800] — brevity vs verbosity
- `llmValence`: [−1.0, 1.0] — skepticism vs synthesis
- `Phase`: Idle → Build → Drop phase contracts

**Theoretical anchor:** This is *affective computing* — the daemon's "mood" modulates reasoning parameters. It is a novel entry into sovereign agent design: not random parameter sweeping, but deterministic chaos giving emergent structural variation.

**Research question:** Can we extend this to **reasoning budget allocation**? High-tension phases get more compute (deeper Tree-of-Thought exploration), low-tension phases get fast-path heuristics.

### 1.3 The Self-Ask Engine (bounded autonomy)

Three autonomous strategies during idle time:
1. **Gap Detective** — cosine-similar gap finding between distant vault clusters (map-reduce over LLM calls)
2. **Contradiction Scanner** — verify dream claims against vault evidence
3. **Spaced Repetition** — re-visit unreferenced vault entries

**Design philosophy (from the CFD research notes):** Constraint-First Decomposition — place constraints BEFORE objectives to exploit the Primacy Effect in transformer attention. This works: the self-ask prompts are among the most aggressive prompt-engineering in the codebase.

**Limitation:** Each strategy is a **single-path** exploration. There's no branching, no backtracking, no comparison of alternative hypotheses. Contrast with:
- **Tree of Thought (Yao et al. 2023):** Branch, evaluate, backtrack
- **Self-Consistency (Wang et al. 2022):** Sample multiple reasoning paths, vote on answer
- **Reflexion (Shinn et al. 2023):** Self-critique + retry with reflection

### 1.4 The MIND Filter (pre-inference cognitive normalization)

`mind_filter.ts` — a regex-only (no LLM calls) pipeline:
1. Anti-pattern stripping (LLM cliché words: "delve", "landscape", "robust")
2. Recursion depth capping (center-embedding ≤ 2)
3. Compound question decomposition (split at semicolons, "and also")
4. Declarative order enforcement (constraints → premises → question)
5. Logic-of-Thought augmentation (extract conditionals, apply transitive law + contraposition)

**Key insight:** This is a **linguistic preprocessor** that tries to make natural language behave more like formal logic. The LoT augmentation extracts `if A then B` → derives `if ¬B then ¬A` and adds it to the prompt.

**Limitation:** It's regex-based and fast (~3ms), but regex cannot parse real syntax. The `extractConditionals` function misses conditional clauses with complex subordinate structures (e.g., "unless X, in which case Y, then Z"). A proper reasoning engine would use a lightweight parser or a small model for proposition extraction.

### 1.5 The Eval Harness (evidence-based quality gates)

`eval_harness.ts` combines:
- **Deterministic scenarios:** Retrieval accuracy (with stubbed embeddings), safety gate verification, empty-result handling
- **LLM-included scenarios (opt-in):** Multi-part citation accuracy, selective abstention, adversarial rejection, backticked path compliance
- **Shadow judge:** Pointwise evaluation (good answer vs bad answer ranking)
- **Fitness scoring:** AOS-style z = (Quality × Efficiency) × (1 − Variance)
- **Longitudinal perf fitness:** Real-world task performance scoring over time

**This is world-class scaffolding for a reasoning engine.** The harness proves that outputs adhere to contracts. But it's **offline/fixed-test** — the fitness scores are computed, they don't feed back into the model or the prompt at runtime.

---

## Part 2: What a Proper Reasoning Engine Needs

### 2.1 Six Missing Pillars

| # | Pillar | Current State | Target State |
|---|--------|---------------|--------------|
| 1 | **Structured Internal Reasoning** | Strips `<thinking>`; opaque LLM | Native CoT/ToT with parseable trace nodes |
| 2 | **Recursive Problem Decomposition** | Single pipeline prepare → call | Tree-of-Thought with depth budget & pruning |
| 3 | **Tool-Augmented Reasoning** | No external tools → hallucinates file paths | Structured tool use: file read, grep, run, git |
| 4 | **Belief Revision Under Evidence** | Deterministic pass/fail | Bayesian confidence tracking per claim |
| 5 | **Runtime Meta-Cognitive Control** | Fixed `maxTokens` | Adaptive compute: fast-path vs deep-reasoning |
| 6 | **Closed-Loop Learning from Error** | Fitness scores computed, not consumed | Prompt weights update from eval, eval drives training |

### 2.2 Architecture for Reasoning Engine v1.0

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          GZMO Reasoning Engine                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │   Ingest     │───→│   Memory     │───→│   Search     │              │
│  │   (vault)    │    │  (episodic)  │    │  (hybrid)    │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│          │                  │                  │                        │
│          ↓                  ↓                  ↓                        │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │              Problem Analyzer (LLM call #0)               │        │
│  │  Determines: task type, required evidence, tool needs,    │        │
│  │  decomposition depth, estimated token budget             │        │
│  └──────────────────────────────────────────────────────────┘        │
│                                  │                                    │
│                                  ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │              Reasoning Controller (deterministic)          │        │
│  │  Chaos-aware budget allocator: fast-path | tree | reactor │        │
│  └──────────────────────────────────────────────────────────┘        │
│                     │              │              │                   │
│              fast-path        tree-of-thought     reactor            │
│              (single call)    (branch+eval+prune) (retry loop)       │
│                     │              │              │                   │
│                     ↓              ↓              ↓                 │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │              Structured Executor (deterministic)           │      │
│  │  ┌─ Tool Dispatcher ──→ exec read/run/code/grep/git     │      │
│  │  ├─ Evidence Compiler ──→ packet → verifier            │      │
│  │  ├─ Citation Enforcer ──→ [E#] validated                 │      │
│  │  └─ Safety Gate ──→ fail-closed on unknown paths         │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                  │                                    │
│                                  ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │              Output Synthesizer + Trace Logger             │      │
│  │  Final answer + reasoning trace (persistent, auditable)    │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                  │                                    │
│                                  ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │              Evaluator + Fitness Feedback                  │      │
│  │  Score → vault fitness log → chaos modulation →   (↻)     │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Concrete Implementation Path

### 3.1 Phase A: Thinking Infrastructure (≈2–3 days)

**Goal:** Make reasoning visible, structured, and persistent.

1. **Trace node schema:** Define a JSON schema for reasoning steps:
   ```json
   {
     "trace_id": "uuid",
     "task_file": "Inbox/000_task.md",
     "nodes": [
       {
         "node_id": "n1",
         "type": "analyze",       // analyze | retrieve | reason | verify | answer | retry
         "parent_id": null,
         "prompt_summary": "What files does GZMO write?",
         "evidence_cited": ["E1", "E2"],
         "claim": "Writes health.md",
         "confidence": 0.92,
         "tools_used": [],
         "raw_output": "...",
         "timestamp": "2026-05-05T..."
       }
     ]
   }
   ```

2. **Stop stripping `<thinking>` / `</think>` / `<think>`:**
   - Instead, **parse** reasoning blocks
   - Store them in the trace log (vault/GZMO/reasoning/)
   - Surface the *final answer* to the user, but keep the chain

3. **Reasoning persistence:**
   - Write trace JSONL alongside each completed task
   - Make it queryable: "Show me all tasks where confidence was < 0.5"

### 3.2 Phase B: Tree-of-Thought Controller (≈1 week)

**Goal:** Enable recursive decomposition with bounded exploration.

1. **Implement a minimal ToT controller:**
   - Branch factor: configurable (default 2)
   - Max depth: controlled by chaos energy (high energy → deep exploration)
   - Evaluation function: shadow judge per node (pointwise scoring)
   - Pruning: keep only branches with score ≥ threshold

2. **Node types:**
   - `analyze` — decompose the user's question into sub-questions
   - `retrieve` — search vault for evidence
   - `reason` — derive conclusions from evidence
   - `verify` — cross-check claims against evidence
   - `answer` — synthesize final response
   - `retry` — reflection + retry on failure

3. **Integration with existing infrastructure:**
   - Each `retrieve` node → reuse existing hybrid search pipeline
   - Each `verify` node → reuse existing `verifier_safety.ts` + `shadow_judge.ts`
   - Each `answer` node → reuse existing citation formatting + shape enforcement

4. **Chaos-aware budget allocation:**
   ```typescript
   // In phase Build with high energy → grant deep exploration
   const depthBudget = Math.floor(
     mapRange(snap.energy, 0, 100, 1, 4) * 
     (snap.phase === Phase.Drop ? 0.5 : 1.5)
   );
   const branchBudget = Math.floor(
     mapRange(snap.llmValence, -1, 1, 2, 4)
   );
   ```

### 3.3 Phase C: Tool Use (≈1 week)

**Goal:** Stop hallucinating file paths by giving the engine read-access to the filesystem.

1. **Define a compact tool schema** (inspired by NotebookLM research on function calling):
   ```typescript
   interface Tool {
     name: "vault_read" | "fs_grep" | "dir_list" | "run_command" | "git_status";
     schema: JSONSchema;
     execute: (args: any) => Promise<ToolResult>;
     deterministic: boolean; // true = no LLM, code output only
   }
   ```

2. **Start with vault_read:**
   - The engine can request: `"read file wiki/overview.md"`
   - Result is added to evidence packet as a new snippet
   - Safety verifier already validates path bounds (allowedPaths)

3. **Progress to fs_grep:**
   - `grep -r "pattern" wiki/` → results fed into evidence packet
   - Enables the engine to answer "how many files mention X?" without hallucination

4. **Tool scheduler:**
   - Not free-form: every tool call is budgeted
   - Max tool calls per task: 5 (configurable)
   - Tool call count is a chaos event (energy drain)

### 3.4 Phase D: Belief Tracking (≈1 week)

**Goal:** Replace binary pass/fail with probabilistic claim confidence.

1. **Per-claim confidence scoring:**
   ```typescript
   interface Claim {
     text: string;
     sources: EvidenceSnippet[];
     confidence: number;        // 0..1, Bayesian aggregate
     contradictedBy?: Claim[];
     version: number;           // revision tracking
   }
   ```

2. **Conflict detection:**
   - If two nodes produce contradictory claims, surface as conflict
   - Confidence resolution: confidence-weighted voting (Self-Consistency style)
   - Store conflicts in Thought Cabinet for human review

3. **Integration with eval harness:**
   - Add "confidence calibration" as an eval metric
   - A claim with confidence 0.95 should be correct 95% of the time
   - If confidence is poorly calibrated → back-propagate to prompt tuning

### 3.5 Phase E: Closed-Loop Learning (≈2–3 weeks, research-heavy)

**Goal:** Use eval fitness scores to improve future prompts/system prompts.

1. **Fitness → Prompt mutation:**
   - Collect fitness scores per prompt variant
   - When a variant consistently scores higher, promote it
   - When a variant consistently scores lower, demote or archive

2. **Automatic prompt A/B testing:**
   - System prompt is actually a *population* of prompts
   - Each generation picks from the population weighted by fitness
   - New prompts are mutated versions of high-fitness parents

3. **Connection to Chaos Engine:**
   - Prompt mutation is a new crystallization event type
   - `crystallization.category = "prompt_mutation"`
   - When a prompt variant crystallizes, it permanently changes the system's default

4. **LoRA training trigger:**
   - When enough high-quality reasoning traces accumulate, export as training data
   - Tier 2 (LoRA) from `FINE_TUNING.md` becomes automated
   - The daemon trains on its own reasoning traces

---

## Part 4: Risk Assessment & Ordering

| Risk | Mitigation | Phase |
|------|-----------|-------|
| Token budget explosion (ToT is expensive) | Branch budget + chaos-driven depth; auto-prune low-score branches | B |
| Tool use enables prompt injection via file contents | Pre-scan tool results through `verifier_safety.ts` before adding to evidence | C |
| Reasoning traces leak intermediate claims that are wrong | Mark trace nodes as "unverified" until final verification gate | A |
| Belief tracking adds complexity without commensurate value | Start with 3-state: {supported, unsupported, contradicted}; no continuous confidence | D |
| Closed-loop learning produces degenerate prompt populations | Population cap + mandatory human gate on prompt crystallization | E |
| Increased latency degrades user experience | Concurrent ToT branches via `Promise.all` + 5s fast-path timeout | B |

**Recommended order: A → B → C → D → E**

Each phase is independently valuable. Phase A alone makes the engine radically more debuggable. Phase B alone dramatically improves complex task handling.

---

## Part 5: Immediate Next Step

The **highest-impact, lowest-risk** starting point is **Phase A: Thinking Infrastructure**.

Three files to change:

1. **`engine.ts`**: Stop stripping `<thinking>` blocks. Instead, parse them out and store them.
2. **`infer()`** in `engine.ts`: Add a `returnTrace?: boolean` parameter that returns both reasoning steps and final answer.
3. New file **`src/reasoning_trace.ts`**: Define the trace node schema, persistence, and a simple viewer.

This takes ~2 days, has zero risk to existing eval pass rates, and unlocks visibility into *why* the engine produces the answers it does. That visibility is prerequisite to everything that follows.

---

## Appendix: Related Research Links

- **Tree of Thought:** Yao et al., "Tree of Thoughts: Deliberate Problem Solving with Large Language Models" (NeurIPS 2023)
- **Self-Consistency:** Wang et al., "Self-Consistency Improves Chain of Thought Reasoning" (ICLR 2023)
- **Reflexion:** Shinn et al., "Reflexion: Self-Reflective Agents" (2023)
- **Logic of Thought (LoT):** ACL 2024 paper on conditional extraction → expansion → translation
- **LINC (EMNLP 2023):** Semantic parsing → formal logic → deterministic solving
- **Disco Elysium Thought Cabinet:** Inspiration for the chaos engine's internalization system
- **AOS (Agent-as-Optimizer System):** Fitness = (Quality × Efficiency) × (1 − Variance)
- **OpenCompass:** Pointwise evaluation rubrics for retrieval benchmarks

---

*End of research document. Awaiting task assignment for implementation.*
