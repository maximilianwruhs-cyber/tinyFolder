---
title: "GZMO System Contracts"
type: entity
role: canonical
tags: [architecture, contracts, daemon, operations]
sources: 0
created: "2026-04-24"
updated: "2026-04-24"
---

# GZMO System Contracts

This page defines **operational contracts** for each subsystem: inputs, outputs, gates, invariants, and how the loop is supposed to compose.

## Loop overview (contract view)

- **Inbox task** (`GZMO/Inbox/*.md`, `status: pending`) → **TaskEngine** writes `## GZMO Response` and sets `status: completed|failed`.
- **Completed tasks** → **DreamEngine** distills to `GZMO/Thought_Cabinet/*_dream.md` (only if quality checks pass).
- **Embeddings** index `wiki/`, `GZMO/Thought_Cabinet/`, `GZMO/Inbox/` into `GZMO/embeddings.json` for RAG grounding.
- **Self-Ask** writes `*_gap_detective.md`, `*_contradiction_scan.md`, `*_spaced_repetition.md` into `GZMO/Thought_Cabinet/`.
- **WikiEngine** promotes clusters from `Thought_Cabinet` into `vault/wiki/**` pages and updates `wiki/index.md` + `wiki/log.md`.
- **PulseLoop** continuously updates `GZMO/CHAOS_STATE.json` and modulates scheduling + LLM params, but must not create “knowledge” directly.

## Contracts by subsystem

### Inbox + Watcher (`src/watcher.ts`)

- **Reads**: `GZMO/Inbox/*.md`
- **Emits**: `task` event only when `frontmatter.status === "pending"`
- **Does not**: process subdirs (depth 0), react to non-`.md` files.
- **Invariants**:
  - Must not re-trigger on daemon writes (`lockFile`/`unlockFile` pattern).
  - Must never emit tasks that are already `processing|completed|failed`.

### TaskEngine (`src/engine.ts`)

- **Input**: `TaskEvent { filePath, fileName, body, frontmatter }`
- **Writes**:
  - Updates frontmatter to `processing`, then `completed|failed`
  - Appends `## GZMO Response` to the same inbox file
  - Optionally writes chained tasks to `GZMO/Subtasks/` (chain mode)
- **Emits** (to `PulseLoop`):
  - `task_received { fileName, action, title?, bodyLength }`
  - `task_completed { fileName, action, summary?, tokenCount, durationMs }`
  - `task_failed { fileName, action, errorType }`
- **Gates**:
  - Task routing by `frontmatter.action` (`think|search|chain`)
  - RAG injection only when `action: search` and embeddings store exists
- **Quality invariants**:
  - Must follow explicit user constraints (exact structure, exact bullet counts, verbatim quotes).
  - Must not invent facts outside task/context; should say “not provided” when missing.

### PulseLoop + ThoughtCabinet (`src/pulse.ts`, `src/thoughts.ts`, `src/feedback.ts`)

- **Writes**: `GZMO/CHAOS_STATE.json` periodically
- **Internalizes seeds** (strict gate):
  - Allowed: `task_completed`, `dream_proposed`, `self_ask_completed`, `wiki_consolidated`
  - Disallowed: `heartbeat_fired`, `task_received` (telemetry/noise)
- **Invariants**:
  - Telemetry must not become “knowledge”.
  - Crystallization should be low-frequency and high-signal (seed-gated).

### Embeddings + RAG (`src/embeddings.ts`, `src/embeddings_queue.ts`, `src/search.ts`)

- **Writes**: `GZMO/embeddings.json`
- **Indexes folders**: `wiki/`, `GZMO/Thought_Cabinet/`, `GZMO/Inbox/`, …
- **Live-sync**:
  - Watches `wiki/` + `GZMO/Thought_Cabinet/`
  - `GZMO/Inbox/` changes must be explicitly enqueued after task completion
- **Invariants**:
  - Identical text can exist in multiple files; vector reuse allowed, provenance must remain correct.

### DreamEngine (`src/dreams.ts`)

- **Reads**: completed inbox tasks (transcript)
- **Writes**: `GZMO/Thought_Cabinet/*_dream.md`
- **Quality gates**:
  - Requires structured draft (Summary/Evidence/Delta/Next Actions/Confidence)
  - Rejects low-signal / duplicate-like output
- **Emits**: `dream_proposed` (for internalization)

### SelfAskEngine (`src/self_ask.ts`)

- **Reads**: embeddings store; recent dream/cabinet files
- **Writes**: self-ask notes to `GZMO/Thought_Cabinet/`
- **Gates**:
  - Skip if extreme stress (tension high) or low energy
  - Caps to `MAX_AUTO_TASKS_PER_CYCLE`
- **Invariants**:
  - Constraint-first prompts; “No Information” protocol where applicable.

### WikiEngine (`src/wiki_engine.ts`)

- **Reads**: `GZMO/Thought_Cabinet/*.md` (unconsolidated)
- **Writes**:
  - `vault/wiki/{concepts|entities|research|sessions|topics}/*.md`
  - `GZMO/.gzmo_wiki_digest.json`
  - `wiki/index.md`, `wiki/log.md`
- **Gates**:
  - Cluster threshold (`MIN_CLUSTER_SIZE`) + per-category minimum
- **Quality invariants**:
  - Must be extractive: only synthesize what is present in provided entries (and optional RAG context).
  - Must not introduce generic filler or external claims.

### IngestEngine (`src/ingest_engine.ts`)

- **Reads**: `vault/raw/**/*.md` (append-only human/importer writes)
- **Writes**: `vault/wiki/sources/*.md` summaries + `GZMO/.gzmo_ingest_digest.json`
- **Invariants**:
  - Must never write into `vault/raw/` (raw is immutable for the daemon).

### PruningEngine (`src/prune.ts`)

- **Reads**: `.gzmo_dreams_digested.json` + inbox statuses
- **Writes**: moves old/digested inbox tasks to archive
- **Invariant**: prune only during low stress windows (avoid destabilizing active work).

## Known current risks (to monitor)

- Inbox embeddings can drift unless post-task upserts always run.
- Wiki consolidation prompts must stay strict, otherwise it hallucinates and pollutes RAG.
## Small-LLM Retrieval Contract

- RAG should prefer canonical pages (`role: canonical`) and compact maps before generated histories.
- `role: generated` means useful evidence, not durable truth.
- `role: raw-summary` means provenance summary; promote stable conclusions into entity/topic pages.
- `retrieval_priority: low` marks long operational/session pages that should not be first-choice context.
- For the full query contract, read [[Local-RAG-Contract]].
## Source Index

- Stable daemon behavior is canonical here when it has code support in `gzmo-daemon/src/` or repeated operational evidence.
- Generated notes and Takeout notebooks are inputs, not contracts, until promoted here.
- Related curation maps: [[Vault-Operations-Log-Map]], [[GZMO-Maintenance-Digests]], [[Local-RAG-Contract]].

