---
title: Session Distillation — Models
type: topic
tags:
  - session-log
  - models
  - distilled
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Session Distillation — Models

*Distilled from 7 artifacts (40 KB) across multiple development sessions.*


## Source: model_compatibility.md (session 048e720e)

# GTX 1070 8GB VRAM — Model Compatibility Matrix

**Hardware**: NVIDIA GeForce GTX 1070 · 8192 MiB VRAM · CUDA 12.2
**Usable VRAM**: ~7.5 GB (after OS/desktop compositor reservation)
**KV Cache overhead**: ~200–500MB depending on context length and batch size

---

## Full Model Inventory (Sorted by Size)

| # | Model | Quant | Size (GB) | Fits 8GB Solo? |
|---|-------|-------|-----------|-----------------|
| 1 | Qwen 3.5-35B-A3B | Q4_K_M | **19.7** | ❌ |
| 2 | Gemma 4 E4B-it | F16 | **14.0** | ❌ |
| 3 | Gemma 4 E4B-base | F16 | **14.0** | ❌ |
| 4 | Gemma 4 E2B-it | F16 | **8.7** | ❌ |
| 5 | Gemma 4 E2B-base | F16 | **8.7** | ❌ |
| 6 | Tifa-DeepsexV2-7B | Q8 | **7.5** | ⚠️ Borderline |
| 7 | Mistral Nemo 12B | Q4_K_M | **5.8** | ✅ Tight |
| 8 | Qwen 3.5-9B Claude-dist | Q4_K_M | **5.2** | ✅ |
| 9 | Qwen 3.5-9B | Q4_K_M | **5.2** | ✅ |
| 10 | Gemma 4 E4B-it | Q4_K_M | **5.0** | ✅ |
| 11 | Gemma 4 E4B-base | Q4_K_M | **5.0** | ✅ |
| 12 | DeepSeek-R1 Qwen3-8B | Q4_K_M | **4.7** | ✅ |
| 13 | Llama 3.1-8B Instruct | Q4_K_M | **4.6** | ✅ |
| 14 | Llama 3-8B Instruct | Q4_K_M | **4.6** | ✅ |
| 15 | Ministral 8B | Q4_K_M | **4.6** | ✅ |
| 16 | Qwen 2.5-7B Instruct | Q3_K_M | **3.5** | ✅ |
| 17 | BitNet Llama3-8B 1.58b | i2_s | **3.6** | ✅ |
| 18 | Gemma 4 E2B-it | Q4_K_M | **3.2** | ✅ |
| 19 | Gemma 4 E2B-base | Q4_K_M | **3.2** | ✅ |
| 20 | Nemotron 3 Nano 4B | Q4_K_M | **2.6** | ✅ |
| 21 | Qwen 3-4B | Q4_K_M | **2.3** | ✅ |
| 22 | Qwen 3-4B Thinking | Q4_K_M | **2.3** | ✅ |
| 23 | Ministral 3B | Q4_K_M | **2.0** | ✅ |
| 24 | Custom Qwen 3B | Q4_K_M | **1.8** | ✅ |
| 25 | Custom Qwen Drafter | F16 | **0.9** | ✅ |
| 26 | Llama 3.2-1B Instruct | Q4_K_M | **0.8** | ✅ |
| 27 | Qwen 2.5-0.5B Instruct | Q8_0 | **0.5** | ✅ |
| 28 | Custom Qwen Drafter | Q8_0 | **0.5** | ✅ |

### Multimodal Projection Files (loaded additionally for VLM)

| mmproj File | Size (GB) |
|-------------|-----------|
| Qwen 3.5-9B Claude mmproj | 0.86 |
| Qwen 3.5-9B mmproj | 0.86 |
| Qwen 3.5-35B-A3B mmproj | 0.84 |
| Ministral 3B mmproj | 0.78 |

> [!WARNING]
> **Gemma4 E2B Q8_0** (`gemma4_e2b.Q8_0.gguf`) is only 501MB — this is almost certainly a **truncated/corrupt file**. A real Q8_0 of a 2B model should be ~2.5-3GB. Do not rely on it.

---

## Group A: Standalone GPU-Only Models (Fit in 8GB VRAM)

These models load entirely into VRAM with room for KV cache at reasonable context lengths (2048-4096 tokens).

### Tier 1 — Best Quality That Fits
| Model | Size | Headroom for KV | Notes |
|-------|------|-----------------|-------|
| Gemma 4 E4B-it Q4_K_M | 5.0 GB | ~2.5 GB | **Best overall.** 4B effective params, instruct-tuned |
| Qwen 3.5-9B Q4_K_M | 5.2 GB | ~2.3 GB | Strong general-purpose 9B |
| Qwen 3.5-9B Claude-dist Q4_K_M | 5.2 GB | ~2.3 GB | Claude-distilled reasoning variant |
| DeepSeek-R1 Qwen3-8B Q4_K_M | 4.7 GB | ~2.8 GB | Strong reasoning/R1 distillation |

### Tier 2 — Comfortable Fit
| Model | Size | Notes |
|-------|------|-------|
| Ministral 8B Q4_K_M | 4.6 GB | Good for code, follows instructions well |
| Llama 3.1-8B Instruct Q4_K_M | 4.6 GB | Solid general purpose |
| Qwen 2.5-7B Instruct Q3_K_M | 3.5 GB | More aggressive quant, quality tradeoff |
| BitNet Llama3-8B i2_s | 3.6 GB | 1.58-bit, needs BitNet runtime (CPU-only) |

### Tier 3 — Small/Drafter Class
| Model | Size | Notes |
|-------|------|-------|
| Gemma 4 E2B-it Q4_K_M | 3.2 GB | Good small instruct model |
| Nemotron 3 Nano 4B Q4_K_M | 2.6 GB | NVIDIA's efficient 4B |
| Qwen 3-4B Q4_K_M | 2.3 GB | Drafter or lightweight tasks |
| Qwen 3-4B Thinking Q4_K_M | 2.3 GB | CoT reasoning variant |
| Ministral 3B Q4_K_M | 2.0 GB | Good drafter |
| Custom Qwen 3B Q4_K_M | 1.8 GB | Your fine-tuned model |
| Llama 3.2-1B Q4_K_M | 0.8 GB | Ultra-light drafter |
| Qwen 2.5-0.5B Q8_0 | 0.5 GB | Smallest drafter |

### Tier 4 — Borderline / Not Recommended Solo
| Model | Size | Issue |
|-------|------|-------|
| Mistral Nemo 12B Q4_K_M | 5.8 GB | Fits but KV cache limited to ~1.7GB → short cont

*[...truncated for embedding efficiency]*


## Source: benchmark_analysis.md (session 28039f68)

# AOS Benchmark Results Analysis

> [!NOTE]
> Data from [benchmark_results.json](file:///home/maximilian-wruhs/Dokumente/Playground/AOS/data/benchmark_results.json) (105 KB, 4189 lines)

## Overview

**17 total benchmark runs** across **6 models** and **4 test suites**, spanning from March 25 to March 29, 2026.

---

## Runs by Model

| Model | Runs | Suites Tested | Best Quality | Worst Quality |
|-------|------|---------------|-------------|--------------|
| `qwen2.5-coder:7b` | 1 | math | 0.867 | 0.867 |
| `qwen2.5-coder:1.5b` | 1 | math | 0.800 | 0.800 |
| `qwen2.5-0.5b-instruct` | 7 | math, factual, reasoning, code | 0.667 | 0.000 (code) |
| `qwen/qwen3.5-9b` | 1 | reasoning | 0.000 | 0.000 |
| `tifa-deepsexv2-7b-mgrpo` | 1 | reasoning | 0.100 | 0.100 |
| `nvidia/nemotron-3-nano-4b` | 4 | standard, math, factual, reasoning, code | 0.933 | 0.000 |
| `qwen/qwen3.5-35b-a3b` | 1 | math | 0.200 | 0.200 |
| `mistralai/ministral-3-3b` | 4 | math, factual, code | 0.733 | 0.000 (code) |

## Runs by Suite

| Suite | Runs | Tasks per Run |
|-------|------|---------------|
| math | 7 | 15 |
| factual | 5 | 15 |
| reasoning | 6 | 10 |
| code | 3 | 10 |
| standard (all) | 1 | 50 |

---

## Full Timeline

| Timestamp | Model | Suite | Quality | Z-Score | Tasks | Time | Energy |
|-----------|-------|-------|---------|---------|-------|------|--------|
| 2026-03-25 14:06 | qwen2.5-coder:7b | math | **0.867** | 0.0972 | 15 | 19.4s | 48.0 J |
| 2026-03-25 14:19 | qwen2.5-coder:1.5b | math | **0.800** | 0.1846 | 15 | 8.7s | 23.4 J |
| 2026-03-29 11:43 | qwen2.5-0.5b-instruct | factual | 0.667 | 0.3741 | 15 | 1.4s | 7.5 J |
| 2026-03-29 11:44 | qwen2.5-0.5b-instruct | factual | 0.667 | 0.2634 | 15 | 2.7s | 10.7 J |
| 2026-03-29 11:45 | qwen2.5-0.5b-instruct | reasoning | 0.480 | 0.0214 | 10 | 25.1s | 94.7 J |
| 2026-03-29 11:46 | qwen2.5-0.5b-instruct | reasoning | 0.600 | 0.0260 | 10 | 24.1s | 97.5 J |
| 2026-03-29 12:55 | qwen/qwen3.5-9b | reasoning | ⛔ 0.000 | 0.0000 | 10 | 2.0s | 4.1 J |
| 2026-03-29 12:56 | tifa-deepsexv2-7b-mgrpo | reasoning | ⛔ 0.100 | 0.0003 | 10 | 368.3s | 2273.7 J |
| 2026-03-29 13:18 | nvidia/nemotron-3-nano-4b | standard | ⛔ 0.000 | 0.0000 | 50 | 132.5s | 379.1 J |
| 2026-03-29 16:00 | nvidia/nemotron-3-nano-4b | math | ⛔ 0.000 | 0.0000 | 15 | 21.4s | 58.8 J |
| 2026-03-29 16:11 | qwen/qwen3.5-35b-a3b | math | 0.200 | 0.0006 | 15 | 350.8s | 3210.4 J |
| 2026-03-29 16:17 | mistralai/ministral-3-3b | math | 0.667 | 0.5012 | 15 | 2.9s | 13.3 J |
| 2026-03-29 16:17 | mistralai/ministral-3-3b | math | 0.667 | 0.4217 | 15 | 2.3s | 15.8 J |
| 2026-03-29 16:18 | mistralai/ministral-3-3b | factual | **0.733** | 0.7094 | 15 | 1.9s | 10.3 J |
| 2026-03-29 16:18 | mistralai/ministral-3-3b | factual | **0.733** | **0.7481** | 15 | 1.9s | 9.8 J |
| 2026-03-29 16:18 | mistralai/ministral-3-3b | code | ⛔ 0.000 | 0.0000 | 10 | 13.3s | 50.6 J |
| 2026-03-29 16:19 | nvidia/nemotron-3-nano-4b | code | ⛔ 0.000 | 0.0000 | 10 | 36.6s | 120.9 J |
| 2026-03-29 16:19 | nvidia/nemotron-3-nano-4b | math | **🏆 0.933** | 0.1066 | 15 | 23.5s | 87.3 J |
| 2026-03-29 16:20 | nvidia/nemotron-3-nano-4b | factual | **🏆 0.933** | 0.1216 | 15 | 22.4s | 76.6 J |
| 2026-03-29 16:20 | nvidia/nemotron-3-nano-4b | reasoning | ⛔ 0.000 | 0.0000 | 10 | 60.1s | 188.5 J |
| 2026-03-29 16:22 | qwen2.5-0.5b-instruct | math | 0.533 | 0.3600 | 15 | 3.6s | 14.8 J |
| 2026-03-29 16:22 | qwen2.5-0.5b-instruct | code | ⛔ 0.000 | 0.0000 | 10 | 18.8s | 75.0 J |
| 2026-03-29 16:23 | qwen2.5-0.5b-instruct | factual | 0.667 | **0.9787** | 15 | 1.2s | 6.8 J |
| 2026-03-29 16:23 | qwen2.5-0.5b-instruct | reasoning | 0.460 | 0.0496 | 10 | 23.7s | 92.5 J |

---

## Key Findings

### 🏆 Quality Champions (by suite)
| Suite | Best Model | Quality | 
|-------|-----------|---------|
| **Math** | nvidia/nemotron-3-nano-4b | **93.3%** |
| **Factual** | nvidia/nemotron-3-nano-4b | **93.3%** |
| **Reasoning** | qwen2.5-0.5b-instruct | **60.0%** |
| **Code** | ⛔ All models scored **0.0%*

*[...truncated for embedding efficiency]*


## Source: edge_node_model_candidates.md (session 57af45bf)

# Edge-Node Model Evaluation (GTX 1070 - 8GB VRAM)

This artifact documents the evaluation of models found on the external SSD (`/media/maximilian-wruhs/Extreme SSD/LLM_Models_Export`), specifically tailored to the constraints of the GZMO Edge-Node hardware:

**Hardware & Software Constraints:**
- GPU: Nvidia GTX 1070 (8GB VRAM)
- Architecture: `sm_61` (Requires older PyTorch 2.4.x)
- Training: Unsloth pinned to version `2024.11.8`

---

## 🏆 Candidate 1: Qwen 2.5 3B Instruct (Unsloth BNB 4-bit)
*Path: `models--unsloth--qwen2.5-3b-instruct-bnb-4bit`*

This model is pre-quantized for LoRA training and stands out as the optimal choice for the current agent setup.

> [!TIP]
> **Best Overall Choice:** Delivers the best balance of context, intelligence, and VRAM safety for autonomous background training. 

**PRO:**
- **Maximum Compatibility:** Designed to harmonize flawlessly with Unsloth `2024.11.8` without triggering CUDA Kernel mismatches.
- **VRAM Efficiency:** The 3B parameter model in 4-bit occupies only ~2.5GB base VRAM. During fine-tuning with AdamW 8-bit, memory usage remains safely around 4.5GB - 5.5GB, easily fitting the 8GB limit.
- **Intelligence:** Extremely strong at strict formatting, code reading, and JSON parsing — perfectly suited for GZMO's structured agent loop.

**CONTRA:**
- Tone defaults to highly technical language, which might require slightly stronger prompting for creative/informal chat.

---

## 🥈 Candidate 2: Gemma 4 E2B
*Path: `models--google--gemma-4-E2B-it`*

The 2-Billion parameter iteration of the originally intended model family.

> [!WARNING]
> **High Risk for Autonomous Training:** The underlying software stack might not natively support this new architecture.

**PRO:**
- Easily fits into 8GB VRAM.
- Existing `SOUL.md` and system prompts are already tailored to Gemma's strict logical reasoning behaviors.

**CONTRA:**
- **The Unsloth Barrier:** Because the underlying PyTorch version forces the use of a frozen Unsloth build (`2024.11.8`), training this new architecture will likely fail due to missing or unoptimized CUDA logic, either crashing with OOM or generating garbage outputs.

---

## 🥉 Candidate 3: Mistral 7B Instruct v0.3
*Path: `models--unsloth--mistral-7b-instruct-v0.3-bnb-4bit`*

The long-time gold standard for 8GB GPUs.

> [!CAUTION]
> **Context Window Limits:** Training larger 7B models on an 8GB card leaves almost zero room for contextual memory.

**PRO:**
- Extremely stable Unsloth integration; guaranteed to compile and work.
- Phenomenal instruction following capabilities.

**CONTRA:**
- **Living on the Edge:** Even in 4-bit, a 7B model takes ~4.5GB of base VRAM. Launching the training optimizer and processing long "Dream" contexts will instantly max out the 8GB limit and cause an Out-Of-Memory (OOM) crash, rendering autonomous operation unsafe.

---

## 🧪 Special Mention: BitNet 1.58-bit (Falcon3 / BitNet-b1.58)
*Path: `models--tiiuae--Falcon3-3B-Instruct-1.58bit`*

Ternary weight models utilizing purely -1, 0, and 1 integer states.

**PRO:**
- Astonishing memory efficiency (< 1GB VRAM for 3B parameters) and blazing inference speeds.

**CONTRA:**
- **Not Ready for Stable Training:** Current Unsloth pipelines (especially older builds) cannot natively apply LoRA to these specialized 1.58-bit models out of the box. They are strictly suited for testing inference via `ollama` or `llama.cpp` for now.


## Source: hermes_vs_edgenode.md (session 6d4afca2)

# Hermes Agent vs GZMO Edge-Node — Architectural Treasure Map

## What Is Hermes?

**Hermes Agent** is a full-stack AI agent framework by [Nous Research](https://nousresearch.com/) — a Python-based CLI/gateway agent with massive scope. It's installed locally at:

- **Source**: `/home/maximilian-wruhs/Dokumente/Playground/Hermes/hermes-agent/` (v0.6.0)
- **Runtime state**: `~/.hermes/` (config, sessions, memories, skills, state.db)
- **Last used**: April 1, 2026 — was being pointed at DevStack_v2 as an orchestrator

It was briefly woken up and asked to serve as an orchestrator for the DevStack before you migrated to the current OpenClaw/Chaos Engine architecture.

---

## Architectural Comparison

| Dimension | **Hermes Agent** | **GZMO Edge-Node** |
|-----------|-----------------|---------------------|
| **Language** | Python (8.5K line `run_agent.py`) | TypeScript (OpenClaw + Chaos Engine) |
| **Agent Loop** | Synchronous `while` loop with `max_iterations` budget | Event-driven PulseLoop (174 BPM Lorenz attractor) |
| **Identity** | Static `SOUL.md` (generic) | Dynamic Chaos Engine — Lorenz-seeded personality drift |
| **Memory** | `MEMORY.md` flat file + SQLite FTS5 session search | Thought Cabinet (stochastic crystallization) + Obsidian Vault dreams |
| **Context Management** | Auto-compressor (iterative structured summaries, token-budget tail protection) | Fixed context window, no compression |
| **Tool System** | Python registry (~40 tools across 15 toolsets) | OpenClaw plugin hooks + registered tools |
| **Subagent/Delegation** | Built-in `delegate_tool.py` with parallel batch mode (3 concurrent) | OpenClaw subagent API (single-shot) |
| **MCP Support** | Native MCP client (auto-discovery, stdio + HTTP) | Manual MCP config in OpenClaw |
| **Platforms** | 15+ gateways (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, HomeAssistant, SMS, Email...) | Telegram only (via OpenClaw) |
| **Autonomy Model** | Cron scheduler + session reset timers | Chaos Engine triggers + autonomous_pulse |
| **Research** | arXiv skill (curl-based, Semantic Scholar integration) | Built-in ResearchEngine (Gemini-grounded, budget-tracked) |
| **Search/RAG** | None built-in (relies on web tools) | QMD Hybrid Search (sqlite-vec + GGUF embeddings) |
| **Container** | Docker sandbox for terminal commands only | Full containerized deployment |
| **Theming** | Skin engine (data-driven CLI themes) | N/A |

---

## 🏴‍☠️ Treasures Worth Plundering

### 1. Context Compressor — **HIGH VALUE**

> [!IMPORTANT]
> This is the single biggest missing capability in the edge-node.

Hermes has a sophisticated [context_compressor.py](file:///home/maximilian-wruhs/Dokumente/Playground/Hermes/hermes-agent/agent/context_compressor.py) that:
- **Prunes old tool results** as a cheap pre-pass (no LLM call)
- **Protects head** (system prompt + first exchange) and **tail** (last ~20K tokens)
- **Summarizes middle turns** with structured prompts (Goal, Progress, Decisions, Files, Next Steps)
- **Iteratively updates** the summary across multiple compactions

The Chaos Engine's dreams are essentially night-shift compression, but there's no **live session** compression. Long Telegram conversations with GZMO will eventually hit context limits hard.

**Portability**: Medium — the algorithm is model-agnostic (just needs a cheap LLM call). Could be adapted as an OpenClaw hook on `before_prompt_build` that compresses `messages` when approaching the limit.

---

### 2. Delegation/Subagent Architecture — **HIGH VALUE**

Hermes' [delegate_tool.py](file:///home/maximilian-wruhs/Dokumente/Playground/Hermes/hermes-agent/tools/delegate_tool.py) is battle-tested:
- Spawns **isolated child agents** with restricted toolsets
- Supports **parallel batch mode** (3 concurrent children)
- Has a **depth limit** (max 2 levels deep — no recursive delegation)
- Children get their **own terminal sessions and task_ids**
- Parent only sees the **summary**, never intermediate tool calls

The edge-node's s

*[...truncated for embedding efficiency]*


## Source: model_comparison.md (session bda36f85)

# Modellvergleich: GZMO Edge Node auf GTX 1070 (8GB eGPU)

## Anforderungen

| Kriterium | Wert |
|---|---|
| **VRAM** | 8.192 MiB (GTX 1070 via Thunderbolt eGPU) |
| **Min. Context** | ~20K Tokens (19K System-Prompt + Antwort) |
| **Primärer Use Case** | Autonomer Agent: Tool-Calling, Heartbeat, Wiki-Maintenance, Dreams |
| **KV-Cache** | TurboQuant turbo4 (3.8× Kompression) verfügbar |
| **Inference Engine** | llama.cpp (TurboQuant Fork) |

## VRAM-Budget-Rechnung

```
8.192 MiB Total
- Modell-Weights (quantisiert)
- KV-Cache (turbo4: ~0.13 MiB pro 1K Tokens bei 4B, ~0.3 MiB bei 9B)
- Overhead (~200 MiB)
= verfügbarer Context
```

---

## Die Kandidaten

### 🥇 Gemma 4 E4B-it (Q4_K_M) — **EMPFEHLUNG**

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~5.0 GB |
| Nativer Context | 128K Tokens |
| Freier VRAM nach Modell | ~3.0 GB → **~24K–40K Context mit turbo4** |
| Tool Calling | ✅ **Nativ eingebaut** (nicht prompt-basiert) |
| Thinking Mode | ✅ Ja |
| Multimodal | ✅ Text + Bild + Audio |
| Lizenz | Apache 2.0 |

**Pro:**
- ✅ **Natives Function Calling** — kein Prompt-Engineering nötig, zuverlässiger
- ✅ **Genug VRAM für 24K+ Context** — passt für den 19K System-Prompt
- ✅ Google-Optimierung für Edge-Deployment (genau unser Use Case)
- ✅ Apache 2.0 — volle kommerzielle Freiheit
- ✅ Thinking Mode für komplexe Reasoning-Tasks
- ✅ **Bereits auf der SSD vorhanden** (`gemma-4-E4B-it-Q4_K_M.gguf`, 5.0G)

**Contra:**
- ⚠️ 4B aktive Parameter — weniger "intelligent" als 8-9B Modelle
- ⚠️ Noch relativ neu (April 2026), Community-Erfahrung wächst noch

---

### 🥈 Qwen3-4B (Q4_K_M)

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~2.4 GB |
| Nativer Context | 32K Tokens |
| Freier VRAM nach Modell | ~5.6 GB → **~32K+ Context problemlos** |
| Tool Calling | ✅ Prompt-basiert (gut getestet) |
| Thinking Mode | ✅ Hybrid (toggle thinking on/off) |
| Lizenz | Apache 2.0 |

**Pro:**
- ✅ **Extrem klein** — nur 2.4 GB, massig Headroom für Context
- ✅ Qwen-Familie hat exzellente Coding/Logic-Benchmarks
- ✅ Hybrid Thinking Mode (schnell oder deep, per Request)
- ✅ **Bereits auf SSD vorhanden** (`qwen3-4b.Q4_K_M.gguf`, 2.4G)

**Contra:**
- ⚠️ Nur 4B Parameter — bei komplexen Agentic-Tasks schwächer
- ⚠️ Tool Calling nicht nativ, prompt-basiert = fehleranfälliger

---

### 🥉 Qwen3.5-9B (Q4_K_M) — aktuell installiert

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~5.3 GB |
| Nativer Context | 128K Tokens |
| Freier VRAM nach Modell | ~2.7 GB → **~16K Context mit turbo4** |
| Tool Calling | ✅ Prompt-basiert |
| Thinking Mode | ✅ Ja |
| Lizenz | Apache 2.0 |

**Pro:**
- ✅ Stärkstes Reasoning unter den kleinen Modellen
- ✅ 9B Parameter = spürbar intelligenter als 4B
- ✅ Bereits installiert und getestet

**Contra:**
- ❌ **Context reicht nicht** — 16K max, aber 19K System-Prompt → blockiert
- ❌ Kein Raum für Conversation-History oder Tool-Outputs
- ❌ Nur nutzbar wenn AGENTS.md signifikant gekürzt wird

---

### 4. Qwen3.5-35B-A3B MoE (Q4_K_M)

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~20 GB |
| Aktive Parameter | 3B (MoE) |
| Freier VRAM | ❌ **Passt nicht in 8GB** |

**Pro:**
- ✅ 35B Wissen, 3B Rechenaufwand — theoretisch beste Qualität
- ✅ **Bereits auf SSD** (`qwen3.5-35b-a3b.Q4_K_M.gguf`, 20G)

**Contra:**
- ❌ **20 GB > 8 GB VRAM** — benötigt CPU-Offloading
- ❌ CPU-Inferenz auf Laptop = extrem langsam (3-5 tok/s)
- ❌ Thunderbolt-Bandwidth limitiert GPU-CPU-Kommunikation

---

### 5. DeepSeek-R1-Qwen3-8B (Q4_K_M)

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~4.7 GB |
| Freier VRAM | ~3.3 GB → **~20K-24K Context** |
| Tool Calling | ⚠️ Eingeschränkt (Reasoning-optimiert, nicht Agent-optimiert) |

**Pro:**
- ✅ Besseres Reasoning als Standard-Qwen3-8B
- ✅ Passt in VRAM mit ausreichendem Context
- ✅ **Bereits auf SSD** (`deepseek-r1-qwen3-8b.Q4_K_M.gguf`, 4.7G)

**Contra:**
- ⚠️ DeepSeek-R1 ist auf **Reasoning** optimiert, nicht auf **Agentic/Tool-Use**
- ⚠️ Tendenz zu übermäßig langem Chain-of-Thought bei einfachen Tasks
- 

*[...truncated for embedding efficiency]*


## Source: model_inventory.md (session c74e9a0b)

# Model Inventory — Full Machine Scan

Scanned: `2026-04-03 19:42` | Total unique model weight: **~170 GB**

## Scattered Home Directories (need centralizing)

| Size | Model | Format | Path |
|------|-------|--------|------|
| 15 GB | Gemma 4 E4B (base) | safetensors | `~/gemma-4-e4b-weights/model.safetensors` |
| 15 GB | Gemma 4 E4B (base) | GGUF F16 | `~/gemma-4-e4b-weights/gemma-4-E4B-F16.gguf` |
| 5.0 GB | Gemma 4 E4B (base) | GGUF Q4_K_M | `~/gemma-4-e4b-weights/gemma-4-E4B-Q4_K_M.gguf` |
| 15 GB | Gemma 4 E4B-it | safetensors | `~/gemma-4-e4b-it-weights/model.safetensors` |
| 15 GB | Gemma 4 E4B-it | GGUF F16 | `~/gemma-4-e4b-it-weights/gemma-4-E4B-it-F16.gguf` |
| 5.0 GB | Gemma 4 E4B-it | GGUF Q4_K_M | `~/gemma-4-e4b-it-weights/gemma-4-E4B-it-Q4_K_M.gguf` |
| 9.6 GB | Gemma 4 E2B (base) | safetensors | `~/gemma-4-e2b-weights/model.safetensors` |
| 8.7 GB | Gemma 4 E2B (base) | GGUF F16 | `~/gemma-4-e2b-weights/gemma-4-E2B-F16.gguf` |
| 3.2 GB | Gemma 4 E2B (base) | GGUF Q4_K_M | `~/gemma-4-e2b-weights/gemma-4-E2B-Q4_K_M.gguf` |
| 9.6 GB | Gemma 4 E2B-it | safetensors | `~/gemma-4-e2b-it-weights/model.safetensors` |
| 8.7 GB | Gemma 4 E2B-it | GGUF F16 | `~/gemma-4-e2b-it-weights/gemma-4-E2B-it-F16.gguf` |
| 3.2 GB | Gemma 4 E2B-it | GGUF Q4_K_M | `~/gemma-4-e2b-it-weights/gemma-4-E2B-it-Q4_K_M.gguf` |

**Subtotal: ~113 GB** (lots of duplicate F16 + safetensors of same model)

---

## LM Studio (`~/.lmstudio/models/`)

| Size | Model | Quant | Path |
|------|-------|-------|------|
| 20 GB | Qwen3.5-35B-A3B | Q4_K_M | `lmstudio-community/Qwen3.5-35B-A3B-GGUF/` |
| 861 MB | ↳ Vision Projector | BF16 | `mmproj-Qwen3.5-35B-A3B-BF16.gguf` |
| 7.6 GB | Tifa-DeepsexV2-7b | Q8 | `ValueFX9507/Tifa-DeepsexV2-7b-MGRPO-GGUF-Q8/` |
| 5.8 GB | Mistral-Nemo-Instruct-2407 | Q4_K_M | `bartowski/Mistral-Nemo-Instruct-2407-Q4_K_M.gguf` |
| 5.3 GB | Qwen3.5-9B | Q4_K_M | `lmstudio-community/Qwen3.5-9B-GGUF/` |
| 880 MB | ↳ Vision Projector | BF16 | `mmproj-Qwen3.5-9B-BF16.gguf` |
| 5.3 GB | Qwen3.5-9B-Claude-Distilled-v2 | Q4_K_M | `Jackrong/` |
| 880 MB | ↳ Vision Projector | BF16 | `mmproj-BF16.gguf` |
| 4.7 GB | DeepSeek-R1-0528-Qwen3-8B | Q4_K_M | `lmstudio-community/` |
| 4.6 GB | Ministral-8B-Instruct-2410 | Q4_K_M | `bartowski/` (×2 duplicates) |
| 4.6 GB | Meta-Llama-3-8B | Q4_K_M | `bartowski/` |
| 4.6 GB | Meta-Llama-3.1-8B | Q4_K_M | `bartowski/` |
| 3.6 GB | Qwen2.5-7B-Instruct | Q3_K_M | root of models/ |
| 2.7 GB | Nemotron-3-Nano-4B | Q4_K_M | `lmstudio-community/` |
| 2.4 GB | Qwen3-4B-Thinking-2507 | Q4_K_M | `lmstudio-community/` |
| 2.4 GB | Qwen3-4B | Q4_K_M | `lmstudio-community/` |
| 2.0 GB | Ministral-3-3B-Instruct-2512 | Q4_K_M | `lmstudio-community/` |
| 802 MB | ↳ Vision Projector | F16 | `mmproj-Ministral-3-3B-Instruct-2512-F16.gguf` |
| 507 MB | Qwen2.5-0.5B-Instruct | Q8_0 | `lmstudio-community/` |
| 771 MB | Llama-3.2-1B-Instruct | Q4_K_M | `bartowski/` |
| 81 MB | nomic-embed-text-v1.5 | Q4_K_M | bundled embedding model (×2) |

---

## Already in AOS (`AOS/data/models/`)

| Size | Model | Type |
|------|-------|------|
| 1.8 GB | custom_qwen_3b.Q4_K_M.gguf | GGUF (real file) |
| 949 MB | custom_qwen_drafter.f16.gguf | GGUF (real file) |
| 507 MB | custom_qwen_drafter.Q8_0.gguf | GGUF (real file) |
| 501 MB | gemma4_e2b.Q8_0.gguf | GGUF (real file) |
| — | 11 symlinks | pointing to ~/home dirs & LM Studio |
| 5.8 GB | custom_qwen_3b/ (safetensors) | Training artifacts |
| 943 MB | custom_qwen_drafter/ (safetensors) | Training artifacts |
| 4.7 GB | custom_ministral3b/ (safetensors) | Training artifacts |
| 161 MB | checkpoints/checkpoint-30 | LoRA adapter |
| 115 MB | checkpoints_3b/checkpoint-30 | LoRA adapter |
| 34 MB | checkpoints_drafter/checkpoint-30 | LoRA adapter |

---

## BitNet (`BitNet/models/`)

| Size | Model | Type |
|------|-------|------|
| 30 GB | Llama3-8B-1.58-100B-tokens | GGUF f32 |
| 3.6 GB | ↳ same | safetensors |
| 3.6 GB | ↳ same | GGUF i2_s (1.58-bit) |

---

## Proposed Centraliza

*[...truncated for embedding efficiency]*


## Source: model_inventory.md (session f1543260)

# AOS Model Inventory — Full System Scan

## Gemma 4 Family (PRIORITY)
| Model | Quant | Size | Current Location |
|---|---|---|---|
| gemma-4-E4B-it | F16 | 15G | `~/gemma-4-e4b-it-weights/` |
| gemma-4-E4B-it | Q4_K_M | 5.0G | `~/gemma-4-e4b-it-weights/` |
| gemma-4-E4B (base) | F16 | 15G | `~/gemma-4-e4b-weights/` |
| gemma-4-E4B (base) | Q4_K_M | 5.0G | `~/gemma-4-e4b-weights/` |
| gemma-4-E2B-it | F16 | 8.7G | `~/gemma-4-e2b-it-weights/` |
| gemma-4-E2B-it | Q4_K_M | 3.2G | `~/gemma-4-e2b-it-weights/` |
| gemma-4-E2B (base) | F16 | 8.7G | `~/gemma-4-e2b-weights/` |
| gemma-4-E2B (base) | Q4_K_M | 3.2G | `~/gemma-4-e2b-weights/` |
| gemma-4-E2B | Q8_0 | 501M | `AOS/data/models/` |

## Qwen Family
| Model | Quant | Size | Current Location |
|---|---|---|---|
| Qwen2.5-7B-Instruct | Q3_K_M | 3.6G | `~/.lmstudio/models/` |
| Qwen2.5-0.5B-Instruct | Q8_0 | 507M | `~/.lmstudio/models/lmstudio-community/` |
| Qwen3-4B | Q4_K_M | 2.4G | `~/.lmstudio/models/lmstudio-community/` |
| Qwen3-4B-Thinking-2507 | Q4_K_M | 2.4G | `~/.lmstudio/models/lmstudio-community/` |
| Qwen3.5-9B | Q4_K_M | 5.3G | `~/.lmstudio/models/lmstudio-community/` |
| Qwen3.5-9B (mmproj) | BF16 | 880M | `~/.lmstudio/models/lmstudio-community/` |
| Qwen3.5-9B-Claude-Distilled | Q4_K_M | 5.3G | `~/.lmstudio/models/Jackrong/` |
| Qwen3.5-9B-Claude (mmproj) | BF16 | 880M | `~/.lmstudio/models/Jackrong/` |
| Qwen3.5-35B-A3B | Q4_K_M | 20G | `~/.lmstudio/models/lmstudio-community/` |
| Qwen3.5-35B-A3B (mmproj) | BF16 | 862M | `~/.lmstudio/models/lmstudio-community/` |
| custom_qwen_drafter | Q8_0 | 507M | `AOS/data/models/` |
| custom_qwen_drafter | F16 | 949M | `AOS/data/models/` |
| custom_qwen_3b | Q4_K_M | 1.8G | `AOS/data/models/` |

## Mistral/Ministral Family
| Model | Quant | Size | Current Location |
|---|---|---|---|
| Ministral-8B-Instruct | Q4_K_M | 4.6G (x2 dupes) | `~/.lmstudio/models/bartowski/` |
| Ministral-3-3B-Instruct | Q4_K_M | 2.0G | `~/.lmstudio/models/lmstudio-community/` |
| Ministral-3-3B (mmproj) | F16 | 802M | `~/.lmstudio/models/lmstudio-community/` |
| Mistral-Nemo-Instruct | Q4_K_M | 5.8G | `~/.lmstudio/models/bartowski/` |

## NVIDIA
| Model | Quant | Size | Current Location |
|---|---|---|---|
| Nemotron-3-Nano-4B | Q4_K_M | 2.7G | `~/.lmstudio/models/lmstudio-community/` |

## Meta Llama
| Model | Quant | Size | Current Location |
|---|---|---|---|
| Llama-3.2-1B-Instruct | Q4_K_M | 771M | `~/.lmstudio/models/bartowski/` |
| Llama-3.1-8B-Instruct | Q4_K_M | 4.6G | `~/.lmstudio/models/bartowski/` |
| Llama-3-8B-Instruct | Q4_K_M | 4.6G | `~/.lmstudio/models/bartowski/` |

## DeepSeek
| Model | Quant | Size | Current Location |
|---|---|---|---|
| DeepSeek-R1-0528-Qwen3-8B | Q4_K_M | 4.7G | `~/.lmstudio/models/lmstudio-community/` |

## BitNet
| Model | Quant | Size | Current Location |
|---|---|---|---|
| Llama3-8B-1.58-100B-tokens | i2_s | 3.6G | `BitNet/models/` |
| Llama3-8B-1.58-100B-tokens | f32 | 30G | `BitNet/models/` |

## Embedding
| Model | Quant | Size | Current Location |
|---|---|---|---|
| nomic-embed-text-v1.5 | Q4_K_M | 81M (x2) | `~/.lmstudio/` |

## Other
| Model | Quant | Size | Current Location |
|---|---|---|---|
| Tifa-DeepsexV2-7b | Q8 | 7.6G | `~/.lmstudio/models/ValueFX9507/` |

---

## Duplicate/Waste Candidates
- `Ministral-8B-Instruct-2410-Q4_K_M.gguf` exists in TWO locations (4.6G x2)
- `gemma-4-E4B` base AND instruct have BOTH F16 and Q4_K_M (60GB total Gemma alone)
- `gemma-4-E2B` base AND instruct have BOTH F16 and Q4_K_M
- `nomic-embed` duplicated across lmstudio bundles

## Total Disk Usage: ~215GB+ of models
