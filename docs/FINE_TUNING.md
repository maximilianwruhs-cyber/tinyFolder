# Fine-Tuning Guide for GZMO / Ollama

> **Headline:** Ollama runs fine-tuned models. It does not train them. This guide covers the full path from training data → custom Ollama model.

---

## Table of Contents

- [The Golden Rule](#the-golden-rule)
- [Three tiers of customization](#three-tiers-of-customization)
- [Prerequisites](#prerequisites)
- [Tier 1: System prompt tuning (5 minutes)](#tier-1-system-prompt-tuning-5-minutes)
- [Tier 2: LoRA fine-tuning with Unsloth (2–4 hours)](#tier-2-lora-fine-tuning-with-unsloth-24-hours)
- [Tier 3: Full fine-tuning + domain embedding model](#tier-3-full-fine-tuning--domain-embedding-model)
- [Importing into Ollama](#importing-into-ollama)
- [GZMO Modelfile templates](#gzmo-modelfile-templates)
- [DGX Spark specific notes](#dgx-spark-specific-notes)
- [Troubleshooting](#troubleshooting)
- [Reference](#reference)

---

## The Golden Rule

**Ollama is an inference engine, not a training framework.**

You train or fine-tune with external tools (Unsloth, TRL, Axolotl), then import the result into Ollama using a `Modelfile`.

What Ollama can consume:
- **Safetensors** model directories (FP16/FP32, limited architectures)
- **GGUF** files (`llama.cpp` format — the standard for local inference)
- **LoRA adapters** in both formats ( Safetensors or GGUF )

What Ollama **cannot** do:
- Run training loops
- Perform SFT, DPO, or RLHF
- Merge LoRA adapters into base weights automatically (you do this before import)

---

## Three tiers of customization

| Tier | Effort | Hardware requirement | Result |
|------|--------|---------------------|--------|
| **1. System prompt tuning** | 5 min | None | Behavioral steering via `SYSTEM` in Modelfile |
| **2. LoRA fine-tuning** | 2–4 hrs + data collection | 16GB+ VRAM (or 128GB unified) | Custom output style, task specialization |
| **3. Full fine-tune + custom embedder** | Days + large dataset | 80GB+ VRAM | Deep domain knowledge, custom retrieval |

**Recommendation:** Start with Tier 1. Move to Tier 2 only when Tier 1 is insufficient for your use case. Tier 3 is for teams with ML engineering capacity.

---

## Prerequisites

For Tier 2 and above:

- **Python** 3.10+
- **PyTorch** with CUDA support
- One of the training frameworks (Unsloth recommended)
- `llama.cpp` conversion scripts (`convert_hf_to_gguf.py`)
- Sufficient storage: fine-tuning artifacts are 2–5× the size of the final model

For DGX Spark (128GB unified memory):
- All prerequisites above
- Expect to use ~80–100GB of unified memory for 70B LoRA training

---

## Tier 1: System prompt tuning (5 minutes)

This is not "fine-tuning" in the ML sense, but it solves 80% of customization needs.

Create a `Modelfile`:

```dockerfile
FROM qwen2.5:72b

SYSTEM """You are GZMO, a deterministic reasoning engine operating on a local vault.
Rules:
- Use bullet points, 3–7 items
- Cite evidence with [E1], [E2]
- If evidence is insufficient, say so explicitly
- Never invent file paths or side effects
- Be concise. One paragraph unless asked otherwise."""

PARAMETER temperature 0.3
PARAMETER top_p 0.85
PARAMETER num_ctx 8192
```

Build and run:

```bash
ollama create gzmo-core -f Modelfile
ollama run gzmo-core
```

Set it as your daemon model:

```bash
# gzmo-daemon/.env
OLLAMA_MODEL="gzmo-core"
```

### When to use this
- Enforcing output format (bullets, JSON, citations)
- Setting tone (concise, formal, technical)
- Restricting behavior ("never suggest commands that modify files")
- Cost: zero GPU time, zero data collection

### When this fails
- The model still hallucinates domain facts you know are wrong
- Output style reverts under complex prompts
- You need the model to know proprietary data not in the base model

---

## Tier 2: LoRA fine-tuning with Unsloth (2–4 hours)

Unsloth is 2–5× faster than standard HuggingFace training and uses ~70% less memory. This is the recommended path for individuals.

### Step 1: Install dependencies

```bash
pip install unsloth transformers datasets accelerate
# For DGX Spark / Grace Blackwell, ensure you have CUDA 12.4+:
# pip install torch --index-url https://download.pytorch.org/whl/cu124
```

### Step 2: Prepare training data

Format: Alpaca-style JSONL (or ShareGPT). Each record needs `instruction` and `output`.

Example for a coding assistant:

```json
{"instruction": "Generate a Python function that reads a YAML config and validates required keys.", "output": "```python\nimport yaml\nfrom pathlib import Path\n\ndef load_config(path: str) -> dict:\n    ...\n```"}
```

Example for GZMO task output formatting:

```json
{"instruction": "Summarize the daemon's operational outputs based on vault content.", "output": "## Operational Outputs\n\nThe daemon writes artifacts under `GZMO/`:\n- `health.md` — health snapshot\n- `TELEMETRY.json` — structured metrics\n- `embeddings.json` — RAG vector store\n\nEvidence: [E1] from `README.md` sections 4.2–4.5."}
```

Save as `training_data.jsonl`. Target: **500–2000** examples. Quality > quantity.

### Step 3: Training script

Save as `train_lora.py`:

```python
from unsloth import FastLanguageModel
from datasets import load_dataset
import torch

# 1. Load base model (4-bit for Q-LoRA)
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-72B",  # or "unsloth/Meta-Llama-3.3-70B"
    max_seq_length=4096,
    dtype=None,                         # Auto-detect (BF16 on Ampere/Blackwell)
    load_in_4bit=True,                  # Q-LoRA: train adapters on quantized base
)

# 2. Add LoRA adapters
model = FastLanguageModel.get_peft_model(
    model,
    r=64,                # LoRA rank (higher = more capacity, more memory)
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    lora_alpha=128,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)

# 3. Load dataset
dataset = load_dataset("json", data_files="training_data.jsonl", split="train")

# Format for training (Alpaca template)
alpaca_prompt = """Below is an instruction that describes a task. Write a response that appropriately completes the request.

### Instruction:
{}

### Response:
{}"""

def formatting_prompts_func(examples):
    texts = []
    for inst, out in zip(examples["instruction"], examples["output"]):
        text = alpaca_prompt.format(inst, out) + tokenizer.eos_token
        texts.append(text)
    return {"text": texts}

dataset = dataset.map(formatting_prompts_func, batched=True)

# 4. Train
from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=4096,
    dataset_num_proc=2,
    args=TrainingArguments(
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=5,
        max_steps=200,              # Increase to 500–1000 for real training
        learning_rate=2e-4,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=3407,
        output_dir="outputs",
    ),
)

trainer.train()

# 5. Save adapter
model.save_pretrained("lora_model")
tokenizer.save_pretrained("lora_model")
print("LoRA adapter saved to ./lora_model")
```

Run training:

```bash
python train_lora.py
```

**Expected time:**
- 8B model, 500 steps: ~30 min on RTX 4090
- 70B model, 500 steps: ~2–4 hrs on DGX Spark (128GB unified)

### Step 4: Merge adapter + export to GGUF

Unsloth can do this in one shot:

```python
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-72B",
    lora_path="./lora_model",
    max_seq_length=4096,
)

# Merge LoRA into base weights and export to GGUF
model.save_pretrained_gguf(
    "model_gguf",
    tokenizer,
    quantization_method="q4_k_m",   # q4_k_m, q8_0, f16
)
```

This produces:
```
model_gguf/
└── unsloth.Q4_K_M.gguf
```

**Alternative:** Export as merged Safetensors and use `llama.cpp` to convert:

```python
# Save merged FP16 weights
model.save_pretrained_merged("merged_model", tokenizer, save_method="merged_16bit")

# Then run llama.cpp conversion:
# python convert_hf_to_gguf.py merged_model --outfile my-model.gguf --outtype q4_k_m
```

### Step 5: Import into Ollama

Create `Modelfile`:

```dockerfile
FROM ./model_gguf/unsloth.Q4_K_M.gguf

SYSTEM """You are a specialized reasoning assistant optimized for local vault operations.
- Format: bullet points, 3–7 items
- Cite evidence with [E1], [E2]
- State uncertainty explicitly
- Never hallucinate file paths."""

PARAMETER temperature 0.3
PARAMETER num_ctx 8192
```

```bash
ollama create gzmo-lora-v1 -f Modelfile
ollama run gzmo-lora-v1
```

Set as daemon model and restart:
```bash
# gzmo-daemon/.env
OLLAMA_MODEL="gzmo-lora-v1"
```

---

## Tier 3: Full fine-tuning + domain embedding model

This is for organizations or advanced users who need:
- Deep domain expertise (medical, legal, proprietary codebase)
- Custom retrieval behavior (embeddings that understand your ontology)
- High-stakes accuracy where LoRA generalization is insufficient

### Approach

1. **Full fine-tune** the base model on your domain corpus (SFT + optional DPO)
2. **Train or fine-tune an embedding model** on your domain's semantic relationships
3. **Convert both** to GGUF/Safetensors and import into Ollama
4. **Configure GZMO** to use the custom inference model + custom embedder

### Hardware reality check

| Model size | Full fine-tune VRAM | DGX Spark (128 GB)? |
|-----------|--------------------|---------------------|
| 8B | ~48 GB | ✅ Yes |
| 13B | ~80 GB | ✅ Yes |
| 70B | ~400 GB | ❌ No — use LoRA (Tier 2) |

For 70B models, full fine-tuning requires multiple GPUs or cloud (8× A100 80GB).

### Custom embedder for GZMO

GZMO uses an embedding model for RAG retrieval. You can replace `nomic-embed-text` with your own:

```bash
# 1. Train a sentence-transformer on your domain
# 2. Export to GGUF or ONNX
# 3. Serve via Ollama (if supported) or a sidecar

# Alternatively: keep nomic-embed-text for general retrieval,
# but fine-tune the inference model to better interpret retrieved chunks.
```

---

## Importing into Ollama

### Supported import paths

| Source | Modelfile | Command |
|--------|-----------|---------|
| Safetensors directory | `FROM ./model_dir` | `ollama create my-model -f Modelfile` |
| GGUF file | `FROM ./model.gguf` | `ollama create my-model -f Modelfile` |
| LoRA (Safetensors) | `FROM base_model` + `ADAPTER ./lora_dir` | `ollama create my-model -f Modelfile` |
| LoRA (GGUF) | `FROM base_model` + `ADAPTER ./lora.gguf` | `ollama create my-model -f Modelfile` |
| Ollama base + override | `FROM llama3.3` + `SYSTEM ...` | `ollama create my-model -f Modelfile` |

### Supported architectures

Ollama can import models with these architectures:
- **Llama** (2, 3, 3.1, 3.2, 3.3)
- **Mistral** (1, 2, Mixtral)
- **Gemma** (1, 2)
- **Phi3**

Qwen and DeepSeek models in the Ollama library are pre-converted by the Ollama team. Custom fine-tunes of Qwen/DeepSeek must be converted to GGUF independently (llama.cpp supports Qwen2).

### Quantizing on import

If you have FP16 weights and want a smaller model:

```bash
ollama create --quantize q4_k_m my-model -f Modelfile
```

Supported quantization methods:
- `q8_0` — minimal loss, fast
- `q4_k_m` — balanced (recommended)
- `q4_k_s` — smaller, slightly more loss

---

## GZMO Modelfile templates

### Template A: Precision mode (search/chain tasks)

```dockerfile
FROM qwen2.5:72b

SYSTEM """You are GZMO, a deterministic reasoning engine.

Operational rules:
1. Ground every claim in evidence from the provided context
2. Use citations [E1], [E2] tied to specific evidence blocks
3. If evidence is insufficient, state "Insufficient evidence" and explain what is missing
4. Format answers as bullet points, 3–7 items
5. Never invent file paths, URLs, or commands
6. Be concise. One paragraph per point unless the task explicitly requests depth.

Current phase: execution. No meta-commentary."""

PARAMETER temperature 0.2
PARAMETER top_p 0.8
PARAMETER num_ctx 8192
PARAMETER repeat_penalty 1.1
```

### Template B: Creative mode (brainstorming, drafting)

```dockerfile
FROM llama3.3:70b

SYSTEM """You are GZMO in creative mode. Help the user explore ideas, draft content, and synthesize concepts from the vault. You may speculate when asked, but label speculation clearly. Use rich formatting (headers, lists, code blocks) when it aids clarity."""

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER num_ctx 16384
```

### Template C: Custom LoRA import

```dockerfile
FROM ./gzmo-coder-lora.gguf

SYSTEM """You are GZMO-Coder, fine-tuned on the project's codebase and conventions. Generate code that follows the patterns in the vault. Always include type hints in Python. Prefer early returns over nested conditionals."""

PARAMETER temperature 0.3
PARAMETER num_ctx 8192
```

---

## DGX Spark specific notes

### What the DGX Spark enables

With 128 GB unified memory, the DGX Spark sits in a unique position: it can train LoRA on 70B models locally, which normally requires cloud rental or multi-GPU workstations.

### Training configurations

**70B Q-LoRA on DGX Spark:**
```python
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Meta-Llama-3.3-70B",
    max_seq_length=4096,
    dtype=None,
    load_in_4bit=True,      # Essential — keeps base model in ~40GB
)

model = FastLanguageModel.get_peft_model(
    model,
    r=128,                  # Higher rank because you have memory headroom
    lora_alpha=256,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
)
```

Expected memory: ~90–100GB during training. Remaining ~28GB handles OS + Ollama background tasks.

### NVLink / unified memory tips

- Unified memory means the OS allocates from the same pool. Close unnecessary applications before training.
- Use `OLLAMA_MAX_LOADED_MODELS=1` to prevent Ollama from keeping multiple models resident during training.
- If training crashes with OOM, reduce `max_seq_length` to 2048 or use `r=64` instead of `r=128`.

### Recommended models for DGX Spark

| Model | Training mode | Fits? |
|-------|--------------|-------|
| Llama 3.3 70B | Q-LoRA (r=128) | ✅ Yes |
| Qwen 2.5 72B | Q-LoRA (r=128) | ✅ Yes |
| Llama 3.1 405B | Any | ❌ No (~231GB at Q4) |
| Mistral 7B | Full fine-tune | ✅ Yes (easy) |
| Llama 3.1 8B | Full fine-tune | ✅ Yes |

---

## Troubleshooting

### `ollama create` fails with "unsupported model architecture"

- Your model is likely Qwen2 or another architecture not in Ollama's native Safetensors import list.
- **Fix:** Convert to GGUF first using `llama.cpp`'s `convert_hf_to_gguf.py`, then import the `.gguf` file.

### LoRA adapter produces garbage output

- Base model mismatch: the `FROM` model in your Modelfile must be the **exact** base model used during training.
- Quantization mismatch: if you trained Q-LoRA on a 4-bit base, the `FROM` model must also be 4-bit (or use merged weights).
- **Fix:** Merge the adapter into FP16 weights before export, or ensure `FROM` matches your training base.

### Training crashes with CUDA OOM

- Reduce `max_seq_length`
- Reduce batch size (use `gradient_accumulation_steps` to compensate)
- Reduce LoRA rank (`r=32` or `r=16`)
- Enable `use_gradient_checkpointing="unsloth"`

### Model loads but inferencing is slow

- Make sure Ollama is using your GPU, not CPU: `ollama ps` should show the model on GPU.
- On DGX Spark, set `OLLAMA_KV_CACHE_TYPE=q8_0` for faster attention.
- For GGUF imports, `q4_k_m` is faster than `q8_0` on some hardware.

### Ollama doesn't see my custom model

```bash
# List all local models
ollama list

# If missing, recreate
ollama create gzmo-custom -f Modelfile
```

---

## Reference

### Official Ollama documentation
- Modelfile reference: `https://github.com/ollama/ollama/blob/main/docs/modelfile.md`
- Import guide: `https://github.com/ollama/ollama/blob/main/docs/import.md`
- Quantization: `--quantize` flag in `ollama create`

### Training tools
- **Unsloth** (recommended): `https://github.com/unslothai/unsloth` — 2–5× faster, 70% less memory
- **HuggingFace TRL:** `https://github.com/huggingface/trl` — standard SFT/DPO/RLHF
- **Axolotl:** `https://github.com/OpenAccess-AI-Collective/axolotl` — YAML-configured training
- **LLaMA-Factory:** `https://github.com/hiyouga/LLaMA-Factory` — Web UI + CLI

### Conversion tools
- **llama.cpp** (convert scripts): `https://github.com/ggerganov/llama.cpp`
  - `convert_hf_to_gguf.py` — HuggingFace → GGUF
  - `convert_lora_to_gguf.py` — LoRA adapter → GGUF

### GZMO-specific env vars for custom models
```bash
# gzmo-daemon/.env
OLLAMA_MODEL="gzmo-lora-v1"          # Your custom inference model
OLLAMA_URL="http://localhost:11434"  # Ollama endpoint
GZMO_PROFILE="core"                  # Start with core, expand later
```

---

*Last updated: 2026-05-05*
