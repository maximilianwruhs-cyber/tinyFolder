# GZMO Non-Green Components — Implementation Guide

**Date:** 2026-05-06  
**Scope:** All 🟡-status components (Mature Beta / Early Beta)  
**Goal:** Step-by-step activation, validation, and hardening of each component  
**Prerequisites:** Base daemon running (`bun test` passes, `bun run eval:quality` passes)

---

## Table of Contents

1. [How to Use This Guide](#1-how-to-use-this-guide)
2. [Component Overview](#2-component-overview)
3. [Knowledge Graph (🟡 Mature Beta)](#3-knowledge-graph-mature-beta)
4. [Learning Ledger (🟡 Mature Beta)](#4-learning-ledger-mature-beta)
5. [Model Routing (🟡 Early Beta)](#5-model-routing-early-beta)
6. [Critique + Replanning (🟡 Early Beta)](#6-critique--replanning-early-beta)
7. [Wiki / Dream Engines (🟡 Mature Beta)](#7-wiki--dream-engines-mature-beta)
8. [Cross-Task Trace Memory (🟡 Early Beta)](#8-cross-task-trace-memory-early-beta)
9. [Performance Benchmark (🟡 Mature Beta)](#9-performance-benchmark-mature-beta)
10. [Integration Checklist](#10-integration-checklist)

---

## 1. How to Use This Guide

Each section has:

| Section | Purpose |
|---------|---------|
| **What it does** | Understand the component |
| **Why it's non-green** | The gap to close |
| **Prerequisites** | What must be true before starting |
| **Step-by-step** | Ordered, copy-pasteable commands |
| **Env vars** | Exact `.env` entries |
| **Validation** | How to know it worked |
| **Rollback** | How to disable |
| **Watchouts** | Things that commonly break |

---

## 2. Component Overview

| Component | Status | Complexity | Risk |
|-----------|--------|------------|------|
| Knowledge Graph | 🟡 Mature Beta | Medium | Low |
| Learning Ledger | 🟡 Mature Beta | Medium | Low |
| Model Routing | 🟡 Early Beta | Medium | Medium (hardware) |
| Critique + Replan | 🟡 Early Beta | Low | Low |
| Wiki / Dream | 🟡 Mature Beta | Low (toggle) | Very Low |
| Trace Memory | 🟡 Early Beta | Medium | Low |
| Performance Benchmark | 🟡 Mature Beta | Low | None |

**Recommended order:** Knowledge Graph → Trace Memory → Critique → Learning Ledger → Model Routing → Wiki/Dream → Benchmark

---

## 3. Knowledge Graph (🟡 Mature Beta)

### What it does
Every completed task extracts entities (file refs, code symbols, concepts) from the answer and records them as nodes in a graph. Claims are deduplicated by content hash. Edges link entities to their source tasks. The graph persists as `snapshot.json` + `audit.jsonl`.

### Why it's non-green
- Code is wired into `engine.ts` ( ✅ )
- Search augmentation code exists but is **not active in the default search path** ( ⚠️ )
- Needs runtime validation on real tasks

### Prerequisites
- Daemon runs and completes tasks
- `bun test src/__tests__/knowledge_graph.test.ts` passes

### Step-by-step

**Step 3.1 — Enable in `.env`**

```bash
# Add to gzmo-daemon/.env
GZMO_ENABLE_KNOWLEDGE_GRAPH=on
```

**Step 3.2 — Verify graph directory is created on next task**

```bash
# In one terminal: start daemon
cd gzmo-daemon && bun run summon

# In another terminal: submit a search task
cat > "$VAULT_PATH/GZMO/Inbox/kg_test.md" <<'EOF'
---
status: pending
action: search
---
What files does the daemon write?
EOF

# Wait 10 seconds, then check:
ls "$VAULT_PATH/GZMO/Knowledge_Graph/"
# Expected: snapshot.json  audit.jsonl
```

**Step 3.3 — Inspect the snapshot**

```bash
cat "$VAULT_PATH/GZMO/Knowledge_Graph/snapshot.json" | python3 -m json.tool | head -60
```

You should see:
- `nodes` with at least one `"type": "source"` (your task file)
- `nodes` with `"type": "entity"` or `"type": "claim"`
- `edges` linking them

**Step 3.4 — Verify entity extraction quality**

Submit a task that mentions files explicitly:

```bash
cat > "$VAULT_PATH/GZMO/Inbox/kg_entities.md" <<'EOF'
---
status: pending
action: think
---
According to the code in `src/engine.ts` and `src/search.ts`, how does retrieval work?
EOF
```

Wait for completion, then check:

```bash
python3 -c "
import json
with open('$VAULT_PATH/GZMO/Knowledge_Graph/snapshot.json') as f:
    data = json.load(f)
for nid, n in data['nodes'].items():
    if n['type'] == 'entity':
        print(f\"  {n['label']} ({n.get('metadata',{}).get('entityType','?')})\")
"
```

Expected: `engine.ts` and `search.ts` appear as file-type entities.

**Step 3.5 — Enable graph-augmented search (optional, experimental)**

The search augmentation code exists in `search_pipeline.ts` but is behind an additional flag:

```bash
# Add to .env
GZMO_KG_SEARCH_AUGMENT=on
```

This causes `searchVaultHybrid` to query the KG for topic nodes related to the query, then inject connected files into the result set. **This is the primary gap that keeps KG non-green.**

Validate:

```bash
# Submit a search about a topic you've written wiki pages about
cat > "$VAULT_PATH/GZMO/Inbox/kg_search.md" <<'EOF'
---
status: pending
action: search
---
Explain the chaos engine
EOF

# After completion, check if KG-augmented files appear in the trace
bun run trace:view GZMO/Inbox/kg_search.md
# Look for evidence citations from files that were graph-connected
```

**Step 3.6 — Monitor orphan nodes**

```bash
# Add to your shell or cron
python3 -c "
import json
with open('$VAULT_PATH/GZMO/Knowledge_Graph/snapshot.json') as f:
    data = json.load(f)
edges = data['edges']
node_ids_with_edges = set()
for e in edges.values():
    node_ids_with_edges.add(e['from'])
    node_ids_with_edges.add(e['to'])
orphans = [n for nid, n in data['nodes'].items() if nid not in node_ids_with_edges]
print(f'Orphaned nodes: {len(orphans)}')
for o in orphans[:5]:
    print(f'  - {o[\"label\"]} ({o[\"type\"]})')
"
```

If orphans grow > 50, implement cleanup in `graph.ts` or run a monthly doctor check.

### Env vars

```bash
GZMO_ENABLE_KNOWLEDGE_GRAPH=on      # Activate entity/claim extraction on task completion
GZMO_KG_SEARCH_AUGMENT=on           # (Experimental) Use KG to augment search results
```

### Validation
- [ ] `snapshot.json` created after first completed task
- [ ] Contains `entity` and `claim` nodes
- [ ] `audit.jsonl` has entries
- [ ] No task failure caused by KG (check daemon logs)
- [ ] File references in answers become entity nodes (verified)

### Rollback
```bash
sed -i 's/GZMO_ENABLE_KNOWLEDGE_GRAPH=.*/GZMO_ENABLE_KNOWLEDGE_GRAPH=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
```

### Watchouts
- **Orphan accumulation**: Nodes without edges grow over time. Add a `doctor` check.
- **Snapshot size**: At >1000 tasks, `snapshot.json` may become large. Consider compaction.
- **Embedding cost**: `autoLinkSimilar()` embeds every unembedded claim. This runs when explicitly called, not automatically. Do not call it on every task.

---

## 4. Learning Ledger (🟡 Mature Beta)

### What it does
Every task writes a `strategy_ledger.jsonl` entry with: task type, decomposition style, tools used, ToT used, z-score, citation rate. Before inference, tips from past similar tasks are injected into the system prompt.

### Why it's non-green
- Tips inject ✅
- **Winning-pattern promotion** (compute which decomposition styles correlate with high z-scores) is partially implemented but **not yet active in prompt injection**
- **A/B test mode** not implemented
- Tips are generated but their effect on quality is not measured

### Prerequisites
- At least 10 completed tasks (ledger needs data)
- `bun test src/__tests__/regressions.integration.test.ts` passes

### Step-by-step

**Step 4.1 — Enable in `.env`**

```bash
GZMO_ENABLE_LEARNING=on
```

**Step 4.2 — Verify ledger is populated**

```bash
# After running some tasks:
cat "$VAULT_PATH/GZMO/strategy_ledger.jsonl" | wc -l
# Expected: > 0

# Inspect structure:
head -3 "$VAULT_PATH/GZMO/strategy_ledger.jsonl" | python3 -m json.tool
```

Expected fields per line:
```json
{
  "entry_id": "...",
  "task_type": "path_query",
  "decomposition_style": "default",
  "used_tools": true,
  "used_tot": true,
  "model": "hermes3:8b",
  "ok": true,
  "z_score": 0.85,
  "citation_rate": 0.92,
  "total_ms": 1234,
  "timestamp": "2026-05-06T..."
}
```

**Step 4.3 — Verify tips appear in traces**

Submit a task and inspect its trace:

```bash
bun run trace:view GZMO/Inbox/<latest_task>.md
```

Look for a trace node with `prompt_summary` containing "Strategy guidance" or "winning pattern." If you have >5 tasks of the same type with varying z-scores, you'll see tips.

**Step 4.4 — (Optional enhancement) A/B test mode**

This requires code changes. The implementation plan in `IMPLEMENTATION_PLAN_2026.md` §4.1 contains the full spec. Summary:

```typescript
// In ledger.ts, add to appendStrategyEntry:
strategy_injected: boolean; // whether tips were injected this task

// In engine.ts, randomize injection:
const injectStrategy = Math.random() > 0.3; // 70% get tips, 30% control

// After 50 tasks, compare avg z_score: injected vs control
```

**Step 4.5 — Manual quality check**

After 20+ tasks, run:

```bash
python3 -c "
import json
scores = {}
with open('$VAULT_PATH/GZMO/strategy_ledger.jsonl') as f:
    for line in f:
        e = json.loads(line)
        style = e['decomposition_style']
        scores.setdefault(style, []).append(e['z_score'])
for style, vals in sorted(scores.items(), key=lambda x: -sum(x[1])/len(x[1])):
    avg = sum(vals)/len(vals)
    print(f'{style:20s}: avg z={avg:.2f} (n={len(vals)})')
"
```

If one style consistently outperforms, the ledger is working.

### Env vars

```bash
GZMO_ENABLE_LEARNING=on          # Activate strategy ledger + tips injection
GZMO_LEARNING_BACKFILL=on        # (Optional) Backfill from existing perf.jsonl on boot
```

### Validation
- [ ] `strategy_ledger.jsonl` has entries after tasks
- [ ] Trace viewer shows strategy context in prompt
- [ ] Same-task-type queries show different decomposition styles over time
- [ ] No task failures caused by tip injection

### Rollback
```bash
sed -i 's/GZMO_ENABLE_LEARNING=.*/GZMO_ENABLE_LEARNING=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
```

### Watchouts
- **Cold start**: First 3 tasks of a new type have no tips. This is expected.
- **Stale tips**: Old tips may not apply to new vault content. Tips are drawn from last 200 entries only.

---

## 5. Model Routing (🟡 Early Beta)

### What it does
Routes LLM calls by role: `fast` for decomposition, `reason` for claim derivation, `judge` for evaluation. Uses different Ollama model tags per role.

### Why it's non-green
- Code exists and is correct ✅
- **Not validated with multiple models loaded simultaneously**
- Requires enough RAM/VRAM for 2–3 models
- Fallback to single model works, but the value prop is unproven

### Prerequisites
- Machine has enough RAM for multiple models:
  - Minimum: 16GB RAM for fast=7B + reason=7B (same model, no gain)
  - Useful: 48GB+ for fast=7B + reason=32B
  - Ideal: 80GB+ for fast=7B + reason=32B + judge=8B
- Ollama supports `OLLAMA_MAX_LOADED_MODELS`

### Step-by-step

**Step 5.1 — Assess hardware**

```bash
free -h
# Need at least: model_sizes + 4GB overhead
# 7B q4 ≈ 4GB, 32B q4 ≈ 20GB, 70B q4 ≈ 40GB
```

**Step 5.2 — Pull models**

```bash
# Fast model (decomposition, routing)
ollama pull qwen2.5:7b

# Reason model (claims, deep reasoning) — adjust size to your RAM
ollama pull qwq:32b        # if 48GB+ RAM
# OR
ollama pull deepseek-r1:14b  # if 24GB+ RAM
# OR
ollama pull hermes3:8b     # if 16GB RAM (same as fast, minimal gain)

# Judge model (evaluation, scoring) — small is fine
ollama pull hermes3:8b
```

**Step 5.3 — Configure Ollama for multi-model**

```bash
# In your shell profile or systemd override:
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KEEP_ALIVE=-1   # keep models resident

# Restart Ollama
sudo systemctl restart ollama
```

Verify:

```bash
ollama ps
# Should show all pulled models as "loaded" after first use
```

**Step 5.4 — Configure GZMO `.env`**

```bash
# gzmo-daemon/.env
OLLAMA_MODEL="qwen2.5:7b"              # default / fallback
GZMO_FAST_MODEL="qwen2.5:7b"
GZMO_REASON_MODEL="qwq:32b"            # or your choice
GZMO_JUDGE_MODEL="hermes3:8b"
GZMO_ENABLE_MODEL_ROUTING=on
```

**Step 5.5 — Verify routing is active**

```bash
# Start daemon with verbose logging
cd gzmo-daemon && GZMO_ENABLE_MODEL_ROUTING=on GZMO_ENABLE_TOT=on bun run summon
```

Submit a ToT search task. Watch logs. You should see `[ENGINE]` lines with different model activity. To confirm exact routing, check Ollama:

```bash
# In another terminal
watch -n 2 'ollama ps'
```

During a ToT task, you should see:
- `qwen2.5:7b` active during `expandAnalyze`
- `qwq:32b` active during `expandReason`
- `hermes3:8b` active during `evaluateNode`

**Step 5.6 — Benchmark impact**

```bash
# Single model baseline
GZMO_ENABLE_MODEL_ROUTING=off GZMO_ENABLE_TOT=on GZMO_BENCHMARK_RUNS=3 bun run benchmark

# Multi-model
GZMO_ENABLE_MODEL_ROUTING=on GZMO_FAST_MODEL=qwen2.5:7b GZMO_REASON_MODEL=qwq:32b GZMO_BENCHMARK_RUNS=3 bun run benchmark
```

Compare:
- Latency: multi-model may be faster if fast model handles 70% of calls
- Quality: ToT answers should have same or better z-scores
- RAM: `free -h` during benchmark — ensure no OOM

### Env vars

```bash
GZMO_ENABLE_MODEL_ROUTING=on    # Activate role-based routing
GZMO_FAST_MODEL=qwen2.5:7b      # Decomposition, routing, simple queries
GZMO_REASON_MODEL=qwq:32b       # Claim derivation, deep reasoning
GZMO_JUDGE_MODEL=hermes3:8b     # Evaluation, shadow judge scoring
```

### Validation
- [ ] `ollama ps` shows multiple models loaded during benchmark
- [ ] ToT tasks complete without errors
- [ ] Latency ≤ 1.5× single-model for same query (fast model handles bulk)
- [ ] z-scores ≥ single-model baseline (quality maintained)
- [ ] No OOM crashes (`dmesg | grep -i oom`)

### Rollback
```bash
sed -i 's/GZMO_ENABLE_MODEL_ROUTING=.*/GZMO_ENABLE_MODEL_ROUTING=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
```

### Watchouts
- **RAM exhaustion**: If `qwq:32b` doesn't fit alongside `qwen2.5:7b`, Ollama unloads/reloads constantly → slower than single model.
- **Model compatibility**: Not all models support the same chat template. Hermes3 and Qwen2.5 are safe. QwQ and DeepSeek-R1 may emit `<think>` blocks that need parsing.
- **Temperature mismatch**: Judge model at temp=0.1 is critical for consistency. Verify this is applied.

---

## 6. Critique + Replanning (🟡 Early Beta)

### What it does
When all ToT branches fail verification (score < threshold), the engine generates a self-critique analyzing why, then optionally replans with a different decomposition. Max 1 replan per task.

### Why it's non-green
- Implementation is correct ✅
- **Rarely triggers in practice** — most tasks either succeed or fail-closed before critique
- Needs hard queries to validate
- No dedicated unit test for the full critique→replan→second attempt flow

### Prerequisites
- `GZMO_ENABLE_TOT=on`
- Tasks that challenge the vault's coverage

### Step-by-step

**Step 6.1 — Enable critique in `.env`**

```bash
GZMO_ENABLE_CRITIQUE=on
GZMO_ENABLE_TOT=on
```

**Step 6.2 — Submit a deliberately hard query**

A hard query is one where:
- The vault has no direct answer
- Multiple retrieval strategies might fail
- The topic is on the edge of vault coverage

```bash
cat > "$VAULT_PATH/GZMO/Inbox/critique_test.md" <<'EOF'
---
status: pending
action: search
---
According to the vault and source code, what is the exact relationship between the L.I.N.C. validation gates and the Tree-of-Thought controller's budget allocation? Provide specific file paths and line number references.
EOF
```

This is hard because:
- L.I.N.C. is documented in research docs (excluded from default retrieval)
- Line numbers require file reading, not embedding retrieval
- The relationship is cross-cutting, not stated in one doc

**Step 6.3 — Inspect the trace for critique**

```bash
# After completion
bun run trace:view GZMO/Inbox/critique_test.md
```

Look for:
- A node of type `"critique"` in the trace
- A `"replan"` node if critique recommended it
- A second `"analyze"` generation

If the trace shows `critique → replan → analyze (generation 2)`, the feature is working.

**Step 6.4 — Verify fallback when critique says "don't replan"**

If the critique determines the vault simply lacks the answer, it should set `shouldReplan: false` and fail-closed with `insufficient evidence`.

Check the task file:

```bash
grep -A5 "insufficient evidence" "$VAULT_PATH/GZMO/Inbox/critique_test.md"
```

If present, the critique correctly diagnosed missing evidence.

**Step 6.5 — Stress test with synthetic failure**

Force failure by submitting a query about a nonexistent topic:

```bash
cat > "$VAULT_PATH/GZMO/Inbox/critique_fail.md" <<'EOF'
---
status: pending
action: search
---
What does the vault say about quantum entanglement protocols in the daemon? Cite specific evidence.
EOF
```

After completion, inspect trace:

```bash
bun run trace:view GZMO/Inbox/critique_fail.md
```

Should show:
1. `analyze` → `retrieve` → `reason` → `verify` (all score < 0.5)
2. `critique` node with problems like "No evidence retrieved" or "Vault lacks this topic"
3. Either `replan` → second attempt, OR `abstain` if critique says no replan possible
4. Final answer: `insufficient evidence to produce a reasoned answer`

### Env vars

```bash
GZMO_ENABLE_CRITIQUE=on      # Activate critique generation on ToT failure
GZMO_ENABLE_TOT=on           # Required (critique only fires in ToT path)
GZMO_TOT_MIN_SCORE=0.5       # Threshold below which branches are pruned (default)
```

### Validation
- [ ] Hard query produces a `critique` node in trace
- [ ] Critique lists 1–3 specific problems
- [ ] Either replan occurs (second analyze wave) OR graceful abstain
- [ ] No infinite loops (max 1 replan enforced)
- [ ] Task completes in < 3× normal latency even with replan

### Rollback
```bash
sed -i 's/GZMO_ENABLE_CRITIQUE=.*/GZMO_ENABLE_CRITIQUE=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
```

### Watchouts
- **Token cost**: Critique + replan adds 2–3 extra LLM calls. Budget this.
- **False replans**: Sometimes critique recommends replanning even when vault truly lacks the answer. The `isActionable` sanity gate helps but isn't perfect.
- **Trace bloat**: Replan traces are larger. Monitor `GZMO/Reasoning_Traces/` disk usage.

---

## 7. Wiki / Dream Engines (🟡 Mature Beta)

### What it does
- **Dream Engine**: During idle time, distills completed tasks into `Thought_Cabinet/` entries. Finds insights, contradictions, and gaps.
- **Wiki Engine**: Periodically promotes structured cabinet entries into `wiki/` articles with cross-references and source citations.
- **Self-Ask Engine**: Scans the vault for contradictions, gaps, and unreferenced entries during idle time.

### Why it's non-green
- Safe to run, well-tested ✅
- **Low signal-to-noise ratio** without human curation
- Generates content that accumulates and may need periodic cleanup
- Not mission-critical for core task processing

### Prerequisites
- `GZMO_PROFILE=full` (or enable individually)
- Chaos pulse running (requires `needsPulse` subsystems)

### Step-by-step

**Step 7.1 — Enable via profile or individual flags**

Option A: Profile (recommended)

```bash
# gzmo-daemon/.env
GZMO_PROFILE=full
```

Option B: Individual flags

```bash
GZMO_ENABLE_DREAMS=on
GZMO_ENABLE_SELF_ASK=on
GZMO_ENABLE_WIKI=on
GZMO_ENABLE_WIKI_LINT=on
GZMO_ENABLE_PRUNING=on
```

**Step 7.2 — Verify profile is active**

```bash
cd gzmo-daemon && bun run summon
# Look for: "Profile: full" in boot output
```

**Step 7.3 — Wait for autonomous cycles**

The engines run on timers:
- Dreams: every 30 minutes (adjusted by tension)
- Self-Ask: every 60 seconds (when idle + energy > 30)
- Wiki: every 60 minutes
- Wiki Lint: every 7 days
- Pruning: every 60 seconds

Wait 30–60 minutes, then check:

```bash
ls "$VAULT_PATH/GZMO/Thought_Cabinet/" | head -10
# Should see .md files generated by dreams/self-ask

ls "$VAULT_PATH/wiki/" | head -10
# Should see structured wiki articles
```

**Step 7.4 — Inspect a dream entry**

```bash
# Find the latest dream
latest=$(ls -t "$VAULT_PATH/GZMO/Thought_Cabinet/"/*.md 2>/dev/null | head -1)
head -30 "$latest"
```

Quality indicators:
- Contains specific references to source tasks
- Makes concrete claims, not vague summaries
- Includes a "Next Action" or "Verify" section

**Step 7.5 — Inspect a wiki article**

```bash
# Find a wiki article
wiki_page=$(find "$VAULT_PATH/wiki" -name "*.md" | head -1)
head -40 "$wiki_page"
```

Quality indicators:
- Has YAML frontmatter with `type`, `tags`, `updated`
- Contains a Sources section with `[E#]` citations
- Cross-links to other wiki pages via `[[Wiki Link]]`

**Step 7.6 — Tune signal-to-noise**

If output is too noisy, tighten thresholds:

```bash
# gzmo-daemon/.env
GZMO_DREAM_MIN_ENERGY=40        # Was default 20; higher = fewer dreams
GZMO_SELF_ASK_GAP_THRESHOLD=0.6  # Requires stronger cosine gap to trigger
GZMO_WIKI_MIN_CABINET_ENTRIES=5  # Wait for more cabinet content before wiki build
```

**Step 7.7 — Periodic manual curation**

Even with tuning, autonomous output benefits from human review:

```bash
# Weekly review script
echo "=== Thought Cabinet (last 7 days) ==="
find "$VAULT_PATH/GZMO/Thought_Cabinet" -mtime -7 -name "*.md" | wc -l
echo "=== Wiki articles ==="
find "$VAULT_PATH/wiki" -name "*.md" | wc -l
echo "=== Quarantine (rejected) ==="
find "$VAULT_PATH/GZMO/Quarantine" -name "*.md" | wc -l
```

### Env vars

```bash
# Profile-based (recommended)
GZMO_PROFILE=full               # Enables: dreams, self-ask, wiki, lint, pruning, pulse

# Or individual toggles
GZMO_ENABLE_DREAMS=on
GZMO_ENABLE_SELF_ASK=on
GZMO_ENABLE_WIKI=on
GZMO_ENABLE_WIKI_LINT=on
GZMO_ENABLE_PRUNING=on
GZMO_ENABLE_DASHBOARD_PULSE=on
```

### Validation
- [ ] `Thought_Cabinet/` has .md files after 30+ minutes
- [ ] `wiki/` has structured articles after 60+ minutes
- [ ] Dashboard pulse logs show periodic activity
- [ ] `health.md` shows counts for cabinet/wiki/quarantine
- [ ] No runaway growth (enable `GZMO_ENABLE_PRUNING=on`)

### Rollback
```bash
sed -i 's/GZMO_PROFILE=.*/GZMO_PROFILE=core/' gzmo-daemon/.env
# OR
sed -i 's/GZMO_ENABLE_DREAMS=.*/GZMO_ENABLE_DREAMS=off/' gzmo-daemon/.env
sed -i 's/GZMO_ENABLE_SELF_ASK=.*/GZMO_ENABLE_SELF_ASK=off/' gzmo-daemon/.env
sed -i 's/GZMO_ENABLE_WIKI=.*/GZMO_ENABLE_WIKI=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
```

### Watchouts
- **Disk growth**: Cabinet + wiki can accumulate quickly. Pruning helps but isn't automatic for all content types.
- **Embedding cost**: Every new cabinet/wiki file is embedded. Monitor `embeddings.json` size.
- **Noise amplification**: Bad dreams create bad wiki pages. Garbage in, garbage out. Periodic curation is essential.

---

## 8. Cross-Task Trace Memory (🟡 Early Beta)

### What it does
Past reasoning traces are chunked and embedded into the embedding store. Before ToT decomposition, similar past traces are retrieved and their winning strategies injected as context.

### Why it's non-green
- `sync_traces.ts` is implemented ✅
- Boot-time sync is in `index.ts` ✅ (`readBoolEnv("GZMO_ENABLE_TRACE_MEMORY")` in `bootEmbeddings()`)
- **Not yet validated** on a long-running daemon with many traces
- Trace chunks may pollute normal retrieval if not filtered properly

### Prerequisites
- At least 5 past reasoning traces exist in `GZMO/Reasoning_Traces/`
- `GZMO_ENABLE_TOT=on` (trace memory is only used in ToT path)

### Step-by-step

**Step 8.1 — Verify boot sync is active**

This is already implemented in `index.ts`. Confirm:

```bash
grep -A5 "GZMO_ENABLE_TRACE_MEMORY" gzmo-daemon/index.ts
```

You should see:
```typescript
if (readBoolEnv("GZMO_ENABLE_TRACE_MEMORY", false)) {
  const { syncTracesIntoStore } = await import("./src/learning/sync_traces");
  const added = await syncTracesIntoStore(VAULT_PATH, store, OLLAMA_API_URL);
  // ...
}
```

**Step 8.2 — Enable in `.env`**

```bash
GZMO_ENABLE_TRACE_MEMORY=on
GZMO_ENABLE_TOT=on
```

**Step 8.3 — Generate traces first**

If you have < 5 traces, run some tasks:

```bash
for i in {1..5}; do
cat > "$VAULT_PATH/GZMO/Inbox/trace_seed_${i}.md" <<EOF
---
status: pending
action: search
---
What files does the daemon write?
EOF
done
```

Wait for completion, then verify:

```bash
ls "$VAULT_PATH/GZMO/Reasoning_Traces/"*.json | wc -l
# Expected: >= 5
```

**Step 8.4 — Restart daemon and observe trace sync**

```bash
cd gzmo-daemon && bun run summon
```

In boot output, look for:
```
[EMBED] Synced 15 trace chunks into store
```

If this line appears, trace memory is working.

**Step 8.5 — Verify traces are retrievable**

Submit a new search task similar to a past one:

```bash
cat > "$VAULT_PATH/GZMO/Inbox/trace_memory_test.md" <<'EOF'
---
status: pending
action: search
---
List the operational output files written by GZMO
EOF
```

After completion, inspect the trace:

```bash
bun run trace:view GZMO/Inbox/trace_memory_test.md
```

Look for:
- An `analyze` node with `prompt_summary` containing "Past similar tasks succeeded"
- A `retrieve` node that got better recall than a baseline without trace memory

**Step 8.6 — Verify trace chunks don't pollute normal search**

Submit a non-trace query:

```bash
cat > "$VAULT_PATH/GZMO/Inbox/no_trace_pollution.md" <<'EOF'
---
status: pending
action: search
---
Explain the chaos engine
EOF
```

Check that search results are from `wiki/` files, not `traces/`:

```bash
bun run trace:view GZMO/Inbox/no_trace_pollution.md | grep -i "file:"
```

Should show `wiki/chaos.md`, not `traces/uuid.json`.

**Step 8.7 — (Optional) Manual trace sync without reboot**

```bash
cd gzmo-daemon && bun run trace:sync
```

This runs `sync_traces_cli.ts`, which embeds all traces into the store without full daemon boot.

### Env vars

```bash
GZMO_ENABLE_TRACE_MEMORY=on     # Embed past traces + retrieve similar before ToT
GZMO_ENABLE_TOT=on              # Required
```

### Validation
- [ ] Boot log shows `[EMBED] Synced N trace chunks into store`
- [ ] ToT trace shows `pastTraceContext` in analyze node
- [ ] Normal search does NOT return trace chunks
- [ ] Similar-task retrieval improves z-score (compare with/without over 10 tasks)

### Rollback
```bash
sed -i 's/GZMO_ENABLE_TRACE_MEMORY=.*/GZMO_ENABLE_TRACE_MEMORY=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
```

### Watchouts
- **Embedding cost**: Every trace is chunked into 2–3 embeddings. At 1000 traces, that's 2000–3000 extra chunks. Monitor `embeddings.json` size.
- **Privacy**: Traces contain task content. If vault is shared, traces leak query history.
- **Stale context**: Old traces may reference deleted wiki pages. The `updatedAt` field helps but isn't used for filtering yet.

---

## 9. Performance Benchmark (🟡 Mature Beta)

### What it does
Reproducible benchmark harness comparing single-shot vs ToT vs ToT+tools latency. Uses temp vault to avoid polluting real data.

### Why it's non-green
- Harness exists (`perf_benchmark.ts`) ✅
- **No baseline numbers have been collected**
- No `PERFORMANCE_BASELINE.md` committed
- Not integrated into CI or release checklist

### Prerequisites
- All components you want to benchmark are working
- `bun run benchmark` executes without errors

### Step-by-step

**Step 9.1 — Run the benchmark**

```bash
cd gzmo-daemon

# Baseline: single-shot only
GZMO_ENABLE_TOT=off GZMO_ENABLE_TOOLS=off GZMO_BENCHMARK_RUNS=5 bun run benchmark 2>&1 | tee benchmark_baseline.txt

# ToT only
GZMO_ENABLE_TOT=on GZMO_ENABLE_TOOLS=off GZMO_BENCHMARK_RUNS=5 bun run benchmark 2>&1 | tee benchmark_tot.txt

# ToT + tools
GZMO_ENABLE_TOT=on GZMO_ENABLE_TOOLS=on GZMO_BENCHMARK_RUNS=5 bun run benchmark 2>&1 | tee benchmark_tot_tools.txt
```

**Step 9.2 — Parse results**

Extract key numbers:

```bash
# Quick parser
python3 <<'PY'
import re, sys

for fname in ['benchmark_baseline.txt', 'benchmark_tot.txt', 'benchmark_tot_tools.txt']:
    print(f"\n=== {fname} ===")
    with open(fname) as f:
        text = f.read()
    for scenario in ['simple_think', 'simple_search', 'search_tot', 'search_tot_tools']:
        m = re.search(rf"--- {scenario} ---.*median: (\d+)ms", text, re.DOTALL)
        if m:
            print(f"  {scenario:20s}: {m.group(1)}ms")
PY
```

**Step 9.3 — Create baseline document**

```bash
cat > docs/PERFORMANCE_BASELINE.md <<'EOF'
# GZMO Performance Baseline

**Date:** 2026-05-06
**Hardware:** $(grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2 | xargs)
**RAM:** $(free -h | awk '/^Mem:/ {print $2}')
**Model:** $(ollama list | head -2 | tail -1 | awk '{print $1}')

## Results

| Scenario | Config | Median |
|----------|--------|--------|
EOF

for fname in benchmark_baseline.txt benchmark_tot.txt benchmark_tot_tools.txt; do
    config=$(echo $fname | sed 's/benchmark_//;s/.txt//')
    median=$(grep "median:" "$fname" | head -1 | grep -oP '\d+' | head -1)
    echo "| $config | $config | ${median}ms |" >> docs/PERFORMANCE_BASELINE.md
done

cat >> docs/PERFORMANCE_BASELINE.md <<'EOF'

## Thresholds

- Acceptable: ToT ≤ 2.5× single-shot median
- Warning: ToT 2.5–4× single-shot
- Unacceptable: ToT > 4× → reduce GZMO_TOT_MAX_NODES or disable ToT

## Tuning Guide

If ToT is too slow:
1. Reduce GZMO_TOT_MAX_NODES (default 15 → 10)
2. Disable GZMO_TOT_BEAM
3. Set GZMO_ENABLE_TOOLS=off
4. Use GZMO_PROFILE=minimal
EOF
```

**Step 9.4 — Add benchmark to release checklist**

Create `scripts/release_checklist.sh`:

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/../gzmo-daemon"

echo "=== Typecheck ==="
npx tsc --noEmit

echo "=== Tests ==="
bun test

echo "=== Eval ==="
bun run eval:quality

echo "=== Benchmark ==="
GZMO_ENABLE_TOT=on GZMO_ENABLE_TOOLS=on GZMO_BENCHMARK_RUNS=3 bun run benchmark

echo "=== All checks passed ==="
```

```bash
chmod +x scripts/release_checklist.sh
```

**Step 9.5 — Monitor regression over time**

Add a cron job or systemd timer:

```bash
# ~/.config/systemd/user/gzmo-benchmark.timer
[Unit]
Description=Weekly GZMO benchmark

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
# ~/.config/systemd/user/gzmo-benchmark.service
[Unit]
Description=GZMO benchmark run

[Service]
Type=oneshot
WorkingDirectory=%h/tinyFolder/gzmo-daemon
Environment=GZMO_BENCHMARK_RUNS=3
Environment=GZMO_ENABLE_TOT=on
ExecStart=/usr/bin/bun run benchmark
StandardOutput=append:%h/tinyFolder/gzmo-daemon/benchmark_history.log
```

### Env vars

```bash
GZMO_BENCHMARK_RUNS=5            # Iterations per scenario
```

### Validation
- [ ] `bun run benchmark` completes without errors
- [ ] Results show median/p95 for each scenario
- [ ] `docs/PERFORMANCE_BASELINE.md` committed
- [ ] ToT median < 2.5× single-shot median
- [ ] Release checklist script exists and passes

### Rollback
Remove benchmark files — no runtime impact.

### Watchouts
- **First-run penalty**: First benchmark run includes model load time. Discard or expect higher numbers.
- **Concurrent tasks**: Running benchmark while daemon is active causes resource contention.
- **Temp vault cleanup**: Benchmark leaves temp dirs. Run `rm -rf /tmp/gzmo-benchmark-*` periodically.

---

## 10. Integration Checklist

After implementing ALL non-green components, run this master check:

```bash
cd tinyFolder/gzmo-daemon

# 1. Type safety
npx tsc --noEmit || { echo "FAIL: typecheck"; exit 1; }

# 2. Tests
bun test || { echo "FAIL: tests"; exit 1; }

# 3. Eval harness
bun run eval:quality || { echo "FAIL: eval"; exit 1; }

# 4. Benchmark
GZMO_ENABLE_TOT=on GZMO_ENABLE_TOOLS=on GZMO_BENCHMARK_RUNS=3 bun run benchmark || { echo "FAIL: benchmark"; exit 1; }

# 5. Verify KG exists
[ -f "$VAULT_PATH/GZMO/Knowledge_Graph/snapshot.json" ] || echo "WARN: KG not yet populated (needs tasks)"

# 6. Verify ledger
[ -f "$VAULT_PATH/GZMO/strategy_ledger.jsonl" ] || echo "WARN: Ledger not yet populated (needs tasks)"

# 7. Verify traces
[ -f "$VAULT_PATH/GZMO/Reasoning_Traces/index.jsonl" ] || echo "WARN: No traces yet"

# 8. Health report
cat "$VAULT_PATH/GZMO/health.md" 2>/dev/null | head -20

echo "=== Integration check complete ==="
```

### Final `.env` for fully-enabled daemon

```bash
# Core
VAULT_PATH="/absolute/path/to/your/vault"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="hermes3:8b"

# Reasoning Engine
GZMO_ENABLE_TRACES=on
GZMO_ENABLE_TOT=on
GZMO_ENABLE_TOOLS=on
GZMO_ENABLE_TOOL_CHAINING=on
GZMO_MAX_TOOL_CALLS=5
GZMO_ENABLE_CRITIQUE=on
GZMO_ENABLE_GATES=on

# Knowledge & Learning
GZMO_ENABLE_KNOWLEDGE_GRAPH=on
GZMO_KG_SEARCH_AUGMENT=off          # Enable only after KG validated
GZMO_ENABLE_LEARNING=on
GZMO_ENABLE_TRACE_MEMORY=on

# Model Routing (adjust to your hardware)
GZMO_ENABLE_MODEL_ROUTING=off       # Enable only if 48GB+ RAM
GZMO_FAST_MODEL="qwen2.5:7b"
GZMO_REASON_MODEL="qwq:32b"
GZMO_JUDGE_MODEL="hermes3:8b"

# Autonomous Engines
GZMO_PROFILE=full                   # Or individual toggles

# Safety / Retrieval
GZMO_VERIFY_SAFETY=on
GZMO_ENABLE_SELF_EVAL=on
GZMO_MIN_RETRIEVAL_SCORE=0.32
```

---

*End of Non-Green Implementation Guide. Start with §3 (Knowledge Graph) and progress in order.*
