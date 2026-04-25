---
title: "GZMO Operator Playbook"
type: topic
role: canonical
tags: [operations, playbook, daemon]
sources: 0
created: "2026-04-24"
updated: 2026-04-25
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

## Small-LLM runtime profile

- Prefer models that reliably follow short JSON schemas. If structured outputs start failing, lower temperature first before changing prompts.
- Keep `OLLAMA_MODEL` explicit in the daemon environment; avoid changing models without re-running Doctor and a small inbox smoke test.
- For constrained hardware, keep the context window modest (`num_ctx` around 2048-4096) and rely on RAG metadata filters plus wiki graph neighbors instead of large raw context.
- If Ollama exposes KV-cache or context options for the chosen model, prefer conservative cache precision over extreme quantization for sub-3B models; tiny models are more sensitive to cache noise.
- N-gram or prompt-lookup speculative decoding is the safest speed path when available because it adds no second model and benefits GZMO's repeated JSON/Markdown formats.
- Avoid neural draft-model speculative decoding unless the draft and target model share the exact tokenizer and special tokens.
- Use `GZMO/TELEMETRY.json` for machine-readable status before asking the model to reason over logs. `GZMO/health.md` remains the human page.

## Structured-output checks

- Dream and reflexion prompts should produce strict JSON internally, then render Markdown only after validation.
- Claims that cannot be restored to an exact anchor should stay in `Unverified Claims` or be rejected by the quality gate.
- Search tasks can narrow RAG with inline filters such as `tag:architecture`, `type:entity`, or `path:wiki/entities`.

## Generated stream triage

- Start with [[GZMO-Maintenance-Digests]] before opening dated self-ask, heartbeat, dream, unknown, or generated wiki pages.
- Promote durable findings into [[GZMO-System-Contracts]], this playbook, or canonical entity/topic pages.
- Leave one-off generated observations in the dated pages as evidence.

