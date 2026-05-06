# GZMO Project Status — 2026-05-06

> Comprehensive audit of the tinyFolder / GZMO daemon architecture, recent changes, and roadmap.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         INBOX                               │
│              (markdown tasks with frontmatter)              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     VAULT WATCHER                           │
│      (chokidar file events → task dispatch)                 │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│   THINK     │  │    SEARCH    │  │    CHAIN     │
│  Pipeline   │  │   Pipeline   │  │  Next Task   │
└──────┬──────┘  └──────┬───────┘  └──────────────┘
       │                │
       └────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                   INFERENCE ENGINE                          │
│    ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   │
│    │   Search    │   │  Tree-of-    │   │   Shadow     │   │
│    │  Pipeline   │   │  Thought     │   │   Judge      │   │
│    │ (emb+lex+   │   │  Controller  │   │  (quality)   │   │
│    │  rerank)    │   │              │   │              │   │
│    └─────────────┘   └──────────────┘   └──────────────┘   │
│                                                             │
│    ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   │
│    │   Safety    │   │   Response   │   │   Self-      │   │
│    │  Verifier   │   │   Shape      │   │   Eval       │   │
│    │             │   │  Enforcer    │   │  & Rewrite   │   │
│    └─────────────┘   └──────────────┘   └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKGROUND PROCESSES                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   DREAM      │  │   WIKI       │  │   PULSE LOOP     │  │
│  │  ENGINE      │  │  ENGINE      │  │  (Chaos Engine)  │  │
│  │              │  │              │  │                  │  │
│  │ Task insight │  │ Cabinet→wiki │  │ Lorenz attractor │  │
│  │ extraction   │  │ promotion    │  │ Cortisol, energy │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                    PERSISTENCE LAYER                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Embeddings  │  │   Learning   │  │  Reasoning Trace │  │
│  │   Store      │  │    Ledger    │  │      Index       │  │
│  │(nomic chunks)│  │ (strategy)   │  │  (JSONL traces)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Claim Store │  │  Knowledge   │  │   Doctor /       │  │
│  │ (jsonl)      │  │    Graph*    │  │   Self-Heal      │  │
│  │              │  │              │  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

\* *New component — Phase 1 foundation*

---

## 2. What Exists (Mature Systems)

### 2.1 Task Processing Engine (`src/engine.ts`)
- **Actions**: `think | search | chain`
- **Frontmatter-driven**: `status`, `action`, `chain_next`
- **Chaos modulation**: LLM temperature + max tokens from Lorenz state
- **Safety stack**: verifier, response shape enforcer, per-part citations
- **Chain automation**: creates downstream tasks automatically

### 2.2 Search Pipeline (`src/search.ts`)
- **Hybrid retrieval**: dense (cosine) + lexical (BM25) + RRF fusion
- **Adaptive Top-K**: configurable elbow-based cutoff
- **Explicit path injection**: forces vault-relative file references into results
- **Anchor prior**: boosts canonical pages when env enabled

### 2.3 Embeddings (`src/embeddings.ts`)
- **Model**: nomic-embed-text via Ollama
- **Chunking**: heading-aware markdown splits
- **SHA256 dedup**: no re-embedding unchanged content
- **Live sync**: file watcher + queue for incremental updates
- **Adaptive concurrency**: backs off on 429/503 errors

### 2.4 Tree-of-Thought (`src/reasoning/`)
- **ToT Controller**: budget-limited search tree
- **Gates**: analyze → retrieve → reason checkpoints
- **Critique**: LLM self-critique per node
- **Trace memory**: past traces injected as context

### 2.5 Learning System (`src/learning/`)
- **Strategy ledger**: task-type × decomposition style × z-score
- **Tips injection**: positive/negative strategy guidance into prompts
- **Trace learning**: analyze past traces for patterns

### 2.6 Reasoning Traces (`src/reasoning_trace.ts`)
- **Structured nodes**: task_start → analyze → retrieve → reason → verify → answer
- **Index**: JSONL for fast lookup
- **Claims extraction**: beliefs recorded per node

### 2.7 Dream Engine (`src/dreams.ts`)
- **Insight extraction**: distills completed tasks into cabinet entries
- **Novelty gating**: duplicate detection via cosine similarity
- **Anchor verification**: ensures claims are rooted in evidence
- **Auto-task creation**: spawns follow-up tasks from insights

### 2.8 Wiki Engine (`src/wiki_engine.ts`)
- **Autonomous builder**: cabinet → structured wiki articles
- **Topic clustering**: embedding-based grouping
- **Quality gating**: self-eval + wiki contract enforcement
- **Self-documentation**: reads source code, writes architecture docs

### 2.9 Chaos / Pulse Engine (`src/pulse.ts`)
- **174 BPM heartbeat**: self-correcting timer
- **Lorenz attractor**: modulates LLM parameters
- **Cortisol regulation**: allostatic load tracking
- **Trigger evaluation**: phase-dependent actions

### 2.10 Quality Stack
- **Shadow Judge**: LLM-based score + critique
- **Route Judge**: part-level citation + formatting validation
- **Honeypot edges/nodes**: detects hallucination via planted fake references
- **Quarantine**: rejects low-quality artifacts with repair tasks

---

## 3. What Changed Recently

### 3.1 Self-Healing Doctor (v3)

| File | Change |
|---|---|
| `doctor.ts` | Refactored into `runDiagnostics()` + healing loop. Re-runs diagnostics after applying fixes, compares before/after step sets. |
| `src/doctor/healer.ts` | **New**. Registry-based fix handlers: `fix.vault.mkdir`, `proxy.no_proxy`, `ollama.serve`, `ollama.pull_models`. |
| `src/doctor/flags.ts` | Added `--heal`, `--heal-retries`, `--heal-delay-ms` flags. |
| `src/doctor/types.ts` | Added `HealingExecution` type and `healingExecutions` field on `DoctorReport`. |
| `src/doctor/report.ts` | Added Healing execution section to Markdown output. |
| `scripts/doctor-agentic.sh` | Added `--heal` passthrough; auto-switches to `--write` mode. |

### 3.2 Knowledge Graph (Phase 1 Foundation)

| File | Change |
|---|---|
| `src/knowledge_graph/graph.ts` | **New (orphaned)**. In-memory graph with nodes/edges, auto-linking, contradiction detection, hot-node tracking, JSONL + snapshot persistence. **Not yet wired into any pipeline.** |

### 3.3 Deleted (Premature Web Search)

| File | Status |
|---|---|
| `src/web_search/crawler.ts` | **Deleted**. Wrong abstraction — project is vault-native only. |
| `src/research/engine.ts` | **Deleted**. Had web dependencies. Needs vault-native rewrite. |

---

## 4. Integration Gaps (What's Not Connected)

### Gap 1: Knowledge Graph is Orphaned
- `KnowledgeGraph` class exists but **no system calls it**
- No entity extraction at task completion time
- No claim→graph pipeline
- No graph→search augmentation

**Where to hook**:
- After `processTask()` answer node: extract entities → `kg.addNode({ type: "entity" })`
- After trace completion: record final answer claims → `kg.upsertClaim()`
- After Dream Engine produces insight: `kg.addEdge(dream, source, "refines")`
- After Wiki Engine writes article: `kg.addEdge(article, cabinet_entries, "part_of")`

### Gap 2: No Vault-Native Research Engine
- Research sessions require manual tasking
- No recursive multi-hop reading across wiki/cabinet/traces
- No "read full file when embedding teaser is promising"
- No gap detection ("wiki mentions X but has no article on X")

### Gap 3: Graph Search Not Used in Retrieval
- `searchVaultHybrid()` only queries embeddings + BM25
- Knowledge Graph could augment:
  1. Query graph for topic nodes first
  2. Use `subgraph()` to discover connected claims
  3. Read full files from `source` node metadata
  4. Rank by graph distance + embedding similarity

### Gap 4: No Cross-Session Memory
- Past research sessions exist as files but aren't queried
- No session→session `derived_from` edges
- New research starts from scratch, not from prior synthesis

### Gap 5: Self-Healing Covers Infra, Not Content
- Doctor heals missing dirs, proxy settings, Ollama
- Doctor does NOT heal:
  - Orphaned wiki pages
  - Missing backlinks
  - Unresolved contradictions in claims
  - Stale embeddings (files changed but not re-embedded)
  - Research sessions stuck >24h

---

## 5. File Inventory

### 5.1 Core Daemon Files (Active)

```
gzmo-daemon/
├── doctor.ts                    ← Self-healing doctor entrypoint (v3)
├── index.ts                     ← Daemon bootstrap
├── package.json                 ← Bun scripts
├── proof_local_vault.ts
├── src/
│   ├── adaptive_topk.ts
│   ├── allostasis.ts            ← Cortisol regulation
│   ├── anchors.ts               ← Canonical page anchors
│   ├── anchor_index.ts
│   ├── anchor_verifier.ts
│   ├── auto_tasks.ts            ← Inbox auto-generation
│   ├── bm25.ts                  ← Lexical search
│   ├── chaos.ts                 ← Lorenz + Logistic maps
│   ├── citation_formatter.ts
│   ├── core_wisdom.ts
│   ├── core_wisdom_validate.ts
│   ├── dreams.ts                ← Dream engine
│   ├── embeddings.ts            ← nomic embed pipeline
│   ├── embeddings_queue.ts      ← Incremental embed watcher
│   ├── engine.ts                ← Main inference engine
│   ├── engine_hooks.ts
│   ├── engine_state.ts
│   ├── eval_harness.ts
│   ├── evidence_packet.ts
│   ├── eval_harness.ts
│   ├── feedback.ts              ← Tension/energy event deltas
│   ├── fitness_scorer.ts
│   ├── frontmatter.ts
│   ├── guidance_contract.ts
│   ├── health.ts
│   ├── honeypot_edges.ts
│   ├── honeypot_nodes.ts
│   ├── honeypot_promotion.ts
│   ├── inference.ts             ← Ollama chat wrapper
│   ├── inference_router.ts      ← Role-based model routing
│   ├── ingest_engine.ts
│   ├── local_facts.ts
│   ├── memory.ts                ← Episodic task memory
│   ├── perf.ts                  ← Performance telemetry
│   ├── perf_fitness.ts
│   ├── pulse.ts                 ← Chaos heartbeat
│   ├── quarantine.ts            ← Quality rejection
│   ├── query_rewrite.ts
│   ├── reasoning_trace.ts       ← Structured trace persistence
│   ├── rerank_llm.ts            ← LLM-based reranker
│   ├── response_shape.ts
│   ├── route_judge.ts
│   ├── runtime_profile.ts
│   ├── search.ts                ← Hybrid semantic/lexical search
│   ├── self_ask.ts
│   ├── self_ask_quality.ts
│   ├── self_ask_report.ts
│   ├── self_eval.ts
│   ├── shadow_judge.ts          ← LLM quality score
│   ├── skills.ts
│   ├── small_model_rules.ts
│   ├── stream.ts
│   ├── structured.ts
│   ├── task_types.ts
│   ├── thoughts.ts              ← Thought Cabinet logic
│   ├── triggers.ts              ← Phase-based trigger engine
│   ├── types.ts                 ← Core chaos types
│   ├── vault_fs.ts              ← Safe atomic file ops
│   ├── vault_state_index.ts     ← Deterministic file registry
│   ├── verifier_safety.ts       ← Groundedness checker
│   ├── watcher.ts               ← File system watcher
│   ├── wiki_contract.ts
│   ├── wiki_engine.ts           ← Autonomous wiki builder
│   ├── wiki_graph.ts
│   ├── wiki_index.ts
│   ├── wiki_lint.ts
│   ├── wiki_log.ts
│   ├── wiki_ops_index.ts
│   │
│   ├── belief/
│   │   └── claim_store.ts       ← Belief records (jsonl)
│   │
│   ├── doctor/
│   │   ├── flags.ts             ← CLI arg parsing (+ heal flags)
│   │   ├── healer.ts            ← Fix handler registry
│   │   ├── legacy.ts            ← Old test orchestration
│   │   ├── ollama.ts
│   │   ├── report.ts            ← Markdown + JSON report writer
│   │   ├── runner.ts            ← Step runner with timeout
│   │   └── types.ts             ← Doctor types (+ HealingExecution)
│   │
│   ├── knowledge_graph/
│   │   └── graph.ts             ← In-memory graph (orphaned)
│   │
│   ├── learning/
│   │   ├── analyze.ts
│   │   ├── build_ledger.ts
│   │   ├── ledger.ts            ← Strategy learning
│   │   ├── sync_traces_cli.ts
│   │   ├── sync_traces.ts
│   │   └── trace_chunks.ts
│   │
│   ├── pipelines/
│   │   ├── helpers.ts
│   │   ├── search_pipeline.ts
│   │   ├── think_pipeline.ts
│   │   └── types.ts
│   │
│   ├── reasoning/
│   │   ├── controller.ts        ← ToT budget + tree
│   │   ├── critique.ts
│   │   ├── evaluate.ts
│   │   ├── expand.ts
│   │   ├── gates.ts             ← analyze/retrieve/reason gates
│   │   ├── priority.ts
│   │   ├── run_tot_search.ts   ← ToT search entrypoint
│   │   └── synthesis.ts
│   │
│   ├── tools/
│   │   ├── chaining.ts
│   │   ├── dir_list.ts
│   │   ├── fs_grep.ts
│   │   ├── registry.ts
│   │   ├── types.ts
│   │   └── vault_read.ts
│   │
│   └── __tests__/               ← 26 test files, 143 tests total
│       ├── auto_tasks.test.ts
│       ├── chaos_engine.test.ts
│       ├── citation_formatter.test.ts
│       ├── embeddings_queue.test.ts
│       ├── engine_hooks.test.ts
│       ├── eval_harness.test.ts
│       ├── expand_tot.test.ts
│       ├── fitness_scorer.test.ts
│       ├── guidance_contract.test.ts
│       ├── ingest_engine.test.ts
│       ├── linc_filter.test.ts
│       ├── local_facts.test.ts
│       ├── max_finesse_pack.test.ts
│       ├── mind_filter.test.ts
│       ├── perf_fitness.test.ts
│       ├── reasoning_controller.test.ts
│       ├── reasoning_phases.test.ts
│       ├── regressions.integration.test.ts
│       ├── route_judge.test.ts
│       ├── security.test.ts
│       ├── shadow_judge.test.ts
│       ├── small_llm_support.test.ts
│       ├── triggers.test.ts
│       ├── wiki_contract.test.ts
│       ├── wiki_graph.test.ts
│       └── wiki_lint.test.ts
```

### 5.2 Scripts

```
scripts/
├── doctor-agentic.sh            ← Agentic wrapper (+ heal passthrough)
├── install_service.sh
├── run_tests.sh
├── wait-for-ollama.sh
└── wiki_graph.sh
```

### 5.3 Vault Directory Structure (Expected)

```
vault/
├── GZMO/
│   ├── Inbox/                   ← Task files
│   ├── Subtasks/
│   ├── Thought_Cabinet/         ← Raw daemon thoughts
│   ├── Quarantine/              ← Rejected artifacts
│   ├── CHAOS_STATE.json         ← Pulse snapshot
│   ├── memory.json              ← Task memory
│   ├── embeddings.json          ← Embedding store
│   ├── wiki-lint-report.md
│   ├── doctor-report.md         ← Doctor output
│   ├── doctor-report.json
│   ├── .gzmo_dreams_digested.json
│   ├── Knowledge_Graph/         ← Graph persistence
│   │   ├── snapshot.json
│   │   └── audit.jsonl
│   ├── Reasoning_Traces/
│   │   ├── index.jsonl
│   │   └── claims.jsonl
│   └── strategy_ledger.jsonl
├── wiki/                        ← Structured knowledge
│   ├── concepts/
│   ├── entities/
│   ├── research/
│   ├── sessions/
│   └── topics/
└── Projects/
    └── Notes/
```

---

## 6. Typecheck & Test Status

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ Pass (no errors) |
| `bun test` | ✅ 143 pass, 0 fail (3309 expect calls) |

---

## 7. Strategic Priority Matrix

| Priority | System | Effort | Impact | Blockers |
|---|---|---|---|---|
| **P0** | Wire KG into engine traces | Medium | Very High | None |
| **P0** | Vault-native research loop | High | Very High | Requires KG |
| **P1** | Graph-augmented search (`search.ts`) | Medium | High | Requires KG |
| **P1** | Cross-session memory | Medium | High | Requires research loop |
| **P1** | Doctor content health checks | Low | Medium | None |
| **P2** | Entity auto-extraction | Low | High | None |
| **P2** | Session threading | Medium | Medium | Requires research loop |
| **P2** | Self-pruning claims | Low | Medium | Requires KG usage |
| **P3** | Multi-model consensus | High | Medium | None |
| **P3** | Tool expansion (kg_query, etc.) | Medium | Medium | Requires KG |

---

## 8. Open Questions

1. **Should the Knowledge Graph use snapshot.json (full rewrite) or WALL (append-only log)?** Current code uses both — snapshot for state, jsonl for audit. Decide on primary format.

2. **Should research sessions be tasks or a separate daemon process?** Tasks fit the current model, but recursive research could lock the Inbox for minutes.

3. **How aggressive is auto-healing?** Should the Doctor create Inbox tasks for detected gaps, or silently fix them?

4. **Embedding cost management**: The KG auto-linking embeds every claim. At scale this is expensive. Need batching or lazy embedding.

---

## 9. Health Check (One-Liner)

```bash
# Everything green?
cd gzmo-daemon && bun test && npx tsc --noEmit && echo "✅ GZMO healthy"
```

Current output: ✅ GZMO healthy (143 tests, 0 type errors)
