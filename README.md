## tinyFolder

GZMO daemon (**Bun** + **Ollama**): vault Markdown inbox tasks (`think` / `search` / `chain`). Checklist and contract: [`AGENTS.md`](AGENTS.md).

---

## Table of contents

- [First 5 minutes (copy/paste checklist)](#first-5-minutes-copypaste-checklist)
- [Which installer? (human vs agent)](#which-installer-human-vs-agent)
- [Fresh machine agentic bootstrap](#fresh-machine-agentic-bootstrap-recommended)
- [Doctor (agentic readiness)](#doctor-agentic-readiness)
- [Mental model](#mental-model)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Create a vault scaffold](#create-a-vault-scaffold)
- [Configure (environment variables)](#configure-environment-variables)
- [Run (foreground)](#run-foreground)
- [Run (systemd user service)](#run-systemd-user-service)
- [Submit tasks (Inbox contract)](#submit-tasks-inbox-contract)
- [Operational outputs (what the daemon writes)](#operational-outputs-what-the-daemon-writes)
- [Profiles / safe modes](#profiles--safe-modes)
- [Proof / smoke / eval commands](#proof--smoke--eval-commands)
- [Backup & restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [Fine-tuning (advanced)](#fine-tuning-advanced)
- [Repo contents (what is public)](#repo-contents-what-is-public)
- [Additional documentation](#additional-documentation)
- [Pi skill (optional)](#pi-skill-optional)
- [License](#license)

---

## First 5 minutes (copy/paste checklist)

Goal: get from zero to a verified end-to-end loop (**Inbox → claim → append output**) with the smallest possible surface area.

1) Start Ollama:

```bash
OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KEEP_ALIVE=-1 ollama serve
```

2) Install deps:

```bash
cd gzmo-daemon
bun install
```

3) Run the setup wizard (auto-detects hardware, picks model, writes `.env`):

```bash
./scripts/onboard.sh --auto
# Or interactive: ./scripts/onboard.sh
```

The wizard supports everything from CPU-only laptops up to the **NVIDIA DGX Spark** (128GB unified memory). On a DGX Spark it will auto-select a 70B–72B-class model (e.g. `qwen2.5:72b` or `llama3.3:70b`).

Or get **stack + wizard** in one command (Bun/Ollama/models, then onboard): `./scripts/setup.sh human` — see [Which installer?](#which-installer-human-vs-agent).

Or configure manually:

```bash
cat > gzmo-daemon/.env <<'EOF'
VAULT_PATH="/absolute/path/to/your/vault"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="hermes3:8b"
EOF
```

4) Create the minimum vault scaffold (skip dirs already created by **`./scripts/setup.sh human`**, **`./scripts/install-local-stack.sh`**, or **`./scripts/onboard.sh`** / the wizard):

```bash
V="/absolute/path/to/your/vault"
mkdir -p "$V/GZMO/Inbox" "$V/GZMO/Subtasks" "$V/GZMO/Thought_Cabinet" \
         "$V/GZMO/Quarantine" "$V/GZMO/Reasoning_Traces" "$V/wiki"
```

5) Run the daemon (foreground):

```bash
cd gzmo-daemon
bun run summon
```

6) Drop the golden minimal task:

- Follow the section: [Golden minimal task (end-to-end verification)](#golden-minimal-task-end-to-end-verification)

Expected success signal:

- the daemon changes `status: pending → processing → completed`
- and appends an answer block to the same file

---

## Which installer? (human vs agent)

The repo ships **small scripts** plus one **thin router** — nothing is merged into a giant installer; the router only delegates.

| You are… | Preferred path | What it runs |
|----------|----------------|--------------|
| **Human on a new machine** (GUI / full stack) | `./scripts/setup.sh human` | [`install-local-stack.sh`](scripts/install-local-stack.sh) (Bun/Ollama/models, `.env`, Pi extension symlink, systemd best-effort), then [`onboard.sh`](scripts/onboard.sh) (hardware-aware wizard; **interactive** in a terminal, **`--auto`** if stdin is not a TTY). |
| **Agent / automation / “just give me a vault”** | `./scripts/setup.sh agent --vault /abs/path` | [`agentic-setup.sh`](scripts/agentic-setup.sh) — minimal `.env`, scaffold, `bun install`; optional `--force-env`, `--with-systemd`, `--with-pi`. |
| **Health pass** | `./scripts/setup.sh doctor` | [`doctor-agentic.sh`](scripts/doctor-agentic.sh) (same flags as calling it directly). |

Useful variants:

```bash
# Same as human, but skip the wizard (run ./scripts/onboard.sh yourself later)
./scripts/setup.sh human --no-wizard

# Force non-interactive wizard even in a terminal
./scripts/setup.sh human --auto-wizard

# Agent flow with systemd unit generation (still need daemon-reload/enable; script prints hints)
./scripts/setup.sh agent --vault /abs/path/to/vault --force-env --with-systemd
```

Low-level scripts are unchanged; you can still invoke `install-local-stack.sh`, `onboard.sh`, and `agentic-setup.sh` directly.

---

## Fresh machine agentic bootstrap (recommended)

If you want this to be **repeatable** on a brand-new Ubuntu box (or a wiped dev VM), use the idempotent bootstrap script (or the router: `./scripts/setup.sh agent …` — see [Which installer?](#which-installer-human-vs-agent)).

Prereqs you still must install yourself:

- **Bun**
- **Ollama** (+ pull `hermes3:8b` and `nomic-embed-text` if you use embeddings)

Bootstrap (vault scaffold + `.env` + bun deps):

```bash
VAULT="/absolute/path/to/your/vault"
./scripts/setup.sh agent --vault "$VAULT" --force-env
# equivalent: ./scripts/agentic-setup.sh --vault "$VAULT" --force-env
```

Optional: also generate the **systemd user unit**:

```bash
./scripts/setup.sh agent --vault "$VAULT" --with-systemd
systemctl --user daemon-reload
systemctl --user enable --now gzmo-daemon
```

Optional: also install the **Pi shell skill pack** into `~/.pi/skills/gzmo-daemon` (for `submit_task.sh` / `watch_task.sh` outside the extension). Pi **inside the repo** can use [`.pi/extensions/gzmo-tinyfolder.ts`](.pi/extensions/gzmo-tinyfolder.ts) instead; it registers the bundled skill under `.pi/extensions/skills/gzmo-daemon/` via `resources_discover` (no copy required for that path).

```bash
./scripts/setup.sh agent --vault "$VAULT" --with-pi
export GZMO_ENV_FILE="$(pwd)/gzmo-daemon/.env"
```

---

## Doctor (agentic readiness)

For a single “OK / fix-this” report (and safe auto-fixes like creating missing vault directories), run:

```bash
export GZMO_ENV_FILE="$(pwd)/gzmo-daemon/.env"   # recommended
./scripts/doctor-agentic.sh
```

Deep profile (slower, more checks than the default fast pass):

```bash
./scripts/doctor-agentic.sh --deep
```

Notes:

- This wrapper runs quick host checks (Ollama reachability, vault dirs — it may **create** missing inbox scaffold folders), then delegates to the daemon (`cd gzmo-daemon && bun run doctor …`). By default it uses `--profile fast`; `--deep` switches to `--profile deep`.
- `--write`, `--heal`, and `--no-bun-doctor` are passed through where applicable.
- `--write` is supported but **not recommended** unless you intentionally want vault-writing checks.
- `bun run doctor` writes reports to:
  - `"$VAULT_PATH/GZMO/doctor-report.md"` and `"$VAULT_PATH/GZMO/doctor-report.json"` (when vault-writing checks run)
  - `./gzmo/doctor-report.md` and `./gzmo/doctor-report.json` in the repo (gitignored)

---

## Mental model

### Core contract (deterministic)

- **Input**: Markdown task files in `VAULT_PATH/GZMO/Inbox/*.md`
- **Routing**: YAML frontmatter key `action` chooses behavior
- **Lifecycle**: `status: pending → processing → completed | failed`
- **Output**: results are appended to the **same file** (and additional artifacts are written under `VAULT_PATH/GZMO/`)

### Evidence-first search contract

For `action: search`, the daemon compiles an **Evidence Packet** (local facts + retrieved snippets) and the answer must include citations like `[E1]`, `[E2]`, etc. If the evidence is insufficient, it should say so instead of inventing facts.

---

## Prerequisites

### Platform

This project is maintained for **Ubuntu Linux** (and similar distros with **systemd user session** support). Shell installers and the daemon service unit assume POSIX paths and LF line endings; Windows and macOS are not supported targets here.

### Required

- **Bun** (runtime)
- **Ollama** (local LLM server)

### Recommended models

The default is **`hermes3:8b`** — excellent tool-use and reasoning for its size.

On high-end hardware the setup wizard will suggest bigger models:

| Hardware | Suggested model | VRAM / RAM needed |
|---|---|---|
| CPU-only laptop | `phi3:mini` or `qwen2.5:0.5b` | 4–6 GB RAM |
| 4–8 GB VRAM GPU | `hermes3:8b` or `qwen2.5:7b` | 4–8 GB VRAM |
| 16–24 GB VRAM GPU | `qwq:32b` or `deepseek-r1:14b` | 16–24 GB VRAM |
| 48–80 GB VRAM GPU | `llama3.1:70b` or `deepseek-r1:32b` | 48–64 GB VRAM |
| **NVIDIA DGX Spark** (128 GB unified) | `qwen2.5:72b` or `llama3.3:70b` | ~48–64 GB |

Pull the default set:

```bash
ollama pull hermes3:8b
ollama pull nomic-embed-text
```

Start Ollama (foreground):

```bash
OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KEEP_ALIVE=-1 ollama serve
```

---

## Install

```bash
cd gzmo-daemon
bun install
```

---

## Create a vault scaffold

This repo does **not** ship your vault content. You provide a vault directory and point `VAULT_PATH` to it.

Minimum required directories:

- `GZMO/Inbox/` (task inbox)
- `GZMO/Subtasks/` (chain sub-tasks)
- `GZMO/Thought_Cabinet/` (dream/self-ask/etc artifacts)
- `GZMO/Quarantine/` (optional, but used by some flows)

Create them:

```bash
mkdir -p "/absolute/path/to/your/vault/GZMO/Inbox"
mkdir -p "/absolute/path/to/your/vault/GZMO/Subtasks"
mkdir -p "/absolute/path/to/your/vault/GZMO/Thought_Cabinet"
mkdir -p "/absolute/path/to/your/vault/GZMO/Quarantine"
mkdir -p "/absolute/path/to/your/vault/GZMO/Reasoning_Traces"
mkdir -p "/absolute/path/to/your/vault/wiki"
```

Note: the daemon also creates some directories on boot if missing, but **do not rely on that** when automating setup—create the scaffold explicitly. `GZMO/Reasoning_Traces/` is optional (used when `GZMO_ENABLE_TRACES` is on).

---

## Configure (environment variables)

The daemon reads environment variables. For local usage, the simplest is a file:

- `gzmo-daemon/.env` (used by the systemd template and by your shell if you export it)

### Required configuration

- **`VAULT_PATH`**: absolute path to your vault directory.

Example `gzmo-daemon/.env`:

```bash
VAULT_PATH="/absolute/path/to/your/vault"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="hermes3:8b"
```

### Clean boot (systemd helper env)

The installed user unit runs `scripts/wait-for-ollama.sh` before the daemon so Ollama is usually up before Bun starts (avoids “gave up after retries” when Ollama is slow).

- **`GZMO_SYSTEMD_WAIT_FOR_OLLAMA`**: set to `0` / `false` / `off` to **skip** that wait (useful if you never run Ollama on this machine).
- **`GZMO_OLLAMA_WAIT_MAX_SEC`**: max wait in seconds (default: `180`).

### Core runtime knobs

- **`OLLAMA_URL`**: base URL for Ollama (default: `http://localhost:11434`)
- **`OLLAMA_MODEL`**: model tag for inference (default: `hermes3:8b`)
- **`GZMO_PROFILE`**: runtime profile / safe mode selector (see [Profiles / safe modes](#profiles--safe-modes))

### Retrieval quality knobs (defaults are set at runtime if unset)

The daemon sets these defaults at boot (and you can override them):

- **`GZMO_MULTIQUERY`**: `on|off` — query rewrites for recall (default: `on`)
- **`GZMO_RERANK_LLM`**: `on|off` — rerank retrieved chunks (default: `on`)
- **`GZMO_ANCHOR_PRIOR`**: `on|off` — boosts canonical “anchor” chunks (default: `on`)
- **`GZMO_MIN_RETRIEVAL_SCORE`**: float string — fail-closed retrieval threshold (default: `0.32`)

### Safety / verification knobs

- **`GZMO_ENABLE_SELF_EVAL`**: `true|false|1|0` — verifier rewrite pass for `action: search` (default: on)
- **`GZMO_VERIFY_SAFETY`**: `true|false|1|0` — blocks invented paths/side-effects (default: on)

### Autonomy / backpressure knobs

- **`GZMO_AUTONOMY_COOLDOWN_MS`**: milliseconds — minimum quiet time after a task completes before autonomy loops may run (default: `20000`)
- **`GZMO_IDLE_CONNECT_MODE`**: `on|off` — run bounded self-ask cycles while Inbox has no pending tasks (default: off)

### Feature toggles (coarse on/off)

Most subsystems can be disabled (all accept `true/false/1/0`):

- `GZMO_ENABLE_INBOX_WATCHER`
- `GZMO_ENABLE_TASK_PROCESSING`
- `GZMO_ENABLE_EMBEDDINGS_SYNC` (initial sync on boot)
- `GZMO_ENABLE_EMBEDDINGS_LIVE` (watcher to live-sync embeddings)
- `GZMO_ENABLE_DREAMS`
- `GZMO_ENABLE_SELF_ASK`
- `GZMO_ENABLE_WIKI`
- `GZMO_ENABLE_INGEST`
- `GZMO_ENABLE_WIKI_LINT`
- `GZMO_ENABLE_PRUNING`
- `GZMO_ENABLE_DASHBOARD_PULSE`

### HTTP API (optional)

The daemon exposes a thin REST + SSE layer when enabled. Tasks submitted via HTTP land in the same `GZMO/Inbox/` directory the file watcher reads, so behavior is identical to dropping a `.md` file directly.

- **`GZMO_API_ENABLED`**: `on|off` — start the HTTP server alongside the watcher (default: `off`)
- **`GZMO_API_HOST`**: hostname to bind (default: `127.0.0.1`)
- **`GZMO_API_PORT`**: TCP port (default: `12700`)
- **`GZMO_API_SOCKET`**: path to a Unix domain socket — when set, overrides host/port
- **`GZMO_LOCAL_ONLY`**: `on|off` — when `on`, refuse to start unless the bind address is loopback, and lock CORS to loopback origins via strict URL parsing (default: `off`)
- **`GZMO_API_TOKEN`**: shared secret — when set, every route except `/health` requires `Authorization: Bearer <token>`. **Required** when binding to a non-loopback address with `GZMO_LOCAL_ONLY=0`.
- **`GZMO_API_MAX_BODY_BYTES`**: hard cap on request body bytes (default: `1048576` = 1 MiB)
- **`GZMO_API_MAX_TASK_CHARS`**: cap on `body` field length for `POST /api/v1/task` (default: `100000`)
- **`GZMO_API_MAX_QUERY_CHARS`**: cap on `query` field length for `POST /api/v1/search` (default: `10000`)
- **`GZMO_VRAM_PROBE`**: `auto|off|nvidia-smi` — VRAM telemetry source (default: `auto`). In `auto`, the daemon uses `nvidia-smi` when available, otherwise it disables the live probe.
- **`GZMO_VRAM_PROBE_INTERVAL_MS`**: integer — polling interval for the live VRAM probe (default: `10000`)
- **`GZMO_VRAM_USED_MB`**, **`GZMO_VRAM_TOTAL_MB`**: optional VRAM telemetry **fallback** surfaced on `/api/v1/health` and the Pi `/gzmo` dashboard. The live probe (when enabled + available) takes precedence.

### Operational hardening (optional)

Production knobs added to keep the daemon recoverable and bounded under unexpected load:

- **`GZMO_TASK_CONCURRENCY`**: integer 1..8 — max inbox tasks running in parallel (default: `1` — single-user GPUs almost always want one model at a time)
- **`GZMO_RECOVERY_GRACE_MS`**: milliseconds — boot recovery skips `processing` tasks newer than this (default: `30000`); guards against race with a still-live instance
- **`GZMO_RECOVERY_FAIL_ON_RESTART`**: `on|off` — boot recovery marks stale tasks `failed` instead of resetting to `pending` (default: `off`)
- **`GZMO_INFER_REASON_TIMEOUT_MS`**: hard upper bound for `reason`-role LLM calls (default: `120000`)
- **`GZMO_INFER_FAST_TIMEOUT_MS`**: hard upper bound for `fast`/`judge`/`rerank`/query-rewrite LLM calls (default: `30000`)
- **`GZMO_EMBED_TIMEOUT_MS`**: hard upper bound on embedding HTTP calls (default: `30000`)
- **`GZMO_SHUTDOWN_DRAIN_MS`**: max ms to wait for in-flight tasks + embedding queue on `SIGINT`/`SIGTERM` before forcing exit (default: `10000`)
- **`GZMO_LOG_ROTATE_MB`**: rotate `safeAppendJsonl` files (`perf.jsonl`, `Reasoning_Traces/index.jsonl`, etc.) when they exceed N MB; `0` disables (default: `50`)
- **`GZMO_LOG_KEEP`**: number of rotated generations to retain (default: `3`, capped at `20`)
- **`GZMO_TRACE_RETAIN_DAYS`**: prune `Reasoning_Traces/*.json` older than N days at boot; unset/`0` disables (default: disabled — traces are valuable for debugging)

### Reasoning engine (optional)

Structured traces, filesystem tools, Tree-of-Thought search, and cross-task claims are **off by default** except traces.

- **`GZMO_ENABLE_TRACES`**: `on|off` — write JSON traces under `GZMO/Reasoning_Traces/` (default: `on`)
- **`GZMO_ENABLE_TOOLS`**: `on|off` — when retrieval returns nothing, run deterministic `fs_grep` (and registry tools for ToT) (default: `off`)
- **`GZMO_MAX_TOOL_CALLS`**: integer — cap tool invocations per task (default: `3`)
- **`GZMO_ENABLE_TOT`**: `on|off` — `action:search` uses multi-step ToT plus shadow-judge scoring (requires embeddings store; default: `off`)
- **`GZMO_TOT_BEAM`**: `on|off` — expand retrieval branches in priority waves (beam) instead of one sorted pass; optional (default: `off`)
- **`GZMO_TOT_MAX_NODES`**, **`GZMO_TOT_MIN_SCORE`**: ToT budget / pruning (defaults: `15`, `0.5`)
- **`GZMO_ENABLE_BELIEFS`**: `on|off` — append claims to `GZMO/Reasoning_Traces/claims.jsonl` (default: `off`)
- **`GZMO_ENABLE_LEARNING`**: `on|off` — append task outcomes to `GZMO/strategy_ledger.jsonl` and inject strategy tips into prompts when enough history exists (default: `off`)
- **`GZMO_LEARNING_BACKFILL`**: `on|off` — on daemon boot (after embeddings init), append ledger rows from existing `GZMO/perf.jsonl` (default: `off`)
- **`GZMO_LEARNING_AB_TEST`**: `on|off` — when on, randomly skips strategy injection for ~30% of ToT decompositions (control group) (default: `off`)
- **`GZMO_ENABLE_TRACE_MEMORY`**: `on|off` — embed past traces into the store at boot and retrieve similar traces before ToT decomposition (default: `off`)
- **`GZMO_ENABLE_GATES`**: `on|off` — analyze / retrieve / reason gates in the ToT pipeline (default: `off`)
- **`GZMO_ENABLE_CRITIQUE`**: `on|off` — on total ToT failure, run a critique pass and optionally one replan wave (default: `off`)
- **`GZMO_ENABLE_MODEL_ROUTING`**: `on|off` — route ToT LLM calls by role (`fast` / `reason` / `judge`) (default: `off`)
- **`GZMO_FAST_MODEL`**, **`GZMO_REASON_MODEL`**, **`GZMO_JUDGE_MODEL`**, **`GZMO_RERANK_MODEL`**: Ollama model tags when routing is on (each falls back to `OLLAMA_MODEL` when unset)
- **`GZMO_EMBED_MODEL`**: embedding model tag (default: `nomic-embed-text`)
- **`GZMO_ENABLE_TOOL_CHAINING`**: `on|off` — allow follow-up `vault_read` / `dir_list` calls inferred from prior tool output, still capped by `GZMO_MAX_TOOL_CALLS` (default: `off`)
- **`GZMO_ENABLE_KNOWLEDGE_GRAPH`**: `on|off` — update the on-vault Knowledge Graph on task completion (default: `off`)
- **`GZMO_KG_SEARCH_AUGMENT`**: `on|off` — augment vault retrieval using Knowledge Graph-connected sources (default: `off`)

View a trace (from `gzmo-daemon/` with `VAULT_PATH` set): `bun run trace:view -- <trace_id_or_task_file>` — add `--thinking` to print stored model thinking snippets.

Ledger report: `bun run ledger:analyze` — sync traces into embeddings without full daemon boot: `bun run trace:sync`.

Benchmark harness: see [Proof / smoke / eval commands](#proof--smoke--eval-commands) (`bun run benchmark`, optional `GZMO_BENCHMARK_RUNS`).

---

## Run (foreground)

In one terminal, start Ollama (see [Prerequisites](#prerequisites)).

In another terminal, run:

```bash
cd gzmo-daemon
bun run summon
```

---

## Run (systemd user service)

This repo includes an **Ubuntu-oriented** systemd **user** service template (POSIX paths, LF scripts, `systemctl --user`):
- Template: `gzmo-daemon/gzmo-daemon.service.template`
- Installer: `./install_service.sh` (writes the concrete unit file under your user config)
- **Boot ordering**: the unit waits for `network-online.target`, then runs `scripts/wait-for-ollama.sh` (see `GZMO_SYSTEMD_WAIT_FOR_OLLAMA` in `.env`) before `bun run index.ts`.

**Recommended machine boot**: enable Ollama as a system service, then the daemon as a user service:

```bash
sudo systemctl enable --now ollama
./install_service.sh
systemctl --user daemon-reload
systemctl --user enable --now gzmo-daemon
```

**One-shot manual start** (starts `ollama.service` if present, waits for the API, then starts or restarts `gzmo-daemon`):

```bash
./scripts/boot-stack.sh
```

Install + start (daemon only — same as before if Ollama is already running):

```bash
./install_service.sh
systemctl --user daemon-reload
systemctl --user enable --now gzmo-daemon
```

Tail logs:

```bash
journalctl --user -u gzmo-daemon -f
```

Restart:

```bash
systemctl --user restart gzmo-daemon
```

---

## Submit tasks (Inbox contract)

### Golden minimal task (end-to-end verification)

This is the smallest task that verifies the entire pipeline:
- filesystem watcher sees the file
- the daemon claims it
- LLM inference runs
- the daemon appends output and marks completion

Create `"$VAULT_PATH/GZMO/Inbox/000_golden_minimal_task.md"` with:

```yaml
---
status: pending
action: think
---
Reply with exactly this single line and nothing else:
OK: inbox → claim → append → done
```

What “pass” looks like (deterministic checks):
- The daemon updates the file frontmatter to `status: completed` (or `failed` if something broke).
- The daemon appends output containing the exact string:
  - `OK: inbox → claim → append → done`

If it fails:
- If status becomes `failed`, inspect daemon logs (foreground terminal or `journalctl --user -u gzmo-daemon -f`).
- If the file stays `pending`, the watcher is not seeing the inbox (almost always `VAULT_PATH` wrong, or permissions).

### Task file format

Create a file under:

- `"$VAULT_PATH/GZMO/Inbox/<anything>.md"`

It must include YAML frontmatter. Minimum required keys:

- `status: pending`
- `action: think|search|chain`

Example (`think`):

```yaml
---
status: pending
action: think
---
Explain the Lorenz attractor in one paragraph.
```

### `action: search` (evidence-first)

Example:

```yaml
---
status: pending
action: search
---
Based on the vault content, what are the daemon’s operational outputs?
```

Expected behavior:
- gathers deterministic local facts where applicable
- retrieves relevant vault snippets
- compiles an Evidence Packet
- answers with citations `[E#]` or states **insufficient evidence**

### `action: chain` (multi-step)

Example:

```yaml
---
status: pending
action: chain
chain_next: step2.md
---
List exactly 3 components of the chaos engine.
```

Notes:
- `chain_next` points to a filename in `GZMO/Subtasks/`
- chain execution is intentionally bounded; each step should be small and verifiable

---

## Operational outputs (what the daemon writes)

All operational artifacts live under:

- `"$VAULT_PATH/GZMO/"`

High-signal files (examples; depends on enabled subsystems):

- `GZMO/health.md` — human-readable health snapshot
- `GZMO/TELEMETRY.json` — structured ops telemetry snapshot
- `GZMO/OPS_OUTPUTS.json` — machine-readable outputs registry generated from code
- `GZMO/Live_Stream.md` — human-readable event stream / heartbeat
- `GZMO/embeddings.json` — embeddings store (local-only; large)
- `GZMO/rag-quality.md` + `GZMO/retrieval-metrics.json` — eval harness outputs
- `GZMO/anchor-index.json` + `GZMO/anchor-report.md` — anchor artifacts
- `GZMO/self-ask-quality.md` — self-ask quality report
- `GZMO/Reasoning_Traces/` — per-task reasoning traces (`*.json`), optional `index.jsonl` and `claims.jsonl`

Important operational invariant:
- **Vault `docs/**` is excluded from default retrieval** unless explicitly referenced (keeps “human docs” from polluting RAG by default).

---

## Profiles / safe modes

Use `GZMO_PROFILE` to enable subsets of functionality for debugging or weak hardware.

Example:

```bash
cd gzmo-daemon
GZMO_PROFILE=minimal bun run summon
```

(Profiles are implemented in code; use them when you want deterministic subsystem reduction.)

---

## Proof / smoke / eval commands

All commands run from `gzmo-daemon/`:

```bash
# typecheck + unit tests
bun run smoke

# smoke + local proof runner
bun run smoke:full

# deterministic retrieval quality gate
bun run eval:quality

# local vault proof runner (reads your VAULT_PATH)
bun run proof:local-vault

# performance benchmark (temp vault; does not touch your real vault)
GZMO_BENCHMARK_RUNS=5 bun run benchmark
```

---

## Backup & restore

Everything stateful lives under `$VAULT_PATH`. There is no external database — backing up the vault directory backs up the entire daemon's working state. The Ollama model cache (`~/.ollama/models`) is large but reproducible (`ollama pull` re-downloads), so it does not need to be backed up.

What's inside `$VAULT_PATH` that matters:

- `GZMO/Inbox/` — pending and historical task `.md` files
- `GZMO/Thought_Cabinet/` — generated notes, crystallizations
- `GZMO/Reasoning_Traces/` — JSON traces (subject to optional retention via `GZMO_TRACE_RETAIN_DAYS`)
- `GZMO/embeddings.json`, `GZMO/memory.json`, `GZMO/CHAOS_STATE.json` — runtime state snapshots
- `GZMO/perf.jsonl`, `GZMO/strategy_ledger.jsonl`, `GZMO/Reasoning_Traces/index.jsonl` — append-only logs (subject to size rotation via `GZMO_LOG_ROTATE_MB`; rotated files end in `.1`, `.2`, ...)
- `GZMO/Quarantine/` — anything the safety pipeline flagged
- `wiki/` — generated knowledge base

Recommended rhythm before any upgrade or risky `.env` change:

```bash
# Snapshot in place — preserves permissions, links, and timestamps.
cp -a "$VAULT_PATH" "${VAULT_PATH}.bak.$(date +%Y%m%d-%H%M%S)"

# Or if you want a tarball off-host:
tar -caf "/tmp/gzmo-vault-$(date +%Y%m%d-%H%M%S).tar.zst" -C "$(dirname "$VAULT_PATH")" "$(basename "$VAULT_PATH")"
```

To restore: stop the daemon (`systemctl --user stop gzmo-daemon` or Ctrl+C), `rm -rf $VAULT_PATH`, restore the snapshot, and start the daemon again. Boot recovery (`R1`) will sweep any tasks left in `processing` from the snapshot and reset them to `pending` so the watcher re-dispatches them.

---

## Troubleshooting

### Ollama unreachable

If Ollama can’t be reached, the daemon keeps the heartbeat alive but disables inference/embeddings-dependent subsystems until you restart with Ollama available.

Quick check:

```bash
curl -sS "http://localhost:11434/api/tags" | head
```

### Doctor

Run:

```bash
cd gzmo-daemon
bun run doctor
```

From the **repo root**, you can use `./scripts/doctor-agentic.sh` instead (Ollama probe, vault scaffold fixes, then `bun run doctor` with a sane default profile). Details: [Doctor (agentic readiness)](#doctor-agentic-readiness).

If your vault permissions are wrong, or `VAULT_PATH` is incorrect, the doctor output is usually the fastest way to pinpoint it.

### `install_service.sh` or shell scripts fail on Linux

- **`env: bash\r` / bad interpreter**: the script has **CRLF** line endings. Fix with `sed -i 's/\r$//' install_service.sh scripts/*.sh` (or rely on [`.gitattributes`](.gitattributes) after a fresh clone).

### User service exits with `216/GROUP`

- A **user** unit must **not** set `User=%u`. Re-run `./install_service.sh` from this repo so the generated unit matches the template.

### `ExecStartPre` wait for Ollama times out

- Ensure Ollama is running and reachable at `OLLAMA_URL`, or increase **`GZMO_OLLAMA_WAIT_MAX_SEC`** in `gzmo-daemon/.env`, or set **`GZMO_SYSTEMD_WAIT_FOR_OLLAMA=0`** to skip the pre-start wait (daemon will still retry internally).

---

## Fine-tuning (advanced)

Ollama runs fine-tuned models but does not train them. For customizing GZMO's inference quality — from simple system prompt tuning to full LoRA fine-tuning on your vault — see the step-by-step guide:

**[`docs/FINE_TUNING.md`](docs/FINE_TUNING.md)**

Quick overview of what's covered:
- **Tier 1:** System prompt tuning (5 min, zero GPU)
- **Tier 2:** LoRA fine-tuning with Unsloth (2–4 hrs, DGX Spark can train 70B LoRA)
- **Tier 3:** Full fine-tuning + custom embedding models
- Importing Safetensors, GGUF, and adapters into Ollama
- GZMO-specific Modelfile templates

For ToT / latency methodology (benchmark harness), see [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md).

---

## Repo contents (what is public)

`gzmo-daemon/`, `scripts/` (includes [`setup.sh`](scripts/setup.sh) — see [Which installer?](#which-installer-human-vs-agent); other helpers include `boot-stack.sh`, `doctor-agentic.sh`, `push_learning_to_green.sh`, `start-ollama-optimized.sh`), `install_service.sh`, `README.md`, `AGENTS.md`, `LICENSE`, `.gitignore`, [`.gitattributes`](.gitattributes), [`.editorconfig`](.editorconfig), [`docs/`](docs/) (see [Additional documentation](#additional-documentation)), [`.pi/extensions/`](.pi/extensions/) (Pi extension + bundled `gzmo-daemon` skill; JS deps in [`package.json`](.pi/extensions/package.json) and lockfile **`bun.lock`** — run `bun install` in that directory when developing the extension), [`contrib/pi-gzmo-skill/`](contrib/pi-gzmo-skill/README.md) (optional shell/CI inbox helpers). Vault data stays local and is not in git.

---

## Additional documentation

| Document | Purpose |
|----------|---------|
| [`docs/FINE_TUNING.md`](docs/FINE_TUNING.md) | Inference quality: prompts, LoRA, Modelfiles, Ollama import |
| [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md) | ToT / latency benchmark methodology (`bun run benchmark`) |

---

## Pi skill (optional)

**Two surfaces:**

1. **Pi in this repo (recommended)** — Enable the project extension [`.pi/extensions/gzmo-tinyfolder.ts`](.pi/extensions/gzmo-tinyfolder.ts). It registers `resources_discover` so Pi discovers the skill at [`.pi/extensions/skills/gzmo-daemon/`](.pi/extensions/skills/gzmo-daemon/) and exposes tools such as `gzmo_submit_task`, `gzmo_query_context`, `gzmo_watch_task`, and `gzmo_health`. You do **not** need to copy that skill into `~/.pi/skills/` for this path. Slash commands include `/gzmo` (dashboard) and `/gzmo-last`. Set **`GZMO_ENV_FILE`** to the absolute path of `gzmo-daemon/.env` (or run with cwd under the repo so env discovery matches [Configure](README.md#configure-environment-variables)).

2. **Shell, CI, or global Pi scripts** — Bash helpers that write and watch **inbox** Markdown live in [`contrib/pi-gzmo-skill/`](contrib/pi-gzmo-skill/README.md). Install into `~/.pi/skills/gzmo-daemon` if you want those scripts on your PATH via Pi’s skills tree; set **`GZMO_ENV_FILE`** to the absolute path of `gzmo-daemon/.env`. Step-by-step copy/install: **[AGENTS.md — Pi skill (optional)](AGENTS.md#pi-skill-optional)**.

---

## License

MIT — see `LICENSE`.

