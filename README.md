## tinyFolder

> **Archived.** Active development is in **[GZMO (gzmo_tinyFolder)](https://github.com/maximilianwruhs-cyber/gzmo_tinyFolder)** — core daemon + optional plugins, hardware-based install. This repo is frozen at tag [`archive/pre-core-plugins`](https://github.com/maximilianwruhs-cyber/tinyFolder/releases/tag/archive%2Fpre-core-plugins) for history only.

GZMO daemon (**Bun** + **Ollama**): vault Markdown inbox tasks (`think` / `search` / `chain`). Files land in a **vault**; users drop documents on the **Desktop Dropzone**; the local LLM answers with **`[E#]` evidence** from ingested notes.

| Machine | Inference model | Profile | Config template |
|---------|-----------------|---------|-----------------|
| Laptop / small GPU (≈ **4–8 GB** VRAM) | `hermes3:8b` (wizard default) | `core` | [`gzmo-daemon/.env.example`](gzmo-daemon/.env.example) |
| Workstation (≈ **≥24 GB** VRAM, non-Blackwell) | **`qwen3.6:35b-a3b`** (Q4, ~24 GB in Ollama) | `core` | [`gzmo-daemon/.env.example`](gzmo-daemon/.env.example) |
| **NVIDIA Blackwell** (DGX Spark GB10, RTX 50xx, RTX PRO Blackwell — [Ollama GPU list](https://docs.ollama.com/gpu)) | **`qwen3.6:35b-a3b-nvfp4`** (~22 GB — **best overall** in this stack) | `core` | [`gzmo-daemon/.env.spark.example`](gzmo-daemon/.env.spark.example) |

**Reference chat model:** **`qwen3.6:35b-a3b-nvfp4`** is the strongest default we target for document RAG + long context when your driver/GPU supports the NVFP4 tag. If `ollama pull` or runtime rejects NVFP4, use the **same generation** [`qwen3.6:35b-a3b`](https://ollama.com/library/qwen3.6:35b-a3b) on a **≥24 GB** VRAM GPU (see [Prerequisites — Recommended models](#recommended-models)). Smaller GPUs use the **largest row that fits** in the VRAM table there — not this flagship.

Agent checklist: [`AGENTS.md`](AGENTS.md).

---

## Table of contents

- [First 5 minutes (copy/paste checklist)](#first-5-minutes-copypaste-checklist)
- [Which installer? (human vs agent)](#which-installer-human-vs-agent)
- [Bigger machine (DGX Spark)](#bigger-machine-dgx-spark--64gb-ram--quick-path)
- [Fresh machine agentic bootstrap](#fresh-machine-agentic-bootstrap-recommended)
- [Doctor (agentic readiness)](#doctor-agentic-readiness)
- [Why GZMO is not a chatbot](#why-gzmo-is-not-a-chatbot)
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
- [Troubleshooting (DGX Spark)](docs/TROUBLESHOOTING_SPARK.md)
- [Fine-tuning (advanced)](#fine-tuning-advanced)
- [Repo contents (what is public)](#repo-contents-what-is-public)
- [Additional documentation](#additional-documentation)
- [Pi skill (optional)](#pi-skill-optional)
- [License](#license)

---

## First 5 minutes (copy/paste checklist)

Goal: get from zero to a verified end-to-end loop (**Inbox → claim → append output**) with the smallest possible surface area.

1) Start Ollama (laptops: plain `ollama serve`; **DGX Spark**: use optimized script — sets **256k** context when appropriate):

```bash
./scripts/start-ollama-optimized.sh
# or: OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KEEP_ALIVE=-1 ollama serve
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

The wizard supports everything from CPU-only laptops up to **NVIDIA DGX Spark** (128 GB unified memory). It prefers **`qwen3.6:35b-a3b-nvfp4`** when the host can run that tag (Blackwell / compute **12.0+** per [Ollama hardware support](https://docs.ollama.com/gpu)), otherwise **`qwen3.6:35b-a3b`** if VRAM allows (~24 GB model weights), then **`qwen3:32b`** (~20 GB) or smaller — consistent with [NVIDIA’s DGX Spark playbook](https://build.nvidia.com/spark/cli-coding-agent).

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

### Bigger machine (DGX Spark / 64GB+ RAM) — quick path

For a fresh powerful box (e.g. **NVIDIA DGX Spark**), prefer **core** first: inbox, embeddings, Dropzone ingest, and search with `[E#]` citations — without turning on clarification gates until you need them.

```bash
cd /path/to/tinyFolder
# Agent/Cursor bootstrap: vault anywhere, Dropzone on Desktop/Schreibtisch by default
./scripts/setup.sh agent --vault /home/you/GZMO-vault --force-env --with-systemd
# Or human flow + wizard (Spark → qwen3.6 nvfp4):
./scripts/setup.sh human --auto-wizard

cd gzmo-daemon
bun install
ollama pull nomic-embed-text
ollama pull "$(grep '^OLLAMA_MODEL=' .env | cut -d= -f2- | tr -d '"')"
# Spark default if wizard not run yet:
# ollama pull qwen3.6:35b-a3b-nvfp4 || ollama pull qwen3.6:35b-a3b
bun run doctor
cd .. && ./install_service.sh && systemctl --user daemon-reload && systemctl --user enable --now gzmo-daemon
```

**Dropzone on Desktop:** set `GZMO_DROPZONE_DIR` to an absolute folder such as `~/Schreibtisch/GZMO-Dropzone` (or `~/Desktop/GZMO-Dropzone`). The vault (`VAULT_PATH`) can live elsewhere; wiki notes and embeddings still live under the vault. `agentic-setup.sh` creates the desktop folder and writes `GZMO_DROPZONE_DIR` unless you pass `--no-desktop-dropzone`.

**“Smooth” bill/doc test:** drop a fake invoice (PDF or `.md`) into the desktop Dropzone → daemon converts/stores under `wiki/incoming/` → auto follow-up **search** task → answer must quote amounts/lines with **`[E#]`** evidence tags from that page. Use `GZMO_PROFILE=core`; enable `GZMO_ENABLE_GAH` / `GZMO_ENABLE_DSJ` / `interactive` only when you want the LLM to halt for clarification.

### Maximizing context on DGX Spark (128 GB unified memory)

Context is **not one knob**. Ollama’s KV cache (how much the model *can* remember) and GZMO’s retrieval/evidence budget (how much vault text is *injected* per task) are separate. On Spark you can max out the **Ollama** side without stress; **GZMO** still needs the evidence/output knobs for bill-quality answers.

#### Memory budget (re-evaluated for `qwen3.6:35b-a3b-nvfp4`)

**Non-Spark GPUs:** the same Qwen 3.6 line uses about **24 GB** for [`qwen3.6:35b-a3b`](https://ollama.com/library/qwen3.6:35b-a3b) (Q4) when NVFP4 is unavailable; smaller VRAM budgets use other rows in [Recommended models](#recommended-models).

| Component | Typical size | Notes |
|-----------|--------------|--------|
| **Total pool** | **128 GB** | CPU+GPU unified on GB10 — not “GPU-only” VRAM |
| OS + desktop + buffers | 6–10 GB | Leave this headroom; don’t plan to 128.0 GB flat |
| **Model weights (nvfp4)** | **~22 GB** | [Ollama tag](https://ollama.com/library/qwen3.6:35b-a3b-nvfp4); vs **~70 GB** BF16 — do **not** use BF16 if you want long context on one box |
| **KV cache (q8_0)** at **262144** ctx | **~5–6 GB** | MoE arch: 40 layers × **2** KV heads × 128 dim ([config](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)); formula ≈ `ctx × 20 KiB/token` at q8_0 |
| KV at **131072** (128k) | **~2.6 GB** | Half of 256k |
| KV at **65536** (64k) | **~1.3 GB** | Ollama’s minimum for “agents/RAG” class workloads |
| Inference scratch (MoE, 3B active) | 2–4 GB | Much smaller than dense 70B |
| `nomic-embed-text` (if loaded) | **&lt;0.5 GB** | Optional second model; use `OLLAMA_MAX_LOADED_MODELS=2` only when needed |

**Estimated total (recommended stack):**

```
128 GB
 − 8 GB   OS / desktop
 − 22 GB  qwen3.6:35b-a3b-nvfp4 weights
 −  6 GB  KV @ 262144 + flash-attn / allocator headroom
 −  3 GB  runtime scratch
 ≈ 89 GB  FREE (single-user, one chat model loaded)
```

Community vLLM measurements on the same hardware report **~80+ GB available for KV** after NVFP4 weights ([DGX Spark Qwen guide](https://github.com/adadrag/qwen3.5-dgx-spark)) — consistent with the formula above (256k native needs only ~5 GB KV, not 80 GB; the rest is unused capacity you *could* use for concurrency or a second model).

**Do not compare to dense 72B on Spark:**

| Model | Weights | KV @ 128k (q8, approx.) | Fits 128 GB with 256k ctx? |
|-------|---------|-------------------------|----------------------------|
| `qwen3.6:35b-a3b-nvfp4` | ~22 GB | ~2.6 GB | **Yes — easily** |
| `qwen2.5:72b` Q4 | ~48 GB | ~24 GB | Tight; little room for embed + OS |
| `qwen3.6:35b-a3b` BF16 | ~70 GB | ~5 GB+ | **Poor** — KV headroom collapses |

#### Recommended `OLLAMA_CONTEXT_LENGTH` on Spark

| Setting | When | Why |
|---------|------|-----|
| **262144** (256k) | **Default for Spark** — use this | Native max for Qwen 3.6; only ~5–6 GB KV; **~85–90 GB** still free with nvfp4 |
| 131072 (128k) | Debugging slowness on huge single prompts | Still plenty of headroom; halves KV |
| 65536 (64k) | Ollama doc floor for agents/RAG | Only if you need to free RAM for **second** large model |
| &gt;262144 | Not recommended | Beyond trained context; quality may drift (vLLM allows override; Ollama caps at model limit) |

Ollama already picks **256k** default when it sees ≥48 GiB ([context-length docs](https://docs.ollama.com/context-length)). `start-ollama-optimized.sh` sets **`OLLAMA_CONTEXT_LENGTH=262144`** on Spark when unset.

**Start Ollama (Spark):**

```bash
OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KEEP_ALIVE=-1 \
  OLLAMA_CONTEXT_LENGTH=262144 \
  ./scripts/start-ollama-optimized.sh
```

**Verify on the real machine** (ground truth beats formulas):

```bash
ollama run qwen3.6:35b-a3b-nvfp4 "ping"
ollama ps
```

You want **`CONTEXT` ≈ 262144** and **`PROCESSOR` = 100% GPU**. The **`SIZE`** column is total resident memory for that model+context slot — expect roughly **28–35 GB** for nvfp4 @ 256k (not 128 GB). If `SIZE` &gt; 50 GB or CPU appears in `PROCESSOR`, lower context or confirm you are on **nvfp4**, not BF16.

#### GZMO knobs (still required for “good results” on bills)

Max Ollama context does **not** auto-inject full invoices. Raise retrieval/output separately:

| Layer | Spark-oriented target |
|--------|------------------------|
| `GZMO_TOPK` | **12** |
| `GZMO_EVIDENCE_MAX_SNIPPETS` | **16** |
| `GZMO_EVIDENCE_MAX_CHARS` | **2400** |
| `GZMO_LLM_MAX_TOKENS` | **2048** |

```bash
# gzmo-daemon/.env
GZMO_TOPK=12
GZMO_EVIDENCE_MAX_SNIPPETS=16
GZMO_EVIDENCE_MAX_CHARS=2400
GZMO_LLM_MAX_TOKENS=2048
```

**Thinking mode:** Qwen 3.6 can spend huge internal token budgets in thinking mode — disable for short factual bill Q&A (`/no_think` or non-thinking template) so context is not wasted on hidden reasoning.

**Concurrency:** Each extra parallel chat multiplies KV. GZMO Inbox is mostly **one task at a time** — 256k single-user is safe; a company-wide multi-user server is a different sizing problem.

Golden task: [Golden minimal task](#golden-minimal-task-end-to-end-verification).

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
- **Ollama** — pull models for your hardware (`hermes3:8b` + `nomic-embed-text` on laptops; **≥24 GB** single-GPU: **`qwen3.6:35b-a3b`**; **Blackwell / DGX Spark**: **`qwen3.6:35b-a3b-nvfp4`** — see [Recommended models](#recommended-models))

Bootstrap (vault scaffold + `.env` + bun deps; on Spark also sets **desktop Dropzone** + document RAG knobs):

```bash
VAULT="/absolute/path/to/your/vault"
./scripts/setup.sh agent --vault "$VAULT" --force-env --with-systemd
# equivalent: ./scripts/agentic-setup.sh --vault "$VAULT" --force-env
# Spark reference .env: cp gzmo-daemon/.env.spark.example gzmo-daemon/.env
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

## Why GZMO is not a chatbot

GZMO is closer to an **embedding-aware filesystem daemon**: tasks are Markdown files (`GZMO/Inbox/`); completions are appended in place; RAG retrieves **chunks** from your vault (`GZMO/embeddings.json`) rather than pretending the model “remembers everything.” Chaos/dream/autonomy loops still write **inspectable audits** (`Thought_Cabinet/`). That makes the workload **replayable**, **diffable**, and **local-first** compared to SaaS chats.

To lean into retrieval + continuity without exploding token cost, tune [`GZMO_THINK_RETRIEVAL`](#configure-environment-variables), [`GZMO_TOPK`](#configure-environment-variables), and optional working-set excerpts (`GZMO_MEMORY_WORKING_*`). Named starter bundles live under [`contrib/env-modes/`](contrib/env-modes/).

---

## Mental model

### Core contract (deterministic)

- **Input**: Markdown task files in `VAULT_PATH/GZMO/Inbox/*.md`
- **Routing**: YAML frontmatter key `action` chooses behavior
- **Lifecycle**: `status: pending → processing → completed | failed | unbound`
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

#### Reference vs code default

- **Best overall (when supported):** **`qwen3.6:35b-a3b-nvfp4`** — Qwen 3.6 MoE, NVFP4 weights (~**22 GB** in Ollama). Use on **NVIDIA Blackwell** GPUs (compute **12.0+**: DGX Spark **GB10**, GeForce **RTX 50xx**, **RTX PRO Blackwell**, etc. — see [Ollama — hardware support](https://docs.ollama.com/gpu)). This is the variant we optimize for on Spark (256k context + document RAG knobs in [`.env.spark.example`](gzmo-daemon/.env.spark.example)).
- **Same generation, no NVFP4 path:** **`qwen3.6:35b-a3b`** — Q4_K_M in Ollama (~**24 GB**). Pick this on strong **Ada / Ampere** cards (≈**24 GB** VRAM or large UMA) when NVFP4 is unavailable.
- **Code default if `OLLAMA_MODEL` is unset:** `hermes3:8b` (see `loadConfig()` in `gzmo-daemon/src/config.ts`) so a fresh clone does not assume 24 GB VRAM. **Set `OLLAMA_MODEL` explicitly** on bigger hardware.

Weight sizes below are **model weights only** from the Ollama library; add **KV cache**, OS, and (if loaded) **`nomic-embed-text`** / **`qwen3-embedding:4b`**. Choose the **largest tier that still leaves headroom** for your typical `OLLAMA_CONTEXT_LENGTH`.

| VRAM budget (chat model + headroom) | Primary `OLLAMA_MODEL` | Alternatives | Notes |
|-------------------------------------|------------------------|--------------|--------|
| CPU / iGPU only | `phi3:mini`, `qwen2.5:0.5b` | — | Wizard auto-picks |
| **4–8 GB** | `hermes3:8b` | `qwen2.5:7b` | Repo “laptop / small GPU” default |
| **10–14 GB** | `qwen2.5:14b` | `deepseek-r1:14b` | Better reasoning than 8B; confirm size with `ollama show` |
| **16–22 GB** | `qwen3:32b` | `qwen2.5:14b` if you need margin | [`qwen3:32b`](https://ollama.com/library/qwen3:32b) lists ~**20 GB** Q4 — previous-gen Qwen3 **dense** |
| **≥24 GB** (no NVFP4) | **`qwen3.6:35b-a3b`** | — | [`qwen3.6:35b-a3b`](https://ollama.com/library/qwen3.6:35b-a3b) ~**24 GB** Q4 — same family as the NVFP4 flagship |
| **Blackwell NVFP4** | **`qwen3.6:35b-a3b-nvfp4`** | `qwen3.6:35b-a3b` if NVFP4 fails | [`~22 GB`](https://ollama.com/library/qwen3.6:35b-a3b-nvfp4); **preferred** when the tag runs |
| **48 GB+** | `qwen3.6:35b-a3b-nvfp4` or `qwen3.6:35b-a3b` | `qwen3-embedding:4b` alongside | Prefer **Qwen 3.6** over legacy **dense 70B–72B** for this repo’s ingest + `[E#]` RAG unless you explicitly need them |

**Embeddings:** `nomic-embed-text` everywhere by default; optional **`qwen3-embedding:4b`** when you have spare VRAM ([Spark template](gzmo-daemon/.env.spark.example)).

Pull sets:

```bash
# Laptop / 4–8 GB class
ollama pull hermes3:8b
ollama pull nomic-embed-text

# Single GPU ≈24 GB (no NVFP4) — same Qwen 3.6 family as flagship
ollama pull qwen3.6:35b-a3b
ollama pull nomic-embed-text

# DGX Spark / Blackwell NVFP4 (preferred when supported)
ollama pull qwen3.6:35b-a3b-nvfp4
ollama pull nomic-embed-text
# optional: ollama pull qwen3-embedding:4b
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
- `GZMO/Dropzone/` (optional: arbitrary files or nested folders the daemon routes into Inbox or `wiki/incoming/`)
- `GZMO/Subtasks/` (chain sub-tasks)
- `GZMO/Thought_Cabinet/` (dream/self-ask/etc artifacts)
- `GZMO/Quarantine/` (optional, but used by some flows)

Create them:

```bash
mkdir -p "/absolute/path/to/your/vault/GZMO/Inbox"
mkdir -p "/absolute/path/to/your/vault/GZMO/Dropzone"
mkdir -p "/absolute/path/to/your/vault/GZMO/Subtasks"
mkdir -p "/absolute/path/to/your/vault/GZMO/Thought_Cabinet"
mkdir -p "/absolute/path/to/your/vault/GZMO/Quarantine"
mkdir -p "/absolute/path/to/your/vault/GZMO/Reasoning_Traces"
mkdir -p "/absolute/path/to/your/vault/wiki"
mkdir -p "/absolute/path/to/your/vault/wiki/incoming"
```

Note: the daemon also creates some directories on boot if missing, but **do not rely on that** when automating setup—create the scaffold explicitly. `GZMO/Reasoning_Traces/` is optional (used when `GZMO_ENABLE_TRACES` is on).

---

## Configure (environment variables)

The daemon reads environment variables. For local usage, the simplest is a file:

- `gzmo-daemon/.env` (used by the systemd template and by your shell if you export it)

### Required configuration

- **`VAULT_PATH`**: absolute path to your vault directory.
- **`GZMO_DROPZONE_DIR`** (optional): absolute path to the physical Dropzone folder. Default: `$VAULT_PATH/GZMO/Dropzone`. Use e.g. `~/Schreibtisch/GZMO-Dropzone` so drag-and-drop works from the desktop while the vault lives elsewhere.

Example `gzmo-daemon/.env` (laptop):

```bash
VAULT_PATH="/absolute/path/to/your/vault"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="hermes3:8b"
GZMO_PROFILE="core"
GZMO_EMBED_MODEL="nomic-embed-text"
```

**DGX Spark / Blackwell:** copy [`gzmo-daemon/.env.spark.example`](gzmo-daemon/.env.spark.example) → `.env` (includes `GZMO_DROPZONE_DIR`, document RAG knobs, `qwen3.6:35b-a3b-nvfp4`).

**Other workstation (e.g. RTX 4090 24 GB):** start from [`.env.example`](gzmo-daemon/.env.example) and set `OLLAMA_MODEL="qwen3.6:35b-a3b"` (or `"qwen3.6:35b-a3b-nvfp4"` on RTX 50xx if the tag loads). See [Recommended models](#recommended-models).

### Clean boot (systemd helper env)

The installed user unit runs `scripts/wait-for-ollama.sh` before the daemon so Ollama is usually up before Bun starts (avoids “gave up after retries” when Ollama is slow).

- **`GZMO_SYSTEMD_WAIT_FOR_OLLAMA`**: set to `0` / `false` / `off` to **skip** that wait (useful if you never run Ollama on this machine).
- **`GZMO_OLLAMA_WAIT_MAX_SEC`**: max wait in seconds (default: `180`).

### Core runtime knobs

- **`OLLAMA_URL`**: base URL for Ollama (default: `http://localhost:11434`)
- **`OLLAMA_MODEL`**: model tag for inference (code default: `hermes3:8b` when unset). **Quality reference:** **`qwen3.6:35b-a3b-nvfp4`** on supported Blackwell hardware, else **`qwen3.6:35b-a3b`** on ≈24 GB+ GPUs — see [Recommended models](#recommended-models).
- **`GZMO_PROFILE`**: runtime profile / safe mode selector (see [Profiles / safe modes](#profiles--safe-modes))

### Retrieval quality knobs (defaults are set at runtime if unset)

The daemon sets these defaults at boot (and you can override them):

- **`GZMO_MULTIQUERY`**: `on|off` — query rewrites for recall (default: `on`)
- **`GZMO_RERANK_LLM`**: `on|off` — rerank retrieved chunks (default: `on`)
- **`GZMO_ANCHOR_PRIOR`**: `on|off` — boosts canonical “anchor” chunks (default: `on`)
- **`GZMO_MIN_RETRIEVAL_SCORE`**: float string — fail-closed retrieval threshold (default: `0.32`)
- **`GZMO_TOPK`**: int — hybrid retrieval hits per search (default: `6`, max `20`)
- **`GZMO_EVIDENCE_MAX_SNIPPETS`**: int — max `[E#]` snippets in the evidence packet (default: `10`)
- **`GZMO_EVIDENCE_MAX_CHARS`**: int — max characters per snippet (default: `900`, max `4000`)
- **`GZMO_LLM_MAX_TOKENS`**: int — caps model *output* length per task; overrides chaos pulse when set (default: pulse-derived `400`–`800`, clamp `128`–`8192`)

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
- `GZMO_ENABLE_DROPZONE` — watch the Dropzone folder for loose files (default: `on` when the inbox watcher runs)
- `GZMO_DROPZONE_DIR` — absolute path override for Dropzone (default: `$VAULT_PATH/GZMO/Dropzone`)

**Wiki consolidation cluster cooldown** (reduces retry/quarantine churn when drafts fail gates; keyed in `GZMO/.gzmo_wiki_digest.json`):

- **`GZMO_WIKI_CLUSTER_COOLDOWN`**: `on|off` — backoff failed cabinet clusters instead of retrying every wiki cycle (default: **`on`**)
- **`GZMO_WIKI_CLUSTER_COOLDOWN_BASE_MIN`**: first backoff slice in minutes (default: **`15`**; clamped **1 … 1440**)
- **`GZMO_WIKI_CLUSTER_COOLDOWN_MAX_HOURS`**: backoff cap as hours (default: **`24`**; clamped **1 … 168**)
- **`GZMO_WIKI_CLUSTER_FAILURE_CAP`**: **`0`** = exponential backoff only; **`N>0`** = after **`N`** failures, sleep **30 days** until manual digest cleanup or **`GZMO_WIKI_CLUSTER_COOLDOWN=off`**

**Task memory (`GZMO/memory.json`), think retrieval & working-set knobs**

- **`GZMO_MEMORY_MAX_ENTRIES`**: episodic completions kept (default: **`5`**, clamped **1 … 50**)
- **`GZMO_MEMORY_SUMMARY_CHARS`**: per-entry summary truncation (default: **`120`**, clamped **40 … 500**)
- **`GZMO_THINK_RETRIEVAL`**: `off` \| `light` \| `on` — inject a bounded Evidence Packet into **think** tasks (default: **`off`**). **`light`** runs hybrid search only when the task looks vault-grounded (same heuristic as Project grounding).
- **`GZMO_THINK_TOPK`** / **`GZMO_THINK_EVIDENCE_MAX_SNIPPETS`** / **`GZMO_THINK_EVIDENCE_MAX_CHARS`**: budget for think-time retrieval (defaults **3**, **6**, **900**)
- **`GZMO_MEMORY_WORKING_SET`**: `off` \| `cabinet` \| `cabinet_wiki` — prepend short recency excerpts from `Thought_Cabinet/` (and optionally `wiki/`) into the memory block (default: **`off`**)
- **`GZMO_MEMORY_WORKING_SET_MAX_FILES`**, **`GZMO_MEMORY_WORKING_SET_CHARS_PER_FILE`**: excerpt bounds (defaults **4** files × **400** chars each)

**Autonomy backpressure**

- **`GZMO_AUTONOMY_OPS_BUDGET_HOUR`**: combined cap on autonomy **writes/hour** (self-ask emits, crystallized dreams, wiki cycles counted per tick). **`0`** = unlimited (default). Digest: `GZMO/.gzmo_autonomy_budget.json`

**Dropzone conversion** (local-only; no network in the convert path):

- `GZMO_DROPZONE_CONVERT` — `on|off` — try built-in Markdown conversion for allowed non-`.md` types before writing a binary stub (default: `on`)
- `GZMO_DROPZONE_CONVERT_MAX_BYTES` — max file size to attempt conversion (default: `52428800` = 50 MiB; clamped 4096 … 200 MiB)
- `GZMO_DROPZONE_CONVERT_TIMEOUT_MS` — per-file wall clock for conversion (default: `120000`; clamped 5000 … 600000)
- `GZMO_DROPZONE_CONVERT_EXTENSIONS` — comma-separated allowlist without dots (default: `pdf,docx,html,htm,txt,text,csv,json`). Empty/unset uses the default set.

**Dropzone dedup (SHA256)** — skips re-converting identical drops; writes `type: dropzone-duplicate-ref` instead:

- `GZMO_DROPZONE_DEDUP` — `on|off` (default: `on`)
- `GZMO_DROPZONE_DEDUP_MAX_BYTES` — only hash files up to this size for dedup (default: same clamp window as `GZMO_DROPZONE_CONVERT_MAX_BYTES`)

**Dropzone ZIP** — **off** by default; scans a dropped `.zip` on disk and ingests the **first** inner file whose extension is in `GZMO_DROPZONE_CONVERT_EXTENSIONS` (Zip Slip–safe, bounded):

- `GZMO_DROPZONE_ZIP` — `on|off` (default: `off`)
- `GZMO_DROPZONE_ZIP_MAX_BYTES` — max outer archive size (default: `104857600` = 100 MiB)
- `GZMO_DROPZONE_ZIP_MAX_ENTRIES` — max central-directory entries scanned (default: `512`)
- `GZMO_DROPZONE_ZIP_MAX_ENTRY_BYTES` — max uncompressed size per inner file (default: `52428800`)
- `GZMO_DROPZONE_ZIP_MAX_RATIO` — max `uncompressedSize / compressedSize` per entry (default: `100`)

### HTTP API (optional)

The daemon exposes a thin REST + SSE layer when enabled. Tasks submitted via HTTP land in the same `GZMO/Inbox/` directory the file watcher reads, so behavior is identical to dropping a `.md` file directly.

- **`GZMO_API_ENABLED`**: `on|off` — start the HTTP server alongside the watcher (default: `off`)
- **`GZMO_API_HOST`**: hostname to bind (default: `127.0.0.1`)
- **`GZMO_API_PORT`**: TCP port (default: `12700`)
- **`GZMO_API_SOCKET`**: path to a Unix domain socket — when set, overrides host/port
- **`GZMO_LOCAL_ONLY`**: `on|off` — when `on`, refuse to start unless the bind address is loopback, and lock CORS to loopback origins via strict URL parsing (default: **`on`**)
- **`GZMO_API_TOKEN`**: shared secret — **required** to start the API (all routes including `/health` use `Authorization: Bearer <token>`). Generate a strong random value even on `127.0.0.1`.
- **`GZMO_API_ALLOW_INSECURE`**: `on|off` — dev/tests only: allow starting the API without `GZMO_API_TOKEN` (default: `off`)

**Recommended secure API block** (copy into `.env` when enabling the HTTP layer):

```bash
GZMO_API_ENABLED=1
GZMO_API_HOST=127.0.0.1
GZMO_API_PORT=12700
GZMO_LOCAL_ONLY=1
GZMO_API_TOKEN="<your-strong-random-secret>"
```
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
- **`GZMO_EMBED_MODEL`**: embedding model tag used by `embeddings.ts` and doctor (default: `nomic-embed-text`; Spark may use `qwen3-embedding:4b` after `ollama pull`)
- **`GZMO_ENABLE_TOOL_CHAINING`**: `on|off` — allow follow-up `vault_read` / `dir_list` calls inferred from prior tool output, still capped by `GZMO_MAX_TOOL_CALLS` (default: `off`)
- **`GZMO_ENABLE_KNOWLEDGE_GRAPH`**: `on|off` — update the on-vault Knowledge Graph on task completion (default: `off`)
- **`GZMO_KG_SEARCH_AUGMENT`**: `on|off` — augment vault retrieval using Knowledge Graph-connected sources (default: `off`)

### Clarification-first (optional; `GZMO_PROFILE=interactive` enables GAH/DSJ/teachback by default)

- **`GZMO_ENABLE_GAH`**: `on|off` — halt search when evidence is empty/weak before LLM inference (default: `off`)
- **`GZMO_GAH_MIN_SCORE`**: float — GAH threshold; falls back to `GZMO_MIN_RETRIEVAL_SCORE` when unset
- **`GZMO_ENABLE_DSJ`**: `on|off` — shadow-judge rewrite loop after generation (default: `off`)
- **`GZMO_DSJ_THRESHOLD`**: float — minimum judge score 0.0–1.0 (default: `0.5`)
- **`GZMO_ENABLE_TEACHBACK`**: `on|off` — pre-inference vagueness check for search (default: `off`)
- **`GZMO_ENABLE_THINK_CLARIFY`**: `on|off` — halt think tasks that reference missing vault paths or empty retrieval (default: `off`)
- **`GZMO_ENABLE_PDU`**: `on|off` — umpire synthesis when DSJ rewrite fails (default: `off`)
- **`GZMO_ENABLE_SEMANTIC_NOISE`**: `on|off` — halt when answer drifts from query intent (default: `off`)
- **`GZMO_SEMANTIC_NOISE_MAX`**: float — noise budget (default: `1.0`)
- **`GZMO_TRIPARTITE_PROMPTS`**: `on|off` — Task/Context/Coordination prompt layers (default: `off`)
- **`GZMO_TOT_HALT_UNBOUND`**: `on|off` — ToT analyze gate failure → `unbound` instead of fail-closed answer (default: `off`; requires `GZMO_ENABLE_GATES`)
- **`GZMO_ISSUES_MIRROR`**: `on|off` — copy unbound tasks to `GZMO/Issues/` (default: `off`)
- **`GZMO_ENABLE_TRUST_LEDGER`**: `on|off` — per-vault trust score modulates DSJ threshold (default: `off`)
- **`GZMO_ENABLE_STRATEGY_REVIEWS`**: `on|off` — write human-visible `GZMO/Reviews/review_*.md` (default: `off`)
- **`GZMO_ENABLE_KG_COLLISION`**: `on|off` — halt on KG constraint/contradiction hits (requires `GZMO_ENABLE_KNOWLEDGE_GRAPH`, default: `off`)
- **`GZMO_ENABLE_BOOT_REPORT`**: `on|off` — write `GZMO/Reports/boot_report_*.md` at startup (default: `on`)

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

### Dropzone (loose files)

When the inbox watcher is enabled (so not in `heartbeat` / `GZMO_ENABLE_INBOX_WATCHER=0`) and `GZMO_ENABLE_DROPZONE` is not turned off, it watches the **Dropzone root** recursively: **`$GZMO_DROPZONE_DIR`** if set, otherwise **`$VAULT_PATH/GZMO/Dropzone/`** (any nesting under that root). Only the daemon’s own subtrees at the **root** of Dropzone (`_processed/`, `_failed/`, `files/`, `_tmp/`) and dotfile paths are ignored, so a nested folder named `files/` inside a customer bundle is still ingested.

- A **pending GZMO task** `.md` (`status: pending` and `action: think|search|chain`) is **moved into** `GZMO/Inbox/`.
- Any other **Markdown** file is copied into **`wiki/incoming/`**, embedded when the store is available, then an **`action: search` follow-up task** is created so retrieval can cite the new page.
- **Non-Markdown** files: if `GZMO_DROPZONE_CONVERT` is on and the extension is in `GZMO_DROPZONE_CONVERT_EXTENSIONS` (and the file is under the size cap), the daemon converts to Markdown, writes **`wiki/incoming/`** with frontmatter (`type: dropzone-converted`, `binary_path`, `converted_handler`, optional `dropzone_pdf_triage` for PDFs, optional `dropzone_zip_member` when the source was a `.zip`), keeps the original bytes under **`GZMO/Dropzone/files/`**, embeds when configured, then writes the follow-up search task. If conversion is off, unsupported, oversize, or errors, it stores the file under `GZMO/Dropzone/files/` and writes a **stub** page instead (same as before).
- **SHA256 dedup:** when `GZMO_DROPZONE_DEDUP` is on and the file is within `GZMO_DROPZONE_DEDUP_MAX_BYTES`, a vault-local index at **`GZMO/.gzmo_dropzone_index.json`** records the first ingest outcome per hash (converted Markdown page **or** binary stub page—anything that reached `wiki/incoming/` plus a stored file under `GZMO/Dropzone/files/`). A repeat drop gets `type: dropzone-duplicate-ref` pointing at the earlier wiki page and stored binary.
- **ZIP:** when `GZMO_DROPZONE_ZIP=on`, a dropped `.zip` is opened with bounded scanning; the first inner file matching the conversion allowlist is converted. Outer `.zip` bytes are still stored under `GZMO/Dropzone/files/`.
- **Higher PDF fidelity (optional, not bundled):** the built-in path is text-layer extraction only. For difficult PDFs you can manually run a local tool (e.g. **Docling** or **Marker**) on files under `GZMO/Dropzone/files/` and move the resulting Markdown into `wiki/incoming/` yourself, or extend the daemon later with an explicit opt-in sidecar—there is no automatic cloud conversion in GZMO.

Processed originals are moved to `GZMO/Dropzone/_processed/`; failures go to `GZMO/Dropzone/_failed/` when possible. Reserved **at the root** of Dropzone (not ingested, not descended into on boot): `_processed/`, `_failed/`, `files/`, `_tmp/`. Set `GZMO_ENABLE_DROPZONE=0` to disable.

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

### Clarification halt (`status: unbound`)

When **Gate-as-Halt (GAH)** or the **Dialectical Shadow Judge (DSJ)** cannot proceed confidently, the daemon may set `status: unbound` and append a `## ⏸️ GZMO Needs Clarification` block instead of hallucinating an answer.

**Resume:** edit the task body, address the questions, then change `status: unbound` → `status: pending` and save. The inbox watcher re-dispatches on `change`.

| Env var | Default | Role |
|---------|---------|------|
| `GZMO_ENABLE_GAH` | off | Halt search when vault evidence is empty/weak (`GZMO_GAH_MIN_SCORE`, falls back to `GZMO_MIN_RETRIEVAL_SCORE`) |
| `GZMO_ENABLE_DSJ` | off | Post-generation judge + optional rewrite (`GZMO_DSJ_THRESHOLD`) |
| `GZMO_ENABLE_TEACHBACK` | off | Pre-inference vagueness check (search) |
| `GZMO_ENABLE_PDU` | off | Full Prosecutor–Defender–Umpire synthesis when DSJ rewrite fails |
| `GZMO_ENABLE_SEMANTIC_NOISE` | off | Halt when response drifts from query intent |
| `GZMO_TRIPARTITE_PROMPTS` | off | Layer system prompts as Task/Context/Coordination |
| `GZMO_ISSUES_MIRROR` | off | Copy unbound tasks to `GZMO/Issues/` for triage |
| `GZMO_PROFILE=interactive` | — | Enables GAH + DSJ + teachback by default (explicit env overrides win) |

For stronger DSJ critique, set `GZMO_ENABLE_MODEL_ROUTING=on` and configure a dedicated judge model.

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

- `GZMO/SELF_HELP.md` — **machine-generated fix list** (Ollama, models, Dropzone, RAG knobs); refresh with `./scripts/spark-self-check.sh --write-vault` or on daemon boot
- `GZMO/health.md` — human-readable health snapshot
- `GZMO/TELEMETRY.json` — structured ops telemetry snapshot
- `GZMO/OPS_OUTPUTS.json` — machine-readable outputs registry generated from code
- `GZMO/Live_Stream.md` — human-readable event stream / heartbeat
- `GZMO/embeddings.json` — embeddings store (local-only; large)
- `GZMO/rag-quality.md` + `GZMO/retrieval-metrics.json` — eval harness outputs
- `GZMO/anchor-index.json` + `GZMO/anchor-report.md` — anchor artifacts
- `GZMO/self-ask-quality.md` — self-ask quality report
- `GZMO/Reasoning_Traces/` — per-task reasoning traces (`*.json`), optional `index.jsonl` and `claims.jsonl`
- `GZMO/.gzmo_dropzone_index.json` — optional SHA256 → first-ingest map for Dropzone dedup (when `GZMO_DROPZONE_DEDUP` is on)

Important operational invariant:
- **Vault `docs/**` is excluded from default retrieval** unless explicitly referenced (keeps “human docs” from polluting RAG by default).

---

## Profiles / safe modes

Use `GZMO_PROFILE` to enable subsets of functionality for debugging or weak hardware.

| Profile | Chaos pulse | Dreams / self-ask | Wiki consolidate | Notes |
|---------|-------------|-------------------|------------------|--------|
| `core` | off | off | off | Tasks + embeddings; no autonomous art loops |
| `standard` | on | off | off | Core + pruning + dashboard pulse |
| `minimal` | off | off | off | Tasks without embedding sync |
| `heartbeat` | on | off | off | Pulse only; no inbox |
| `art` | on | on | **off** | Chaos + dreams + cabinet; wiki auto-cycle off; [Configure](README.md#configure-environment-variables) for `GZMO_AUTO_INBOX_*` defaults |
| `full` | on | on | on | Maximum autonomous subsystems |
| `interactive` | off | off | off | Clarification-first (GAH/DSJ); same task surface as core |

Example:

```bash
cd gzmo-daemon
GZMO_PROFILE=minimal bun run summon
```

(Profiles are implemented in code; explicit `GZMO_ENABLE_*` still overrides.)

**Auto-generated Inbox spam:** Wiki quarantine repairs, dreams, and self-ask can call `createAutoInboxTasks`. Gate with:

- `GZMO_AUTO_INBOX_FROM_WIKI_REPAIR`
- `GZMO_AUTO_INBOX_FROM_SELF_ASK`
- `GZMO_AUTO_INBOX_FROM_DREAMS`
- Hourly budget: `GZMO_AUTO_TASKS_PER_HOUR` (defaults are lower under `GZMO_PROFILE=art` when unset).

**Stale maintenance files:** `./scripts/archive-inbox-noise.sh` (dry-run by default; `--apply` moves matches to `GZMO/Inbox/_archive/…`).

**Shutdown zombies:** Tasks left in `processing` after a timed-out drain are marked `failed`; tune `GZMO_SHUTDOWN_DRAIN_MS`. Boot recovery uses `GZMO_RECOVERY_GRACE_MS` (default 30000).

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

**DGX Spark (128 GB):** see **[`docs/TROUBLESHOOTING_SPARK.md`](docs/TROUBLESHOOTING_SPARK.md)** for a full failure → fix table with links to NVIDIA, Ollama, and GitHub issues (empty thinking output, nvfp4 gibberish, embeddings 404, UMA memory, bill citation knobs).

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
- **Tier 2:** LoRA fine-tuning with Unsloth (DGX Spark can train 70B Q-LoRA; inference default remains **Qwen 3.6 MoE** — see [docs/FINE_TUNING.md](docs/FINE_TUNING.md))
- **Tier 3:** Full fine-tuning + custom embedding models
- Importing Safetensors, GGUF, and adapters into Ollama
- GZMO-specific Modelfile templates

For ToT / latency methodology (benchmark harness), see [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md).

---

## Repo contents (what is public)

`gzmo-daemon/` (includes [`.env.example`](gzmo-daemon/.env.example), [`.env.spark.example`](gzmo-daemon/.env.spark.example)), `scripts/` (includes [`setup.sh`](scripts/setup.sh) — see [Which installer?](#which-installer-human-vs-agent); other helpers include `boot-stack.sh`, `doctor-agentic.sh`, `push_learning_to_green.sh`, `start-ollama-optimized.sh`), `install_service.sh`, `README.md`, `AGENTS.md`, `LICENSE`, `.gitignore`, [`.gitattributes`](.gitattributes), [`.editorconfig`](.editorconfig), [`docs/`](docs/) (see [Additional documentation](#additional-documentation)), [`contrib/env-modes/`](contrib/env-modes/README.md) (optional named `.env` fragments), [`.pi/extensions/`](.pi/extensions/) (Pi extension + bundled `gzmo-daemon` skill; JS deps in [`package.json`](.pi/extensions/package.json) and lockfile **`bun.lock`** — run `bun install` in that directory when developing the extension), [`contrib/pi-gzmo-skill/`](contrib/pi-gzmo-skill/README.md) (optional shell/CI inbox helpers). Vault data stays local and is not in git.

---

## Additional documentation

| Document | Purpose |
|----------|---------|
| [`gzmo-daemon/.env.spark.example`](gzmo-daemon/.env.spark.example) | **Blackwell / DGX Spark** — `qwen3.6:35b-a3b-nvfp4`, Dropzone, RAG knobs |
| [`gzmo-daemon/.env.example`](gzmo-daemon/.env.example) | Laptop / generic template (`hermes3:8b`; comments for `qwen3.6:35b-a3b` on ≥24 GB) |
| [`scripts/lib/dgx-spark.sh`](scripts/lib/dgx-spark.sh) | Shared Spark detection + env snippets for installers |
| [`docs/TROUBLESHOOTING_SPARK.md`](docs/TROUBLESHOOTING_SPARK.md) | **DGX Spark** failure → fix matrix (Ollama, Qwen 3.6, GZMO, links) |
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

