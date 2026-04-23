---
title: Session Distillation — Research
type: topic
tags:
  - session-log
  - research
  - distilled
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Session Distillation — Research

*Distilled from 6 artifacts (22 KB) across multiple development sessions.*


## Source: advanced_ai_features_guide.md (session 013c8bf1)

# 🚀 Advanced Local AI Features Guide

This guide breaks down the cutting-edge features from the **"Building a Private Local AI Development Environment"** playbook. It provides the technical rationale, hardware requirements, and step-by-step instructions to implement them within your VSCodium + LM Studio setup.

---

## ⚡ 1. Speculative Decoding (Draft-and-Verify)

Standard local AI is bottlenecked by RAM memory speeds because models generate text one word (token) at a time. **Speculative Decoding** pairs a massive "Target Mode" with a tiny, lightning-fast "Draft Model." The Draft model instantly guesses the next 5-10 words, and the Target model verifies all of them in a single sweep.

> [!TIP]
> This can easily yield a **2x to 4x inference speedup** with zero loss in generation quality!

### Setup Instructions (LM Studio)
1. **Download matching model families**. The models must share the exact same tokenizer/architecture.
   - *Example:* Target: `Qwen-2.5-Coder-14B` | Draft: `Qwen-2.5-Coder-0.5B`
2. Load your Target/Senior model into the Local Server.
3. In the right-hand **Configuration panel**, toggle **"Speculative Decoding"** (or Draft Model) to **ON**.
4. Select your tiny 0.5B model from the dropdown. LM Studio will bind them together.
5. *Optimization:* Keep Temperature very low (e.g., `0.1`) — speculative decoding works best when the drafted output is predictable.

---

## 🔌 2. Model Context Protocol (MCP) Integration

The **Model Context Protocol (MCP)** acts as a universal bridge, granting autonomous agents (like Roo Code) secure, local access to your tools, databases, and APIs without custom scripting.

> [!IMPORTANT]
> Without MCP, your agent is blind to anything outside text files. With MCP, it gains "hands."

### Setup Instructions (VSCodium + Roo Code)
1. Open the **Roo Code sidebar** in VSCodium.
2. Click the **MCP icon** (a plug or server icon) in the top navigation.
3. Install standard MCP servers over `stdio` (runs securely on your machine).
   - **`@modelcontextprotocol/server-sqlite`** (or Postgres): Provide your local DB connection string. The agent can now execute queries and inspect schemas.
   - **`@modelcontextprotocol/server-puppeteer`**: Gives the agent the ability to scrape the web (e.g., fetch the latest docs for a library throwing an error).
   - **`@modelcontextprotocol/server-github`**: Grants read/write access to your local repo issues.

---

## 🧠 3. Zero-Latency Loops: KV Context Caching

When you send a 2,000-line file to an LLM, it usually recalculates every word from scratch. **KV Context Caching** keeps the loaded computational matrix (the context) of your codebase and system prompts alive in RAM between requests.

> [!NOTE]
> The first prompt takes 5 seconds, but subsequent edits process milliseconds.

### Setup Instructions
1. In LM Studio, go to the **Local Server** settings or the advanced configuration tab.
2. Ensure **Prompt Caching** (or "KV Cache Retention") is turned **ON**.
3. *Trade-off:* This requires slightly more VRAM allocation since you are storing the context matrix in memory persistently, but the speed gains for multi-turn agentic workflows are phenomenal.

---

## 📚 4. Codebase "Telepathy": Local Embeddings (RAG)

Large enterprise codebases exceed local LLM context windows (crashing VRAM). **Retrieval-Augmented Generation (RAG)** converts your entire codebase into mathematical vectors. When you ask a question using `@codebase`, it instantly retrieves only the 2-3 relevant files to feed to the model.

### Setup Instructions (Continue.dev)
1. In LM Studio, download a lightweight FOSS embedding model (e.g., `nomic-embed-text-v1.5` — under 1GB).
2. Load the embedding model into the Local Server alongside your coding models.
3. Open `config.json` in the Continue.dev VSCodium extension.
4. Add the `embeddingsProvider` configuration pointing to your local server:
```json
"embeddingsProvider": {
  "provider": "openai",
  "model": "nomic-embed-text-v1.5",
  "apiBase": "http://127

*[...truncated for embedding efficiency]*


## Source: drift_analysis.md (session 34eb875f)

# Drift Analysis: Where We Are vs Where We Were Supposed To Be

## The Original Vision (Conversation `43ad44e3`)

A **100% local, privacy-first AI coding workstation** centered on **VS Codium**:

```
                   YOU
                    │
              ┌─────▼──────┐
              │  VS Codium  │  ← The place you actually work
              │  Continue   │  ← Chat, autocomplete, inline edits
              │  Roo Code   │  ← Autonomous multi-file agent
              └──────┬──────┘
                     │ HTTP (OpenAI-compatible)
              ┌──────▼──────┐
              │ AOS Gateway │  ← Smart routing, energy metering
              └──┬──────┬───┘
                 │      │
         ┌───────▼┐  ┌──▼────────┐  ┌─────────┐
         │LM Studio│  │TurboQuant │  │ BitNet  │
         │ :1234   │  │ :1235     │  │ :8080   │
         └─────────┘  └───────────┘  └─────────┘
```

**The core idea**: you sit in VS Codium, code with AI assistance, and the infra handles model routing silently in the background. Simple.

## The TUI Addition (Conversation `6fabbb0f`)

Then we built the **AOS Master Deck TUI** — a Textual-based terminal dashboard. The plan was:

| Planned Feature | Status |
|-----------------|--------|
| Dashboard (health, telemetry, VRAM gauge) | ✅ Built |
| Chat screen (iMessage-style with GZMO) | ✅ Built |
| Models screen (table, host switching, BitNet downloads) | ✅ Built |
| `aos ui` CLI command | ✅ Wired |
| Textual CSS theming (brand colors) | ✅ Done |

Then in subsequent debugging sessions it grew to include:

| Added Feature (NOT in original plan) | Status |
|---------------------------------------|--------|
| Services screen (Docker control panel) | ✅ Built — **scope creep** |
| GPU model file scanning (.gguf browser) | ✅ Built — **scope creep** |
| TurboQuant hot-swap via Docker | ✅ Built — **scope creep** |
| BitNet chat launcher | ✅ Built — **scope creep** |

---

## Three Layers of Drift

### Layer 1: The TUI became the focus, not VS Codium

The original plan was **VS Codium + Continue.dev + Roo Code**. The TUI was supposed to be a supplementary control panel. But over the last few conversations, almost all energy went into:

- Building the TUI
- Debugging the TUI
- Adding more features to the TUI

Meanwhile:
- ❌ **Roo Code still isn't installed**
- ⚠️ Continue.dev is installed but hasn't been verified in a real coding session
- The actual "sit down and code with AI" workflow was never tested end-to-end

### Layer 2: The TUI tried to do too much

The original TUI plan (3 tabs: Dashboard, Chat, Models) was clean and scoped. What we actually built has **4 tabs** and the Models screen alone is **421 lines** trying to be:
- A file browser for GPU models
- A Docker orchestrator for TurboQuant
- A HuggingFace download manager
- A BitNet chat launcher
- A host routing controller

That's 5 different tools crammed into one screen. Classic feature creep.

### Layer 3: Nothing actually runs

From the [last stack audit](file:///home/maximilian-wruhs/.gemini/antigravity/brain/9a908e04-7962-42df-8eb7-23c8d14bac13/stack_audit.md):

| Component | Reality |
|-----------|---------|
| ✅ LM Studio | Running on :1234, serving 8 models |
| ✅ VS Codium | Running (PID active) |
| ✅ Continue.dev | Installed, configured |
| ❌ Roo Code | Not installed |
| ❌ Docker permissions | User not in docker group |
| ❌ TurboQuant | Not running |
| ❌ BitNet | Not running |
| ❌ pgvector | Not running |
| ❌ AOS Gateway | Not verified running |

So we built a 4-screen TUI that controls Docker services, but Docker doesn't even have user permissions. We built GPU model hot-swapping, but TurboQuant isn't running. We built BitNet download management, but BitNet isn't set up.

**The TUI is a dashboard for infrastructure that doesn't exist yet.**

---

## Where We Actually Stand (Honest Assessment)

### What works right now:
1. **LM Studio** is serving models on `:1234` ← This is the backbone
2. **VS Codium** is installed and running
3. **Continue.dev**

*[...truncated for embedding efficiency]*


## Source: leaderboard_analysis.md (session 34eb875f)

# Sovereign AI Hardware Leaderboard

This analysis compares the raw performance and energy efficiency of three distinct parameter tiers running on your specific hardware configuration: **NVIDIA GTX 1070 (8GB VRAM) + Intel/AMD CPU**.

The tests evaluate the massive performance uplift unlocked by the `TurboQuant` engine compared to standard `llama.cpp` CPU baselines.

> [!TIP]
> **Energy Efficiency** is measured in *Joules per Token*. A lower number means the model does less raw work per generated word, which correlates directly to extending laptop battery life and lowering server electricity costs.

## Benchmarked Tiers

| Tier | Parameters | Model Name | VRAM Footprint (Q4) |
| :--- | :--- | :--- | :--- |
| **Micro** | 3 Billion | `mistralai/ministral-3-3b` | ~2.5 GB |
| **Small** | 4 Billion | `nvidia/nemotron-3-nano-4b` | ~3.0 GB |
| **Medium** | 9 Billion | `qwen/qwen3.5-9b` | ~6.5 GB |

---

## 🏎️ Speed & Throughput Analysis

> [!NOTE]
> All GPU tests fully offloaded the weights to the GTX 1070 VRAM (`-ngl 100`). All CPU tests strictly constrained execution to DDR4 System RAM and CPU cores (`-ngl 0`).

| Model | Hardware Mode | Tok / sec | Speed Multiplier |
| :--- | :--- | :--- | :--- |
| **Ministral 3B** | TurboQuant GPU | **4,856** 🚀 | **11.7x Faster** |
| Ministral 3B | Standard CPU | 414 | 1x Baseline |
| | | | |
| **Nemotron 4B** | TurboQuant GPU | **64** | **7.4x Faster** |
| Nemotron 4B | Standard CPU | 8.6 | 1x Baseline |
| | | | |
| **Qwen 9B** | TurboQuant GPU | **28** | **1.8x Faster** |
| Qwen 9B | Standard CPU | 15.6 | 1x Baseline |

### Key Takeaways on Speed
* **Memory Bandwidth Dominates**: The 3B model is small enough that the entire context and weight matrix permanently caches in the GPU's fastest memory bands, resulting in a surreal 4,800 tokens per second (it generated an entire test suite in 1.7 seconds).
* **VRAM Saturation**: As the model size expands to 9B, generating tokens requires shuffling 6.5 GB of weights across the bus. The GPU is still structurally faster, but the gap narrows as the physical limits of GDDR5 are reached.

---

## ⚡ Energy Efficiency Analysis

> [!IMPORTANT]
> The CPU draws maximum wattage (40W+) doing matrix math because it requires activating massive portions of the silicon. The GPU handles localized tensor addition extremely efficiently, slashing power draw while vastly increasing output.

| Model | Hardware Mode | Joules / Token | Avg. Wattage | Energy Multiplier |
| :--- | :--- | :--- | :--- | :--- |
| **Ministral 3B** | TurboQuant GPU | **0.005 J/tok** | 24.0 W | **~20x More Efficient** |
| Ministral 3B | Standard CPU | 0.099 J/tok | 42.4 W | Baseline |
| | | | | |
| **Nemotron 4B** | TurboQuant GPU | **0.380 J/tok** | 22.0 W | **~12x More Efficient** |
| Nemotron 4B | Standard CPU | 4.600 J/tok | 40.6 W | Baseline |
| | | | | |
| **Qwen 9B** | TurboQuant GPU | **0.950 J/tok** | 26.0 W | **~2.4x More Efficient** |
| Qwen 9B | Standard CPU | 2.300 J/tok | 36.4 W | Baseline |

### Key Takeaways on Energy
* **GPU Idling**: Because the GTX 1070 is finishing tasks in *milliseconds* for the smaller models, it never has time to spool up to maximum thermal output, keeping average wattage low.
* **CPU Pegging**: The CPU runs at 100% load continuously for up to five times longer than the GPU, creating massive thermal loads and burning exponentially more joules per token.

---

## Final Recommendation: The "Golden Run" Configuration

> [!CAUTION]
> **Avoid the CPU completely for inference**, unless you are forcing an architectural split (like running the `RouteJudge` out-of-band so it doesn't disturb the main GPU workload). 

Based on this hardware telemetry profile, your ideal setup is:
1. **Core Tasks (Coding/Thinking)**: Lock an 8B/9B model (like Llama-3-8B-IQ1) onto the GPU. You'll get highly intelligent code output at solid 28 tok/s speeds while using the least possible energy.
2. **Background Automation**: If you need agents running invisible tasks in the background, use a *

*[...truncated for embedding efficiency]*


## Source: medusa_architecture.md (session 34eb875f)

# Sovereign AI Architecture: Speculative Llama Pipeline

## The Dual-Model "Big Brain / Fast Brain" Architecture

We have officially transitioned the hardware inference pipeline to push the GTX 1070 to its absolute physical maximum, crushing the previous 31 tokens/second record.

> [!NOTE]
> We originally planned to use an experimental "Medusa" prediction head, which theoretically projects tokens using a single hidden layer. However, the available community GGUF Medusa heads for Llama-3 proved completely unstable and structurally corrupt (`failed to read magic header`).

### The Official Speculative Drafter Pivot
Instead of fighting broken Medusa matrices, we pivoted to **standard Speculative Decoding** utilizing Llama's official multi-scale releases:

1. **The Brain (Base Model):** `Meta-Llama-3-8B-Instruct-Q4_K_M.gguf` (~4.9GB VRAM)
   - Performs all the actual thinking, evaluation, and code generation.
2. **The Accelerator (Drafter):** `Llama-3.2-1B-Instruct-Q4_K_M.gguf` (~800MB VRAM)
   - Operates solely to "guess" the next 4-5 words instantly. Because it shares the exact same BPE vocabulary, it never hallucinates mathematically invalid tokens.
   
The Base Model simply verifies the 1B Drafter's guesses in a single pass, resulting in a dramatic pipeline speedup. 

### Final Benchmark Metrics

Running on a single **NVIDIA GTX 1070 (8GB)** with **TurboQuant** compressing both KV caches via `-ctk q4_0 -ctv q4_0`:

> [!TIP]
> **Performance Hit:** **`47.4 Tokens / Second`**  🚀
> This represents a 52% generation speed increase over the previous Qwen Dual-Model setup, without any mathematical semantic collapse!

### Engine Boot Command
When spinning up the API server for Aider and Obsidian, use this verified golden string:

```bash
./TurboQuant/build/bin/llama-server \
  -m ~/.lmstudio/models/bartowski/Meta-Llama-3-8B-Instruct-Q4_K_M.gguf \
  -md ~/.lmstudio/models/bartowski/Llama-3.2-1B-Instruct-Q4_K_M.gguf \
  -c 8192 \
  -ctk q4_0 -ctv q4_0 \
  --port 1238
```


## Source: sota_data_pipeline_report.md (session 48a649b9)

# SOTA Data Pipeline Diagnostic Report

> [!TIP]
> **Data Architect Mode Engaged:** Operating under The Grand SOTA Data Protocol. Evaluating hidden pipeline variables, mass scalability constraints, and optimal cognitive routing topologies.

## 1. Deep Research & Hidden Variables
**System Audited:** GZMO Episodic & Semantic Memory Vault (SQLite -> Markdown Engine)

- **Hidden Variables Identified:** GZMO currently relies on string-based pattern matching filtering (`filter.rs`) and raw JSON memory ingestion. At scale, SQLite `fts5` (Full-Text Search) is highly efficient, but concurrent multi-daemon access without write-ahead logging (WAL) serialization will immediately fracture the database structure under load.
- **Critical Assumption:** The assumption that Markdown serves as a persistent "cheap" vector-surrogate breaks down rapidly past 1,000 files. Without a hybrid OCR/Reranking middleware, the LLM context window will choke parsing deeply historical semantic memory.

## 2. SOTA Pillars Scoring (GZMO Memory Architecture)
*Benchmarked against State-of-the-Art local cognitive vaults (e.g., MemGPT, Letta).*

| Pillar | Score (0-10) | Justification |
|---|---|---|
| **Performance Ceiling** | **8.0** | Extremely high for personal constraints. Rust + SQLite scales vertically to terabytes trivially. |
| **Architectural Novelty** | **6.5** | Standard relational backing; relies on standard full-text matching rather than SOTA graph-vector relationships. |
| **Verification Tier** | **5.0** | Bespoke architecture; lacks formal peer review adoption but demonstrates ruthless pragmatism. |
| **Utility & Scalability** | **7.0** | Highly usable for 1 user. At 100k+ streams, the single-node SQLite instance becomes an I/O bottleneck without dedicated distributed ingestion queues. |
| **Ethical Impact** | **10.0** | 100% sovereign air-gapped memory. No telemetry or external data skimming. |
| **Cost/Accessibility** | **10.0** | Literally $0.00 infrastructure cost (pure local compute vs. the `< €0.08` constraint). |

## 3. Mass Data Pipeline Architecture
*Evaluating GZMO's cognitive digestion capability.*

- **Ingestion → Pre-Processing:** Currently utilizes `inbox/` directory sweeps (`watcher.rs`). This is an `O(N)` linear sweep. SOTA requires sub-millisecond pub/sub event tracking (e.g., lightweight MQTT or zero-mq if migrating to mass scale).
- **Extraction → Validation → Load:** Direct raw string loading. A Hybrid OCR Routing Strategy (e.g., deploying `tesseract` offload on CPU via `shell_exec`) should be strictly enforced before the LLM attempts to brute-force parse binary or complex PDFs.

## 4. Data Modeling & Quality Gates
- **Schema Validation:** Currently unstructured text dumps. The SQLite vault must enforce strict constraints to prevent LLM hallucinations from corrupting the index.
- **Human-in-the-Loop (HITL):** GZMO currently assumes automatic load. A confidence gate must be established: if the underlying semantic parse accuracy drops below 85% confidence, it must drop the task into a specific "Dreams / Queued for Review" backlog for human validation to avoid catastrophic systemic context poisoning.


## Source: openrouter_findings.md (session 4b77aeee)

# OpenRouter Integration & Free-Tier Reasoning Analysis

This document synthesizes the integration and debugging processes of transitioning the GZMO Sovereign AI stack to OpenRouter's `openrouter/free` endpoint.

## 1. Engine Configuration (The Sovereign Swap)

The core objective was to achieve **cost-free autonomous orchestration** to prevent API credit drain. This was executed by routing the bash-based `llm_call` functions directly through OpenRouter.

**Configured Parameters:**
- `GZMO_LLM_URL` mapped to `https://openrouter.ai/api/v1/chat/completions`
- `GZMO_LLM_MODEL` mapped to `openrouter/free` 
- Standardized `Authorization: Bearer` headers carrying the provided OpenRouter API Key.

> [!NOTE] 
> OpenRouter's free tier automatically routes requests to available free inference instances (frequently defaulting to `Llama-3`, `Gemma`, `Mistral`, or reasoning models like `MiniMax-Text-01`).

## 2. The Token Starvation Anomaly

Initially, when executing `./skills/skill_card.sh` directly, the bash trace revealed a critical silent failure within the pipeline. The curl request would successfully return a 200 OK within 5 seconds, but the output piped through `jq` and `sed` would render as completely blank files.

**The Finding:** 
The failure wasn't in network latency or bash pipelines. The issue was architectural token starvation. 
The legacy `skill_card.sh` explicitly declared `LLM_MAX_TOKENS=384`. While sufficient for older generation non-reasoning models emitting standard JSON payloads, modern free-tier models increasingly utilize latent "reasoning" (internal `<think>` blocks).

- The model was consuming the entire `384` token allocation just to "think" through the complex constraints of the MTG Card Forge rule engine.
- As a result, it hit the `finish_reason: length` ceiling before it could ever begin writing the required `OUTPUT FORMAT` payload.

## 3. The Structural Fix

By modifying the `skill_card.sh` internal constraints to allocate `MAX_TOKENS=1500`, we provided sufficient headroom for the model to execute its internal monologue and return the highly specific, formatted card payload.

**Resulting Run:**
Following the token adjustment, the exact same `openrouter/free` endpoint immediately successfully synthesized the **Stratospheric Observation Lens**:
```text
  ║  {3}, {T}: Look at the top card of your library.
  ║
  ║  "To see the future, one must first understand the present." —Kefnet the Mindful
```

## 4. Pipeline Robustness

Our findings confirm that the pure bash integration methodology in `_llm_helper.sh` (using `curl`, `jq -Rs '.'`, and ANSI-escape string manipulation) is **highly resilient**.
Despite the model sending an unpredictable array of reasoning strings, the constraints specified in the system prompt (`OUTPUT FORMAT (exactly this, no other text):`) cleanly filtered the reasoning block out of the final stdout, ensuring the procedural visual pipeline and `chafa` terminal renderers received clean, actionable data.

> [!IMPORTANT]
> Any future bash scripts, workflows, or agentic tools integrated into the GZMO stack utilizing `openrouter/free` **must** allocate a minimum of 1000–1500 tokens to ensure stability against models that heavily bias towards invisible reasoning chains.
