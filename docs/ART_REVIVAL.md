# GZMO Art Section — Revival Assessment

> **Bottom line:** The art modules contain genuinely good ideas buried under architectural overreach. They can be revived, but only if you stop pretending the machine can autonomously curate knowledge.

---

## What the art section actually is

| Module | Lines | Purpose | Current state |
|--------|-------|---------|--------------|
| `pulse.ts` | 335 | Chaos heartbeat (174 BPM) + trigger dispatch | **Clean. Works.** |
| `chaos.ts` | 130 | Lorenz attractor + Logistic map | **Clean. Deterministic.** |
| `thoughts.ts` | 185 | Thought Cabinet (absorb → incubate → crystallize) | **Cool mechanic.** |
| `dreams.ts` | 700 | Distill completed tasks into structured diary entries | **Good core idea. Over-engineered pipeline.** |
| `self_ask.ts` | 700 | Autonomous gap-finding + contradiction scanning | **The bureaucracy engine.** |
| `honeypot_edges.ts` | 150 | Parse connection claims from LLM output | **Fine struct. Bad input.** |
| `linc_filter.ts` | 430 | Regex-based neurosymbolic validation of LLM claims | **Fundamentally misguided.** |
| `core_wisdom.ts` | 170 | YAML routing table parser | **Not harmful. Not useful.** |
| `wiki_engine.ts` | 570 | Auto-cluster Thought Cabinet → wiki articles | **More LLM-on-LLM noise.** |
| `prune.ts` | 90 | Archive digested tasks | **Actually useful.** |

**Total art-only code:** ~3,370 lines.

---

## The fatal flaw: LLM Telephone

The art pipeline is six stages deep:

```
Task completes
    ↓
DreamEngine.distill()       → LLM call #1 (summarize task)
    ↓
SelfAskEngine.gap_detective() → LLM call #2 (find connections)
    ↓
SelfAskEngine.contradiction_scan() → LLM call #3 (verify dreams)
    ↓
extractEdgeCandidate()      → Regex parse (heuristic)
    ↓
LINC filter                 → Regex NLP (430 lines of SVO parsing)
    ↓
CoreWisdom routing          → YAML parser
    ↓
WikiEngine.consolidate()    → LLM call #4 (synthesize wiki page)
```

At each LLM stage, hallucination compounds. By the time you reach LINC, you're validating the LLM's hallucinations about its own summaries of its own gap analysis. The signal-to-noise ratio asymptotes to zero.

The self-ask engine is the worst offender. It runs during "idle time" — but a machine with 128GB unified memory running Ollama is never truly idle. So it generates busywork: auto-tasks written to the Inbox that the daemon then processes, which creates new dreams, which trigger new self-ask cycles. It's a **perpetual motion bureaucracy machine**.

The LINC filter is the most tragic: 430 lines of sophisticated regex trying to do Subject-Verb-Object parsing on LLM output. It rejects some noise, but it cannot validate factual accuracy. Using regex to validate LLM claims is like using a ruler to measure fog.

---

## What's actually good

### 1. The chaos math (`chaos.ts`, `pulse.ts`)
- Lorenz RK4 integration is correct.
- The Logistic map coupling is a nice touch.
- The snapshot system is well-designed.
- **Verdict:** Keep. This is the heart of the art project.

### 2. The Thought Cabinet (`thoughts.ts`)
- Absorption at 18% probability creates nice rarity.
- Incubation durations by category are thoughtful.
- Crystallization mutations permanently altering the attractor is genuinely cool.
- **Verdict:** Keep as an ambient creative system. Don't let it trigger tasks.

### 3. Dreams as structured summaries (`dreams.ts`)
- The structured schema (summary, evidence, delta, nextActions, confidence, anchors) is well-designed.
- Digested-task tracking prevents re-processing.
- Novelty gating and duplicate detection are sensible.
- Anchor verification tries to ground claims in the vault.
- **Verdict:** Salvage the distillation logic. Kill the auto-task creation.

### 4. The Pruning Engine (`prune.ts`)
- Archives completed tasks. Simple. Useful.
- **Verdict:** Keep. Not even really art.

---

## Three revival paths

### Path A: Conservative — Human Gates (keep everything, add friction)

Don't delete any modules. Instead, insert human approval between each stage:

| Stage | Instead of... | Do this... |
|-------|--------------|-----------|
| Dreams | Auto-write to Thought Cabinet | Write to `Thought_Cabinet/drafts/`. Human moves to `dreams/` or deletes. |
| Self-Ask | Auto-fire during idle | Require explicit `/reflect` Pi command or Inbox task. |
| Honeypots | Auto-extract from self-ask | Human writes JSON edge entries directly, or confirms dream suggestions. |
| Wiki | Auto-cluster + synthesize | Human picks cabinet entries, runs `gzmo_make_wiki` tool. |

**Pros:** Minimal code changes. Art pipeline still exists.
**Cons:** The self-ask and LINC code is still 1,100 lines of active temptation to turn autonomy back on. You're one env var away from bureaucracy.

### Path B: Moderate — Ambient Garden (recommended)

Keep the creative/aesthetic systems. Kill the autonomous reasoning loops.

**Keep:**
- `pulse.ts` + `chaos.ts` — heartbeat, dashboard, crystallization artifacts
- `thoughts.ts` — Thought Cabinet as ambient creative journal
- `dreams.ts` — but ONLY as on-demand/end-of-day digest. No auto-fire. No auto-tasks.
- `prune.ts` — archive old tasks

**Kill:**
- `self_ask.ts` — Replace with explicit "review" Inbox task
- `linc_filter.ts` — Cannot validate LLM output with regex
- `honeypot_edges.ts` auto-extraction — Replace with manual `edges.jsonl` editing
- `core_wisdom.ts` auto-routing — Replace with static `GZMO/routing.yaml`
- `wiki_engine.ts` auto-clustering — Replace with explicit `action: wiki` Inbox task

**New contract:**
- Chaos heartbeat runs in `full` profile, but it only writes to `Live_Stream.md` and creates `Thought_Cabinet/crystallizations/`. It never creates Inbox tasks.
- Dreams run when user drops `action: dream` task in Inbox, or via Pi `/gzmo-dream` command.
- The vault's knowledge graph is human-curated. GZMO suggests, human decides.

**Pros:** The art survives as a creative layer. No bureaucracy loops. Code shrinks by ~1,800 lines.
**Cons:** Requires deleting files (or at least disabling their intervals).

### Path C: Radical — Chaos Dashboard Only

Strip to the essential aesthetic:

**Keep:**
- `pulse.ts` + `chaos.ts` + `thoughts.ts` — ambient heartbeat and cabinet
- `prune.ts` — maintenance

**Kill everything else:**
- Dreams become a simple `action: think` template variant ("summarize this task")
- Self-ask, honeypots, LINC, core wisdom, wiki engine all deleted
- The "art" is the Lorenz attractor live-ticking in `Live_Stream.md` with occasional crystallization events

**Pros:** Art is honest about what it is. No false promises of autonomous cognition.
**Cons:** You lose the dream diary entirely.

---

## My recommendation

**Path B: Ambient Garden.**

Why:
1. The dream diary is genuinely useful. Reading a structured summary of what the daemon did today is valuable for sense-making.
2. The chaos heartbeat + Thought Cabinet are beautiful. They give the machine a personality without pretending the personality improves reasoning.
3. Removing self-ask eliminates the bureaucracy loop while keeping the creative surface area.
4. The DGX Spark has 128GB. You have headroom to run dreams as explicit commands. You don't need them auto-firing during idle time.

---

## What "Path B" looks like in practice

### The new `full` profile behavior

```
✅ Inbox watcher        — watches for tasks, processes them
✅ Embeddings sync       — RAG works
✅ Dashboard pulse       — 174 BPM heartbeat, writes Live_Stream.md
✅ Thought Cabinet       — absorbs task completions, crystallizes
❌ Dream auto-fire       — OFF (dreams are manual only)
❌ Self-ask idle loop    — OFF (deleted)
❌ Honeypot extraction   — OFF (human curates edges.jsonl)
❌ Wiki auto-cluster     — OFF (human triggers wiki synthesis)
```

### How you use it

**Morning:** Check `Live_Stream.md` for overnight crystallizations (if any). Browse `Thought_Cabinet/` for interesting emergent thoughts.

**During work:** Drop tasks in Inbox. Daemon processes them. Pure deterministic core. No art noise.

**End of day:** Run one of:
```bash
# Via Pi
/gzmo-dream --today    # Summarize today's completed tasks into Thought_Cabinet

# Or via Inbox task
---
status: pending
action: dream
---
Digest today's completed tasks. Focus on patterns I might have missed.
```

**When curious:**
```bash
# Explicit review — machine searches, human interprets
/gzmo-review wiki/deployment.md wiki/monitoring.md
# → One-shot search + summary. No auto-pipeline. No honeypots.
```

**Wiki maintenance:**
```bash
# When you have 5 cabinet entries you want to consolidate
---
status: pending
action: wiki
sources:
  - Thought_Cabinet/2026-05-05_pattern-a.md
  - Thought_Cabinet/2026-05-06_pattern-b.md
---
Synthesize these cabinet entries into a wiki page about deployment patterns.
```

---

## Implementation sketch

### Step 1: Disable auto-firing intervals

In `index.ts`, wrap dream/self-ask intervals in explicit checks:

```typescript
// Dreams: remove setInterval. Add explicit trigger only.
// Self-Ask: delete the entire setInterval block.
// Wiki Engine: remove setInterval. Only trigger via action: wiki tasks.
```

### Step 2: Add explicit Pi triggers

```typescript
// New Pi tool
{ name: 'gzmo_dream', parameters: { period: 'today' | 'week' } }
// Runs DreamEngine.dream() once. Human reviews output.
```

### Step 3: Add `action: dream` task handling

In `engine.ts`'s action router:
```typescript
case "dream":
  // Import dreams module lazily
  // Run DreamEngine on specified task files
  // Write to Thought_Cabinet/
```

### Step 4: Delete or archive dead code

- `self_ask.ts` → move to `archive/` or delete
- `linc_filter.ts` → delete (regex LLM validation is the wrong approach)
- `honeypot_edges.ts` auto-extraction → keep the types, delete the engine
- `core_wisdom.ts` → replace with static YAML file
- `wiki_engine.ts` auto-interval → delete interval, keep `action: wiki` handler

### Step 5: Update profiles

```typescript
case "full":
  // Art ON but only ambient + manual
  enableDreams: false,        // dreams are manual trigger only
  enableSelfAsk: false,       // deleted
  enableWiki: true,           // action: wiki tasks still work
  enableIngest: false,        // manual only
  enableDashboardPulse: true, // heartbeat lives
```

Add `enableDreamAutoFire` if you want backward compatibility.

---

## Honest reckoning

| Claim in the code | Reality |
|-------------------|---------|
| "Self-asking patterns, CAIM Memory Controller" | The LLM is not "self-asking." It's generating text in response to a prompt. There's no persistent cognitive loop. |
| "Neurosymbolic knowledge channeling" | LINC is regex on strings. It's not neurosymbolic. It's not channeling knowledge. |
| "Autonomous Knowledge Consolidation" | The machine shuffles text it doesn't understand into formats it can't verify. |
| "Chaos-aware LLM parameter modulation" | Lorenz-derived temperature values have no correlation with task success. It's numerology. |

**The art section is not a reasoning engine. It's a poetry generator.** And that's fine — poetry is valuable. But it must be honest about its nature.

The revival is not about making the bureaucracy work. It's about keeping the poetry and killing the pretense.

---

*Assessment written after reading 3,370 lines of art code across 10 modules.*
