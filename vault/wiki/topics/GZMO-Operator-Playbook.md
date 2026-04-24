---
title: GZMO Operator Playbook
type: topic
tags: [operations, playbook, daemon]
sources: 0
created: "2026-04-24"
updated: "2026-04-24"
---

# GZMO Operator Playbook

## Daily operator loop (minimal)

- Open:
  - `GZMO/Live_Stream.md`
  - `GZMO/health.md`
  - `GZMO/Inbox/` (sort by newest)
- Do:
  - Complete the oldest `type: verify` tasks first.
  - Then `maintenance` (keep the system clean).
  - Then `build` and `research`.

## Start / Stop

- **Start Ollama**: `ollama serve`
- **Start daemon**: from `tinyFolder/gzmo-daemon/`:

```bash
GZMO_PROFILE=full VAULT_PATH="/home/maximilian-wruhs/tinyFolder/vault" bun run index.ts
```

- **Stop daemon**: `Ctrl+C` (graceful shutdown)

## Runtime profiles (when to use)

- **full**: normal autonomy mode (dream/self-ask/wiki/ingest/lint/prune on)
- **standard**: tasks + embeddings, but no dream/self-ask/wiki
- **minimal**: just inbox processing, no embeddings
- **heartbeat**: heartbeat only (no task processing)

## Health page triage (`GZMO/health.md`)

If the loop feels “dead”:
- Check `Scheduler` flags (dreams/selfAsk/wiki/ingest).
- Check inbox counts (pending stuck?) and `pulse` energy.
- Check `ollama` reachability.

If the loop feels “spammy”:
- Check inbox growth rate (rate limit in auto-tasks should cap it).
- Look for repeated auto tasks with similar titles (dedupe digest issue).

## Quarantine triage (`GZMO/Quarantine/`)

Quarantine exists to prevent hallucinations from entering wiki/RAG.

- If quarantine grows:
  - Process the newest `maintenance` tasks that reference a quarantine file.
  - Fix the upstream prompt/gate (Dream/Wiki) that produced the bad artifact.

## Common failure modes

### A) Ollama down

- Symptoms: tasks marked `failed`, dream/self-ask/wiki cycles silent.
- Fix: start `ollama serve`, restart daemon.

### B) Embeddings drift / RAG blind spots

- Symptoms: search results irrelevant, new tasks not referenced.
- Fix: force a full embeddings sync (restart daemon with embeddings sync enabled).

### C) Inbox backlog too large

- Symptoms: many pending tasks, operator overwhelmed.
- Fix:
  - batch-cancel low-value tasks (`status: cancelled`)
  - prioritize `verify` then `maintenance`
  - let pruning run during low tension windows

## Tuning knobs (safe)

- `GZMO_PROFILE` to enable/disable subsystems.
- Task types and typed Next Actions:
  - only `[maintenance] [research] [build] [verify] [curate]` are promoted into new Inbox tasks.

