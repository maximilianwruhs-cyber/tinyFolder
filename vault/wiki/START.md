---
title: "Vault Start Map"
type: map
role: canonical
tags: [navigation, small-llm, wiki-health]
sources: 0
created: 2026-04-25
updated: 2026-04-25
---

# Vault Start Map

Use this page first when context is tight. It tells a small model where to look before opening broad indexes or raw archives.

## Read Order

1. [[overview|Overview]] for the current shape of the knowledge base.
2. [[GZMO-System-Contracts]] for daemon and vault invariants.
3. [[GZMO-Operator-Playbook]] for operational procedures.
4. [[source-google-takeout-20260424t094708z-3-001]] for the latest bulk Takeout import.
5. [[Local-RAG-Contract]] when a task asks what search or embeddings can see.
6. [[2026-04-18_session-history-map]] or [[Vault-Operations-Log-Map]] before opening long session/log pages.
7. [[wiki/index|Wiki Index]] only after choosing a target section.

## Folder Map

- `wiki/entities/` contains durable nouns: systems, tools, projects, and machines.
- `wiki/concepts/` contains durable abstractions and patterns.
- `wiki/topics/` contains curated thematic pages.
- `wiki/research/` contains dated investigations and narrow findings.
- `wiki/sessions/` contains session distillations and task-history rollups.
- `wiki/sources/` contains source summaries; read these when provenance matters.
- `GZMO/Thought_Cabinet/` contains generated reflections and should be treated as evidence, not canon.
- `raw/` contains immutable source material and should not be edited.

## Retrieval Notes

- Embeddings index curated layers (`wiki/`, `GZMO/Thought_Cabinet/`, `GZMO/Inbox/`, `Projects/`, `Notes`) rather than `raw/`.
- Raw imports become useful to RAG after a source summary or entity/topic update links them into `wiki/`.
- Prefer queries with `type:`, `tag:`, or `path:` filters when possible, for example `type:entity tag:architecture GZMO`.

## Quality Rules

- Trust `wiki/overview.md` for high-level orientation, then verify with source summaries.
- Prefer pages with clear frontmatter, recent `updated`, and explicit `## Sources` or `## Raw Source` sections.
- Treat long generated dated pages as lower priority unless the date or title directly matches the task.
