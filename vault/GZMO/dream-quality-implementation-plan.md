---
title: Dream Quality Improvement Implementation Plan
date: 2026-04-22
author: Codex
tags: [gzmo, dreams, quality, implementation-plan]
---

# Dream Quality Improvement Implementation Plan

## Goal
Improve the practical usefulness of dream outputs by reducing repetitive noise, enforcing source grounding, and requiring actionable outcomes.

## Current Problems (Observed)
1. Output volume is high, but novelty is low.
2. Heartbeat crystallizations dominate and repeat near-identical content.
3. Many entries are status snapshots rather than useful decisions or insights.
4. Some dream entries reference source tasks that cannot be resolved reliably.
5. Outputs often miss explicit next actions.

## Quality Definition
A dream entry is "high quality" if it satisfies all of the following:
1. Grounded: Claims are traceable to a resolvable source task or known vault content.
2. Novel: It adds new information relative to recent entries.
3. Actionable: It provides at least one concrete next step.
4. Specific: It includes enough detail to execute or verify the suggestion.
5. Compact: It avoids repetitive boilerplate and heartbeat-only noise.

## Proposed Architecture Changes

### 1) Add a Pre-Write Quality Gate
Introduce a gate before writing to `Thought_Cabinet`:
1. Source Check: `source_task` must resolve to an existing file path.
2. Novelty Check: Compare candidate text against recent N entries (e.g., 20) and block if similarity is too high.
3. Actionability Check: Require at least one "Next Action" item.
4. Minimum Evidence Check: Require at least one source reference for factual claims.

If a candidate fails, do not write a full dream file. Instead:
1. Store a lightweight skip event in logs.
2. Optionally increment a quality-failure metric.

### 2) Separate Signal from Heartbeat Noise
Keep heartbeat events out of primary dream output:
1. Route heartbeat-only crystallizations into a separate `system_telemetry` stream/file.
2. Only allow heartbeat events into `Thought_Cabinet` if a threshold event occurs (e.g., anomaly, drift, threshold crossing).

### 3) Enforce a Strict Dream Schema
Add required sections and validate before write:
1. `Summary` (2-4 sentences)
2. `Evidence` (source links/files)
3. `Delta` (what is new vs last similar dream)
4. `Next Actions` (1-3 concrete tasks)
5. `Confidence` (0-1)

Reject drafts missing required fields.

### 4) Add Similarity-Based Deduplication
Use a two-step dedup process:
1. Fast lexical filter (token overlap / minhash-like heuristic).
2. Embedding similarity threshold (e.g., cosine > 0.92 => duplicate).

If duplicate:
1. Suppress full write.
2. Update a compact "repeat counter" entry instead.

### 5) Strengthen Source Resolution
Normalize and verify `source_task`:
1. Resolve against known inbox roots (e.g., `GZMO/Inbox`, `GZMO/Inbox/samples`).
2. If unresolved, mark as `source_unresolved` and block publication.
3. Add fallback mapping table for renamed task files.

### 6) Add Scoring and Observability
Add a per-entry quality score (0-100):
1. Grounding score
2. Novelty score
3. Actionability score
4. Specificity score

Track daily aggregates:
1. Accepted vs rejected entries
2. Duplicate suppression count
3. Median quality score
4. Actionable entry rate

## Implementation Steps

### Phase 1: Non-Disruptive Instrumentation
1. Add quality scoring in "observe-only" mode.
2. Keep current behavior unchanged.
3. Log what would have been rejected.

Output: Baseline metrics without risk.

### Phase 2: Soft Enforcement
1. Enable dedup suppression for clear duplicates.
2. Enforce source resolution for new dreams.
3. Require at least one next action.

Output: Immediate reduction in low-value output.

### Phase 3: Full Gate Enforcement
1. Enable full quality gate (all checks blocking).
2. Route heartbeat-only entries to telemetry.
3. Keep only anomaly/significant heartbeat events in `Thought_Cabinet`.

Output: High signal-to-noise ratio in dream outputs.

## Suggested File/Module Touchpoints
1. Dream generation pipeline module (pre-write stage).
2. Thought write/persist module.
3. Source resolver utility.
4. Similarity/dedup utility.
5. Monitoring/metrics logger.

## Acceptance Criteria
1. At least 60% reduction in heartbeat-like repetitive entries in `Thought_Cabinet`.
2. At least 90% of dreams contain valid, resolvable sources.
3. At least 80% of dreams contain explicit next actions.
4. Median quality score >= 70 after stabilization.
5. No breakage in core daemon loop.

## Risk and Mitigation
1. Risk: Over-filtering useful edge cases.
Mitigation: Start with observe-only mode, then soft enforcement.

2. Risk: Source resolver false negatives due to file moves.
Mitigation: Add path normalization + alias mapping.

3. Risk: Increased pipeline latency from similarity checks.
Mitigation: Two-step dedup (fast lexical prefilter before embedding comparison).

## Rollout Strategy
1. Day 1-2: Instrumentation only, collect baseline.
2. Day 3-4: Enable soft gating.
3. Day 5+: Enable full gating if metrics improve and no regressions are found.

## What I Would Implement First
If we prioritize fast impact, I would implement in this exact order:
1. Source resolution enforcement.
2. Mandatory `Next Actions` section.
3. Duplicate suppression.
4. Heartbeat routing split.
5. Full quality score + dashboards.

This order gives the highest practical quality gain with the lowest integration risk.
