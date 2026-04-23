<a name="top"></a>

<h1 align="center">tinyFolder</h1>

<p align="center">
  <strong>The most minimalistic autonomous AI “OS” — a local-first daemon that lives inside a plain Markdown vault.</strong>
</p>

<p align="center">
  <a href="https://img.shields.io/badge/runtime-Bun-000000?style=flat-square&logo=bun"><img alt="Runtime: Bun" src="https://img.shields.io/badge/runtime-Bun-000000?style=flat-square&logo=bun"></a>
  <a href="https://img.shields.io/badge/LLM-Ollama-000000?style=flat-square"><img alt="LLM: Ollama" src="https://img.shields.io/badge/LLM-Ollama-000000?style=flat-square"></a>
  <a href="https://img.shields.io/badge/storage-Markdown%20files-0969DA?style=flat-square"><img alt="Storage: Markdown files" src="https://img.shields.io/badge/storage-Markdown%20files-0969DA?style=flat-square"></a>
</p>

---

## Overview

`tinyFolder` is a repo that looks like “just a folder”, but contains **GZMO**: an autonomous, filesystem-driven AI daemon.

You don’t use a chat UI. You **drop Markdown tasks into an inbox folder** and the daemon reads them, routes them by YAML frontmatter (`action: think | search | chain`), writes answers back into the same files, and continues running in the background.

### Highlights

- **Local-first**: everything is files on disk (no cloud DB required).
- **Vault RAG**: indexes your vault into embeddings for grounded answers.
- **Autonomy loops**: pulse/chaos + dreams + self-ask + wiki consolidation.
- **Obsidian-friendly**: works naturally with a vault layout.

---

## Table of contents

- [Quick start](#quick-start)
- [How to use (drop a task file)](#how-to-use-drop-a-task-file)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Repo layout](#repo-layout)

---

## Quick start

### Prerequisites

- **Bun** installed (TypeScript runtime)
- **Ollama** installed and running locally

### Install + run

```bash
# 1) Install dependencies
bun install

# 2) Configure (optional)
cp .env.example .env

# 3) Start Ollama (in a separate terminal)
OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KEEP_ALIVE=-1 ollama serve

# 4) Pull models (recommended defaults)
ollama pull hermes3:8b
ollama pull nomic-embed-text

# 5) Start the daemon
bun run summon
```

[Back to top](#top)

---

## How to use (drop a task file)

Tasks are Markdown files with YAML frontmatter. The daemon watches:

- `vault/GZMO/Inbox/`

Create a file like `vault/GZMO/Inbox/my-task.md`:

```yaml
---
status: pending
action: think
---
Explain the Lorenz attractor in one paragraph.
```

Save the file. The daemon will claim it, run, and append output.

[Back to top](#top)

---

## Configuration

GZMO reads environment variables (via `./.env` if you use one):

- **`VAULT_PATH`**: absolute path to your vault. If not set, defaults to this repo’s `./vault`.
- **`OLLAMA_URL`**: Ollama base URL (default `http://localhost:11434`).
- **`OLLAMA_MODEL`**: inference model tag (default `hermes3:8b`).
- **`GZMO_PROFILE`**: safe-mode profile (`heartbeat | minimal | standard | full`). Defaults to `full`.

Optional overrides (all `0/1`, `false/true` supported):

- **`GZMO_ENABLE_INBOX_WATCHER`**
- **`GZMO_ENABLE_TASK_PROCESSING`**
- **`GZMO_ENABLE_EMBEDDINGS_SYNC`**
- **`GZMO_ENABLE_EMBEDDINGS_LIVE`**
- **`GZMO_ENABLE_DREAMS`**
- **`GZMO_ENABLE_SELF_ASK`**
- **`GZMO_ENABLE_WIKI`**
- **`GZMO_ENABLE_INGEST`**
- **`GZMO_ENABLE_WIKI_LINT`**
- **`GZMO_ENABLE_PRUNING`**
- **`GZMO_ENABLE_DASHBOARD_PULSE`**

[Back to top](#top)

---

## Troubleshooting

### Sanity check your setup

Run the built-in doctor:

```bash
bun run doctor
```

If you want the doctor to run write-enabled pipeline checks (it will create temporary inbox tasks), run:

```bash
bun run doctor --write --profile deep
```

### Ollama unreachable

The daemon will keep running its heartbeat/logging even if Ollama is down, but inference + embeddings will be disabled until Ollama is reachable.

[Back to top](#top)

---

## Repo layout

- `src/`: the Bun/TypeScript daemon sources (entrypoint: `index.ts`)
- `vault/`: example/default vault layout (includes `vault/GZMO/Inbox/`)

[Back to top](#top)

