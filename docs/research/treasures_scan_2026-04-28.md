---
title: "Deep scan: reusable components on this machine"
date: 2026-04-28
type: research
tags: [evaluation, retrieval, contracts, hooks, rag, watchdog, stability]
---

## What we found (and why it matters)

### Stoneforge / Quarry search utils
- **Adaptive top-K (elbow detection)**: drop noisy tail deterministically after scoring.
- **FTS5 sanitization**: if/when we move lexical search into SQLite FTS, prevent query syntax issues.

Where found:
- `Dokumente/Playground/GZMO/Archive/GZMO_ur/AI Research/stoneforge/packages/quarry/src/services/search-utils.ts`

Status in `tinyFolder`:
- Adaptive top-K is ported as `gzmo-daemon/src/adaptive_topk.ts` and optionally enabled via env.

### oh-my-codex “prompt guidance contract tests”
Pattern: define “guidance surfaces” as files + required regex patterns, then enforce via unit tests.

Where found:
- `Dokumente/Playground/GZMO/Archive/GZMO_ur/AI Research/oh-my-codex/src/hooks/prompt-guidance-contract.ts`

Status in `tinyFolder`:
- Ported as `gzmo-daemon/src/guidance_contract.ts` + `src/__tests__/guidance_contract.test.ts`.

### DevStack_v2 edge-node watcher patterns (debounce + awaitWriteFinish)
Where found:
- `Dokumente/Playground/DevStack_v2/edge-node/gzmo-daemon/src/watcher.ts`

Status in `tinyFolder`:
- Current watcher already matches these settings (debounce + `awaitWriteFinish`, `ignoreInitial: false`, `depth: 0`).

### Local RAG architecture notes (LiteParse)
Where found:
- `Dokumente/Playground/DevStack_v2/Obsidian_Vault/wiki/research/2026-04-18_local-rag-liteparse-vault-search.md`

Key ideas to consider porting next:
- Two-stage parsing (fast spatial grid → selective vision fallback).
- Keep spatial tables in a single chunk.
- Delete-and-replace embeddings by content hash.

### OpenCompass judge/retrieval benches (scenario mine)
Where found:
- `Dokumente/Playground/GZMO/Archive/GZMO_ur/AI Research/opencompass/opencompass/...`

Use in `tinyFolder`:
- Treat as an *idea library* for new eval scenarios (pairwise/pointwise judging, retrieval benchmarks) without importing the whole stack.

### OpenClaw “heartbeat / gates / silent turns”
Where found:
- `~/.openclaw/scripts/*` and `~/.openclaw/workspace/*`

Use in `tinyFolder`:
- The gating/discipline patterns map well to long-running daemons: only alert on criticals, and write artifacts for the rest.

