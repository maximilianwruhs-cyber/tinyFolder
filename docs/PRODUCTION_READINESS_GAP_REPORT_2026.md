# GZMO Production-Readiness Gap Report (2026)

**Date:** 2026-05-06  
**Target deployment:** single-user Ubuntu workstation (systemd `--user`) + local Ollama  
**Scope:** operational readiness (security, reliability, observability, performance, data management)  

This complements (does not replace) the repo’s component-level traffic-light snapshot in [`docs/PRODUCTION_READINESS_2026-05-06.md`](./PRODUCTION_READINESS_2026-05-06.md) by focusing on **production operations gaps** (what fails at 2am, what fills disks, what hangs, what cannot be debugged).

---

## Executive summary

### What’s already “production-grade”
- **Deterministic ops artifacts** are first-class and code-defined via [`gzmo-daemon/src/outputs_registry.ts`](../gzmo-daemon/src/outputs_registry.ts) (health/telemetry/perf/eval/doctor registries, plus generated indexes).
- **Health + telemetry snapshots** are written every 60s via [`gzmo-daemon/src/health.ts`](../gzmo-daemon/src/health.ts) and scheduled from [`gzmo-daemon/index.ts`](../gzmo-daemon/index.ts).
- **Core safety boundaries** exist for vault writes and tool reads:
  - Vault-contained writes + raw/ immutability via [`gzmo-daemon/src/vault_fs.ts`](../gzmo-daemon/src/vault_fs.ts)
  - Fail-closed “don’t invent paths/side-effects” verifier via [`gzmo-daemon/src/verifier_safety.ts`](../gzmo-daemon/src/verifier_safety.ts) and search pipeline shaping in [`gzmo-daemon/src/pipelines/search_pipeline.ts`](../gzmo-daemon/src/pipelines/search_pipeline.ts)
- **Boot ordering / dependency readiness** is present:
  - systemd user unit runs `ExecStartPre` wait for Ollama ([`gzmo-daemon/gzmo-daemon.service.template`](../gzmo-daemon/gzmo-daemon.service.template) + [`scripts/wait-for-ollama.sh`](../scripts/wait-for-ollama.sh))
  - daemon also has an internal readiness gate in [`gzmo-daemon/index.ts`](../gzmo-daemon/index.ts)

### What blocks “production confidence” (ops gaps)
These are the high-impact items most likely to cause **hangs, overload, silent corruption, or un-debuggable failures** in real use:
- **P0:** No global **task concurrency/backpressure** limit (multiple inbox tasks can overlap).
- **P0:** Inference / query-embedding calls have **incomplete timeout & cancellation coverage** (some fetches have timeouts, others don’t).
- **P0:** Several persistence paths are intentionally **best-effort** (errors swallowed), which can cause **silent loss of perf/trace/ledger evidence** and make incidents hard to debug.
- **P0:** No documented **data retention / rotation** policy for high-growth artifacts (traces, embeddings, live stream, jsonl logs).
- **P1:** systemd unit is functional but lacks **hardening/limits** commonly expected in 2026 (least-privilege sandboxing directives for user services).
- **P1:** No “operator alerting” loop (even local): health exists, but there’s no defined freshness thresholds / watchdog behavior / notification.

---

## P0 (must-fix to call it “production-ready”)

### P0.1 Add backpressure: cap task concurrency and queue ingress
**Current state**
- Inbox handler increments `activeTaskCount` and `await processTask(...)`, but does not enforce a semaphore; overlapping events can run concurrently ([`gzmo-daemon/index.ts`](../gzmo-daemon/index.ts), watcher `on("task")` handler).

**Risk**
- Overload: multiple tasks can simultaneously call Ollama, perform retrieval, write artifacts, and compete for memory/CPU/IO.
- If the vault receives many task files at once, you can see a cascade of timeouts, partial artifact writes, and OOM.

**Action**
- Implement a **single-flight / bounded worker queue** for tasks (start with `MAX_CONCURRENT_TASKS=1` default).
- Surface queue depth in `GZMO/TELEMETRY.json` (or at least in `GZMO/health.md`).

**Validation**
- Drop 20 pending tasks at once; verify:
  - tasks are processed sequentially (or with configured parallelism)
  - the daemon remains responsive and does not spike into repeated failure.

---

### P0.2 Ensure timeouts/cancellation are consistent for all Ollama calls
**Current state**
- Some probes are time-bounded (e.g. internal Ollama readiness uses `AbortSignal.timeout(3000)` in [`gzmo-daemon/index.ts`](../gzmo-daemon/index.ts); systemd prestart uses `curl --connect-timeout 2` in [`scripts/wait-for-ollama.sh`](../scripts/wait-for-ollama.sh)).
- Other fetch paths do **not** set a timeout (e.g. query embedding in [`gzmo-daemon/src/search.ts`](../gzmo-daemon/src/search.ts) uses plain `fetch` without an AbortSignal).

**Risk**
- A stalled Ollama request can hang a task indefinitely, leaving the inbox item stuck in `processing` and accumulating backlog.

**Action**
- Standardize an `OLLAMA_HTTP_TIMEOUT_MS` (or per-call defaults) and apply it to:
  - query embeddings (`/api/embeddings`)
  - inference streaming
  - rerank calls (already has a timeout param in reranker call sites, but enforce consistently)
- Plumb the global abort controller (`daemonAbort` in [`gzmo-daemon/index.ts`](../gzmo-daemon/index.ts)) into all Ollama calls so `SIGTERM` cancels inflight work.

**Validation**
- Simulate Ollama stalls (stop Ollama mid-task) and confirm tasks fail closed within a known bound (e.g. < 60s), rather than hanging.

---

### P0.3 Make “best-effort persistence” observable (don’t silently lose incident evidence)
**Current state**
- Many writes are intentionally non-fatal (e.g. traces/perf/ledger writes are often `.catch(() => {})` in the task engine, and health writes are also guarded) across [`gzmo-daemon/src/engine.ts`](../gzmo-daemon/src/engine.ts) and [`gzmo-daemon/index.ts`](../gzmo-daemon/index.ts).

**Risk**
- You can lose the very artifacts required to debug a failure (perf spans, traces, ledger entries) without any operator-visible signal.

**Action**
- For each artifact class, define “must not lose silently” rules:
  - **P0:** if `document.markCompleted()` succeeded but trace/perf persistence failed, emit a **high-signal log line** and add an `operatorHint` in `GZMO/TELEMETRY.json`.
  - Optionally: write a small append-only `GZMO/errors.jsonl` for artifact write failures.

**Validation**
- Force write failures (e.g. make `GZMO/` read-only) and confirm the daemon clearly reports which artifacts were not persisted.

---

### P0.4 Define retention/rotation for high-growth artifacts
**Current state**
- The daemon writes/maintains several potentially large or unbounded artifacts (registry in [`gzmo-daemon/src/outputs_registry.ts`](../gzmo-daemon/src/outputs_registry.ts)), notably:
  - `GZMO/Reasoning_Traces/` (many JSON files + index)
  - `GZMO/embeddings.json` (can become large with vault growth)
  - `GZMO/Live_Stream.md` (trimmed to ~200 lines in [`gzmo-daemon/src/stream.ts`](../gzmo-daemon/src/stream.ts), which is good)
  - `GZMO/perf.jsonl`, `GZMO/strategy_ledger.jsonl`, KG snapshots/audit logs (when enabled)

**Risk**
- Disk fills → task failures, partial writes, degraded retrieval due to failed embeddings persistence.

**Action**
- Add a **documented retention policy** (even if implemented manually at first):
  - traces: keep last N days or last N tasks; archive older
  - jsonl logs: rotate monthly or cap size
  - embeddings store: define rebuild procedure and whether it’s backed up
- Add doctor checks for “disk pressure” and “artifact growth outliers” (doctor already exists under `gzmo-daemon/src/doctor/*`).

**Validation**
- Run the daemon over a week with active usage and confirm disk usage stays bounded under the policy.

---

## P1 (hardening for fewer surprises)

### P1.1 Harden the systemd user unit
**Current state**
- Current unit template is minimal and functional: `Restart=on-failure`, journald logs, `ExecStartPre` wait, `.env` environment file ([`gzmo-daemon/gzmo-daemon.service.template`](../gzmo-daemon/gzmo-daemon.service.template)).

**Risk**
- A compromised process has broad access to the user’s files and network.

**Action**
- Add user-service compatible hardening directives (adapt to your vault location):
  - `NoNewPrivileges=yes`
  - `PrivateTmp=yes`
  - `ProtectSystem=full` (or `strict` if you can)
  - `ProtectHome=read-only` (only if vault is outside `$HOME`, otherwise you’ll need exceptions)
  - `ReadWritePaths=/abs/vault/path` (allowlist)
  - Consider `IPAddressDeny=any` + `IPAddressAllow=127.0.0.1` if you only need localhost Ollama.
- Add restart burst control:
  - `StartLimitIntervalSec=` / `StartLimitBurst=`

**Validation**
- Reboot test: ensure service starts reliably (Ollama first, then daemon).
- Regression test: golden task still passes.

---

### P1.2 Make “healthy” measurable (freshness thresholds)
**Current state**
- Health and telemetry exist (`GZMO/health.md`, `GZMO/TELEMETRY.json`) and are written periodically ([`gzmo-daemon/src/health.ts`](../gzmo-daemon/src/health.ts), scheduled in [`gzmo-daemon/index.ts`](../gzmo-daemon/index.ts)).

**Gap**
- No defined freshness thresholds (e.g. “TELEMETRY updated within 90s”) and no operator notifications.

**Action**
- Define a “local SLO” checklist:
  - Telemetry freshness
  - Inbox backlog max
  - Task failure rate (e.g. last 20 tasks)
  - Ollama connectivity
- Optionally add a `bun run health` CLI that checks these and returns non-zero for scripts/cron.

---

## P2 (nice-to-have / longer-term)

### P2.1 Multi-model routing and extra autonomy subsystems
Follow the staged enablement + rollback guidance in [`docs/NON_GREEN_IMPLEMENTATION_GUIDE.md`](./NON_GREEN_IMPLEMENTATION_GUIDE.md). Treat these as feature flags with explicit performance baselines and disk-growth expectations.

---

## Performance & capacity baseline (how to run it in production ops)

### What to measure
Use the harness in [`gzmo-daemon/src/perf_benchmark.ts`](../gzmo-daemon/src/perf_benchmark.ts) plus live `GZMO/perf.jsonl`:
- **Median and p95 latency** per scenario:
  - `simple_think`
  - `simple_search_single`
  - `simple_search_tot`
  - `simple_search_tot_tools`
- **Slowdown ratio**: ToT median vs single-shot median (thresholds in [`docs/PERFORMANCE_BASELINE.md`](./PERFORMANCE_BASELINE.md))
- **Disk growth** per day:
  - traces
  - embeddings store
  - jsonl logs

### Recommended cadence
- **On release**: run benchmark 3–5 runs per scenario.
- **Weekly (cron/systemd timer)**: run benchmark with 1–3 runs, alert on regression thresholds.

---

## Ship checklist (minimal)

### Must pass
- [ ] Golden minimal task passes (README “Golden minimal task”).  
- [ ] `bun run smoke` passes.  
- [ ] `bun run eval:quality` passes.  
- [ ] systemd service starts on reboot (Ollama up + `ExecStartPre` wait succeeds).  
- [ ] Task concurrency is bounded (P0.1).  
- [ ] All Ollama calls are time-bounded and cancel on SIGTERM (P0.2).  
- [ ] Retention/rotation policy exists and is followed (P0.4).  

### Should pass (recommended)
- [ ] systemd unit hardening applied (P1.1).  
- [ ] Health freshness check exists (P1.2).  

