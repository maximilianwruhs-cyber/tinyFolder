---
title: Edge Node
type: entity
tags:
  - infrastructure
  - sovereign-ai
  - docker
  - llama-cpp
  - gpu
sources: 3
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: '2026-04-22'
---
# Edge Node

**Edge Node** is a bare-metal, un-tethered, zero-trust AI development environment. Designed for maximum hardware efficiency and complete local privacy, it runs high-performance C++ inference natively alongside autonomous agent tooling without relying on external cloud APIs.

## Core Tenets

1. **Absolute Sovereignty** — No telemetry, no forced cloud accounts, no external dependencies for core inference
2. **Immutable Infrastructure** — All dependencies burned into containers via Ansible and Docker. Boots without internet.
3. **Hardware Maximization** — `llama.cpp` compiled against host's specific GPU architecture (CUDA arch 61) for maximum Flash Attention efficiency

## Architecture

Three hyper-optimized containers:

| Container | Role | Tech |
|---|---|---|
| `edgenode-pgvector` | RAG Backbone | PGVector (vector memory) |
| `edgenode-llama-engine` | Inference Engine | llama.cpp b8665, Flash Attention, 8K ctx |
| `edgenode-openclaw` | Agent Gateway | [[OpenClaw]] (Node 22), [[GZMO]] persona |

### Key Configuration

- **GPU:** CUDA Architecture 61 (GTX 1060/1070 class)
- **Model:** `qwen3.5-9b-claude-distilled.Q4_K_M.gguf` (local) + Gemini 3.1 Pro (cloud fallback)
- **Obsidian Vault:** Mounted at `/workspace/Obsidian_Vault` via docker volume
- **Security:** All ports bound to `127.0.0.1` (zero-trust, localhost only)

## Deployment

### Option A: Ansible (Production)
```bash
ansible-playbook -i ansible/inventory.yml ansible/deploy_node.yml --ask-become-pass --ask-vault-pass
```

### Option B: Local Quick Start
```bash
cp .env.example .env && ./deploy.sh
```

## Related

- [[GZMO]] — Primary agent running on this stack
- [[OpenClaw]] — Agent orchestration framework
- [[Sovereign-AI]] — Philosophical foundation
- [[DevStack]] — Parent project and development environment

## Sources

- `raw/agent-logs/*_walkthrough.md` — Multiple deployment walkthroughs
- `raw/notebooklm/Building_a_Private_Local_AI_Development_Environmen__source__*.md`
- `raw/notebooklm/The_Sovereign_Software_Factory_Blueprint__source__*.md`
