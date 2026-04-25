## 📁 tinyFolder (GZMO daemon)

**What this repo is**: a local-first, filesystem-driven AI daemon (Bun + Ollama) that reads **Markdown task files** from your vault inbox, routes them by YAML frontmatter (`action: think | search | chain`), and appends results back into the same files.

**How you “talk” to it**: you don’t use a chat UI. You create a `.md` file in `GZMO/Inbox/` with `status: pending` and an `action`, and the daemon does the rest.

This README is written as a **setup + operations playbook** so any agent (human or software) can deterministically:
- install prerequisites
- create a correct vault scaffold
- configure environment variables
- start/stop/monitor the daemon
- submit tasks
- validate retrieval quality and stability
- troubleshoot failures without guessing

---

## Table of contents

- [First 5 minutes (copy/paste checklist)](#first-5-minutes-copypaste-checklist)
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
- [Troubleshooting](#troubleshooting)
- [Repo contents (what is public)](#repo-contents-what-is-public)
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

3) Point the daemon at your vault:

```bash
cat > .env <<'EOF'
VAULT_PATH="/absolute/path/to/your/vault"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="hermes3:8b"
EOF
```

4) Create the minimum vault scaffold:

```bash
mkdir -p "/absolute/path/to/your/vault/GZMO/Inbox"
mkdir -p "/absolute/path/to/your/vault/GZMO/Subtasks"
mkdir -p "/absolute/path/to/your/vault/GZMO/Thought_Cabinet"
mkdir -p "/absolute/path/to/your/vault/GZMO/Quarantine"
mkdir -p "/absolute/path/to/your/vault/wiki"
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

### Required

- **Bun** (runtime)
- **Ollama** (local LLM server)

### Recommended models

- **Inference**: `hermes3:8b` (default model tag used by the daemon if `OLLAMA_MODEL` is not set)
- **Embeddings**: `nomic-embed-text` (used by the embeddings pipeline)

Pull them:

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
mkdir -p "/absolute/path/to/your/vault/wiki"
```

Note: the daemon also creates some directories on boot if missing, but **do not rely on that** when automating setup—create the scaffold explicitly.

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

---

## Run (foreground)

In one terminal, start Ollama.

In another terminal:

```bash
cd gzmo-daemon
bun run summon
```

---

## Run (systemd user service)

This repo includes a portable systemd **user** service template:
- Template: `gzmo-daemon/gzmo-daemon.service.template`
- Installer: `./install_service.sh` (writes the concrete unit file under your user config)

Install + start:

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

Create this exact file:

- Path: `"$VAULT_PATH/GZMO/Inbox/000_golden_minimal_task.md"`

Contents:

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
```

---

## Troubleshooting

### Ollama unreachable

If Ollama can’t be reached, the daemon keeps the heartbeat alive but disables inference/embeddings-dependent subsystems until you restart with Ollama available.

Quick checks:

```bash
curl -sS "http://localhost:11434/api/tags" | head
```

### Doctor

Run:

```bash
cd gzmo-daemon
bun run doctor
```

If your vault permissions are wrong, or `VAULT_PATH` is incorrect, the doctor output is usually the fastest way to pinpoint it.

---

## Repo contents (what is public)

This public repo intentionally contains **only executable code + minimal packaging**:

- `gzmo-daemon/` (Bun/TS daemon)
- `README.md`, `LICENSE`, `.gitignore`, `install_service.sh`

Your vault contents are **local-only** and not part of the repository.

---

## License

MIT — see `LICENSE`.

