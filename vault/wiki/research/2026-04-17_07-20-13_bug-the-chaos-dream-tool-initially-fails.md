---
title: "Research: Bug:** The `chaos_dream` tool initially fails to detect all available undigested session logs, requiring explicit re-runs to process them."
type: topic
role: generated
retrieval_priority: low
tags: [research, generated, implementation-plan, session]
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Research: Bug:** The `chaos_dream` tool initially fails to detect all available undigested session logs, requiring explicit re-runs to process them.

## Insights

- **Implement Idempotent Cursor-Based Ingestion:** Enhance `chaos_dream` with a persistent cursor (timestamp/ID) that tracks the last processed log. This ensures each run reliably identifies
