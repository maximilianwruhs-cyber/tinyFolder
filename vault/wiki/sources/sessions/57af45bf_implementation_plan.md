# GZMO Edge-Node Redesign: Ollama + Qwen 2.5 3B (Unsloth Integration)

This document replaces the old TurboQuant/E4B architecture plan. Following our technical analysis, the GTX 1070's hardware constraints (8GB VRAM, sm_61 architecture) and portability requirements demand a shift to a robust Qwen 2.5 3B backend powered by Ollama for inference, and Unsloth (bnb-4bit) for autonomous "Dream" training.

## 1. Architectural Structure & Relationships

The redesigned system operates as a self-contained, closed-loop sovereign AI:

1. **Inference Layer (Ollama)**: Replaces TurboQuant. Runs natively or inside Docker, exposing port `11434`. Runs the merged `Qwen 2.5 3B` (GGUF format). Handles all daily chat and agent tasks.
2. **Cognitive Gateway (OpenClaw)**: The 100% static JS node orchestrator. Communicates with Ollama for logic. Triggers `Heartbeats` that prompt the agent to read `HEARTBEAT.md` and generate "Dream proposals".
3. **Agent Client Protocol (ACP) Layer**: Enhances OpenClaw by opening a realtime WebSocket/SSE bridge directly to the host IDE (e.g., VS Code). Allows the IDE to send context (refactoring tasks, active file) straight into GZMO's loop.
4. **Data Source (Obsidian Vault)**: The staging area. GZMO writes its dream proposals to `wiki/dreams/YYYY-MM-DD-topic.md`.
5. **Training Engine (Unsloth)**: A dedicated Python pipeline on the Edge Node. It reads the Dream proposals, structures them into ChatML, and applies LoRA fine-tuning against the base `qwen2.5-3b-instruct-bnb-4bit` (from the Extreme SSD). Uses < 5GB VRAM.
6. **Deployment**: After training, the pipeline exports a new GGUF overlay and commands Ollama to reload the model, seamlessly completing the evolution.

---

## User Review Required

> [!CAUTION]
> Bringing Unsloth into the `edge-node` makes it completely autonomous. When GZMO triggers a heartbeat, it could theoretically trigger the training pipeline.
> **Decision needed:** Should `train_orchestrator.sh` be fully automated via a cron/openclaw task when a new dream is detected, or do you want to manually run the script via terminal after you read GZMO's dream?

---

## 2. Proposed Changes (File Modifications)

### Infrastructure & Inference

#### [MODIFY] `edge-node/docker-compose.yml`
- Remove references to `TurboQuant` on host port `1235`.
- Add an `ollama` service container (using the `ollama/ollama` image), map volume to a local `ollama_data` folder for GGUF caching, and expose port `11434`.
- Link the `openclaw-gateway` to the new Ollama container.

#### [MODIFY] `edge-node/docker-compose.yml` (ACP Extension)
- Expose an additional port (e.g., `3000` or `8080`) from the `openclaw-gateway` container to the host machine to allow the IDE to route ACP traffic into the container.

#### [MODIFY] `edge-node/config/openclaw.json`
- Update the `"models"` block arrays.
- Change the `baseUrl` from `http://127.0.0.1:1235/v1` to `http://127.0.0.1:11434/v1` (or the Docker internal network IP).
- Change model name to `qwen2.5:3b` (or whatever tag we give it in Ollama).
- Enable the ACP server block within the `"channels"` or `"gateway"` section so the engine listens for IDE payloads.

### Identity & Memory

#### [MODIFY] `edge-node/core_identity/MEMORY.md`
- Update the "Current Self-Image" configuration.
- Change tech stack notes from `Gemma 4 E4B via TurboQuant` to `Qwen 2.5 3B via Ollama`.
- Update Context Window notes (32K Inference, 4K Training).

### Unsloth Training Pipeline Migration

#### [DELETE] `AOS/_archive/unsloth/`
- We will move this out of the archive and into the live Edge Node workspace.

#### [NEW] `edge-node/training/ingest_brain.py`
- Modify `NEMOCLAW_MEMORY` to target the `Obsidian_Vault/wiki/dreams/` path.
- Add ChatML mapping structure optimized for Qwen's specific prompt template.

#### [NEW] `edge-node/training/train_orchestrator.sh`
- Hardcode the base model path to `/media/maximilian-wruhs/Extreme SSD/LLM_Models_Export/models--unsloth--qwen2.5-3b-instruct-bnb-4bit`.
- Add the `ollama run <model>` reload command at the end of the script to automatically refresh the AI in production after a successful training run.

---

## Verification Plan

### Automated Tests
1. **Ollama Boot:** Deploy the new `docker-compose.yml`, pull the model, and verify via `curl http://localhost:11434/api/tags` that Qwen 3B is loaded.
2. **Gateway Connect:** Verify `edgenode-openclaw` successfully routes a basic heartbeat ping to the new Ollama endpoint.
3. **Training Dry-Run:** Run `train_orchestrator.sh --dry-run` to verify VRAM allocation stays below 6GB.

### Manual Verification
- Trigger a Dream Cycle manually. Ask GZMO to write a dream proposal based on `SOUL.md`. Verify it outputs correctly to the Vault. 
- Trigger the Unsloth trainer manually, observe the LoRA merging, and chat with the agent to verify the new behavior activated.
