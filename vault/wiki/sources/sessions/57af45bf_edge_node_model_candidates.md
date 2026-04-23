---
title: Edge-Node Model Evaluation (GTX 1070 - 8GB VRAM)
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
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
