---
title: 'Edge Node v2: Sovereign Agent — Clean Slate Walkthrough'
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Edge Node v2: Sovereign Agent — Clean Slate Walkthrough

## Summary

Stripped the Edge Node down to its essential sovereign agent components and made it fully hardware- and model-agnostic. Created `install_node.sh` — a hardware-sensing setup wizard that fuses the best of `phantom-drive` and `edge-node` into a single deployment entrypoint.

## What Was Purged

| Component | Files Removed | Reason |
|---|---|---|
| **PGVector** | Service in docker-compose.yml, container, `rag_data` volume | 0 tables, 0 code refs. `qmd` handles all RAG |
| **Unsloth Training** | `training/` (6 files), `docker-compose.training.yml` | Dead on Pascal GPUs (CC <7.0). Training can be separate |
| **TurboQuant / llama.cpp** | `llama-build/` (Dockerfile) | Replaced by Ollama long ago |
| **Legacy Scripts** | `deploy.sh`, `init-secrets.sh` | Merged into `install_node.sh` |
| **Model Hardcoding** | `Modelfile` | Model auto-selected by `install_node.sh` |

## What Was Created

### [install_node.sh](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/install_node.sh)
Hardware-adaptive setup wizard (~300 lines). Key features from **phantom-drive**:
- `detect_gpu_arch()` — PCI ID hex-matching (Maxwell → Blackwell)
- `get_available_vram_mb()` — nvidia-smi VRAM query
- `select_model()` — VRAM-based model ladder with fallbacks
- Colored terminal output (log/warn/err/ok)

Workflow: Probe GPU → Select model → Interactive config → Generate .env + openclaw.json → Deploy stack → Health check

### [MIGRATION.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/MIGRATION.md)
One-page guide: `git clone && ./install_node.sh` — done.

## What Was Modified

| File | Change |
|---|---|
| [docker-compose.yml](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/docker-compose.yml) | PGVector removed, 2 services only (ollama + openclaw) |
| [.env.example](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/.env.example) | Model-agnostic, added `OLLAMA_MODEL` + `GPU_ARCH` |
| [config.example.json](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/config.example.json) | Placeholder model ID, no hardcoding |
| [MEMORY.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/core_identity/MEMORY.md) | Hardware-agnostic, 4 open dreams listed, new lessons |
| [HEARTBEAT.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/core_identity/HEARTBEAT.md) | Clean Dream Cycle without training refs |
| [dreams/index.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/Obsidian_Vault/wiki/dreams/index.md) | 4 proposals listed with proper workflow |
| 3× Dream files | `pending_unsloth` → `proposed` |
| [README.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/README.md) | Complete rewrite: sovereign agent stack, architecture, quick start |
| [.gitignore](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/.gitignore) | Removed training/ refs |

## Verification Results

| Check | Result |
|---|---|
| `docker compose config` | ✅ Valid (2 services) |
| PGVector refs in config | ✅ 0 found |
| Unsloth refs in config | ✅ 0 found |
| Hardcoded model in compose/env | ✅ 0 found |
| Dream status consistency | ✅ All 4 = `proposed` |
| `install_node.sh --dry-run` | ✅ Detects GTX 1070, pascal, CC 6.1, 8192MB, recommends qwen2.5:3b |
| Running containers | ✅ ollama + openclaw live |

## What's Left for the New Machine

1. `git clone` + `./install_node.sh` — auto-detects GPU, configures everything
2. Copy Obsidian Vault and give the path during install
3. Install `qmd` and rebuild search index (`qmd embed`)
4. Review the 4 pending dreams and approve/reject them
