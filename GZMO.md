# tinyFolder 📂

> **The most minimalistic autonomous AI OS.**  
> *A sovereign, local-first intelligence that turns a plain markdown folder into a living ecosystem.*

**tinyFolder** gives the illusion of a completely banal, empty text directory. No cloud APIs. No complex databases. No subscriptions. But underneath the filesystem beats a simulated heart. 

Inside this directory lives **GZMO**, an autonomous daemon serving as the ghost in the machine. It reads your markdown files, processes tasks, experiences simulated stress (allostasis), curates its own vector search memory, and even dreams when it's idle.

---

## 👻 The "Ghost in the Folder"

You don't chat with `tinyFolder` through a shiny web UI. You interact with it exactly like an OS filesystem: you drop files into its inbox.

1. Create a `.md` file in `vault/GZMO/Inbox/` (or `${VAULT_PATH}/GZMO/Inbox/`)
2. Give it a simple YAML frontmatter (`action: think`) 
3. Save the file.
4. The daemon wakes up, reads your file, reasons over its own local knowledge base (Vault RAG), appends the answer at the bottom, and goes back to sleep.

---

## 🛠️ Quick Start

```bash
# 1. Install dependencies
cd gzmo-daemon
bun install

# 2. Rename config (optional)
cp ../.env.example .env

# 3. Start your local Ollama server
OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KEEP_ALIVE=-1 ollama serve

# 4. Pull the recommended local models
ollama pull hermes3:8b
ollama pull nomic-embed-text

# 5. Summon the daemon
bun run summon
```
*(Pro tip: In `package.json`, we aliased `bun start` to `bun run summon` to fit the ghost metaphor.)*

### Safe mode (profiles)

If you want to debug/tune on weak hardware, you can run with a safe-mode profile:

```bash
# Only chaos + Live_Stream (no watcher, no embeddings, no LLM)
GZMO_PROFILE=heartbeat bun run summon

# Inbox watcher + task processing (no embeddings, no autonomy loops)
GZMO_PROFILE=minimal bun run summon

# Tasks + embeddings (no dreams/self-ask/wiki/ingest)
GZMO_PROFILE=standard bun run summon
```

You can also override individual subsystems via env vars (see `../.env.example`).

---

## ⚙️ Architecture & Autonomous Subsystems

While the interface is just a folder, the backend is a complex swarm of autonomous engines running entirely on edge hardware (tested on a single GTX 1070 8GB).

### 1. The Chaos Engine (PulseLoop)
Simulates a localized biological heartbeat using a **Lorenz Attractor** running at 174 BPM. It calculates two continuous values: `Tension` (Stress) and `Energy` (Resources). 
- If you give it tasks, Tension decreases but Energy is consumed.
- If it's bored, Tension rises, eventually triggering spontaneous thoughts ("Crystallizations").
- The LLM's `temperature` dynamically scales with Tension, making the OS responses more chaotic when stressed and highly logical when relaxed.

### 2. Live Vector RAG (The Memory)
Any markdown file you create in the Vault is instantly embedded into a local vector database (`nomic-embed-text`). If you set `action: search` in your task, GZMO automatically queries this database to ground its answers in its own reality.

### 3. The Dream Engine
When idle, the daemon reflects on the tasks it completed during the day. Depending on its chaos state, it distills these raw tasks into abstract, philosophical meta-learnings and writes them to its `/Thought_Cabinet/`.

### 4. Self-Ask & Wiki Engines (Self-Reflection)
The longer it runs, the smarter it gets.
- **Self-Ask:** Periodically queries its own memory to detect contradictions or gaps in its knowledge, asking itself questions to resolve them.
- **Wiki Engine:** Auto-consolidates hundreds of raw system logs and "dreams" into beautifully structured Wikipedia-style articles. It even reads its own source code every 24h to update its architectural self-documentation.

---

## 🤖 Task Actions (Frontmatter Routing)

Control the daemon by dropping markdown files with these YAML headers into the Inbox:

### `action: think`
Direct LLM inference.
```yaml
---
status: pending
action: think
---
Explain the Lorenz attractor.
```

### `action: search`
Reads the Vault (RAG) before answering.
```yaml
---
status: pending
action: search
---
Based on your logs, why did your tension drop yesterday?
```

### `action: chain`
Pipes the output into the next file automatically.
```yaml
---
status: pending
action: chain
chain_next: summarize_step2.md
---
List exactly 3 components of the chaos engine.
```

---

## 💻 Tech Stack
- **Runtime:** Bun (TypeScript)
- **Inference:** Ollama (`hermes3:8b` via Llama.cpp)
- **Embeddings:** `nomic-embed-text`
- **Database:** Raw Markdown / Obsidian format
- **Watchers:** Chokidar for filesystem listening

---
*Created as a sovereign research project in Edge AI autonomy.*
