# GZMO Performance Baseline

Last updated: 2026-05-09

See also: [README — Proof / smoke / eval commands](../README.md#proof--smoke--eval-commands).

## Methodology

Run the built-in benchmark harness (creates a temp vault; does not use your real `VAULT_PATH`):

```bash
cd gzmo-daemon
GZMO_BENCHMARK_RUNS=5 bun run benchmark
```

## What to watch

- **Single-shot vs ToT**: `GZMO_ENABLE_TOT=on` should generally stay within ~2–3× median latency for similar queries on the same machine.
- **ToT+tools**: expect higher variance; keep tool calls capped (`GZMO_MAX_TOOL_CALLS`).

## Tuning levers

- Reduce ToT expansion:
  - `GZMO_TOT_MAX_NODES` (default ~15)
  - `GZMO_TOT_MIN_SCORE` (pruning threshold)
  - `GZMO_TOT_BEAM=off` (disable beam waves)
- Reduce tool load:
  - `GZMO_ENABLE_TOOLS=off`
  - `GZMO_MAX_TOOL_CALLS=1`

