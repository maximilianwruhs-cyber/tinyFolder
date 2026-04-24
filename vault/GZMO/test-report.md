---
title: GZMO Test Report
type: report
tags: [test, operations, autoloop]
sources: 0
created: "2026-04-24"
updated: "2026-04-24"
---

# GZMO Test Report (2026-04-24)

## Summary

- Daemon boots and runs with `GZMO_PROFILE=full`.
- Inbox watcher processes tasks end-to-end (pending → processing → completed).
- Autoloop task promotion works: typed next actions create auto Inbox tasks with dedupe + rate limit.
- Quality protections present: wiki drafts are gated and would quarantine on missing evidence.
- Test suite passes.

## Runtime (health snapshot)

From `GZMO/health.md`:

- profile: `full`
- model: `hermes3:8b`
- ollama: `http://localhost:11434`
- pulse: alive=`true`, phase=`build`, tension=`41.3%`, energy=`88%`, tick=`346`
- inbox counts: pending=0, processing=0, completed=8, failed=0
- quarantine notes: 0

## Autoloop promotion evidence

Recent inbox files include auto-generated typed-action tasks:

- `GZMO/Inbox/2026-04-24__verify__implement_the_system_to_create_incoming_tasks_from_typed_next_actions_in_dream_n__27a6be5a250b9778.md`
- `GZMO/Inbox/2026-04-24__maintenance__update_my_mind_with_instructions_on_how_verify_type_tags_trigger_new_inbox_task___a29a7f0846a97fe9.md`

Auto-task system details:
- Typed actions syntax: `[maintenance]`, `[research]`, `[build]`, `[verify]`, `[curate]`
- Dedupe digest: `GZMO/.gzmo_auto_tasks.json`
- Rate limit: max 20 auto tasks per hour (global)

## Quarantine lane

- Quarantine path: `GZMO/Quarantine/`
- Gate currently checks wiki drafts for:
  - Evidence section with per-entry citations
  - Next actions section
  - minimum length
- On failure, draft is written to quarantine and an auto repair task is created.

## Test suite

- Command: `bun test` (in `tinyFolder/gzmo-daemon/`)
- Result: **15 pass / 0 fail**
- JUnit report written to: `GZMO/test-report.junit.xml`

