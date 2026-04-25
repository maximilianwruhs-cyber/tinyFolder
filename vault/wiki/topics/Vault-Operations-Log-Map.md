---
title: "Vault Operations Log Map"
type: topic
role: operational
retrieval_priority: high
tags: [operations, navigation, log, wiki-health, small-llm]
sources: 1
created: 2026-04-25
updated: 2026-04-25
---

# Vault Operations Log Map

Use this page before opening [[log]]. The full operations log is append-only and long; this map gives small LLMs a short route into it.

## What The Log Is

- [[log]] is the chronological append-only record of wiki operations, ingests, lints, and structural updates.
- It is useful as provenance, not as the first source for current architecture.
- For current behavior, prefer [[GZMO-System-Contracts]], [[START]], and [[overview]].

## Current High-Signal Events

- 2026-04-25: Google Takeout corpus imported and summarized as [[source-google-takeout-20260424t094708z-3-001]].
- 2026-04-25: Vault structure optimized for small LLM retrieval with `role`, `tags`, `retrieval_priority`, and collision-safe links.
- 2026-04-25: Phase 2 curation started to promote stable facts from long generated pages into canonical hubs.

## Retrieval Policy

The full [[log]] page is marked `retrieval_priority: low`. Search should surface this map first for operational-history questions, then open the full log only when exact chronology or provenance is needed.
