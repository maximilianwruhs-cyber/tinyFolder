---
title: "Edge Node"
type: entity
role: canonical
tags: [entity, canonical, gzmo, openclaw, edge-node, devstack]
sources: 3
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: 2026-04-25
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

## Current Canonical State

- Current local workspace path: `/home/maximilian-wruhs/tinyFolder`.
- Current vault path: `/home/maximilian-wruhs/tinyFolder/vault`.
- Current daemon path: `/home/maximilian-wruhs/tinyFolder/gzmo-daemon`.
- Historical `DevStack_v2` paths may appear in old session/source pages; prefer [[GZMO-Hardware-Profile]] for active host paths.

## Related

- [[GZMO]] — Primary agent running on this stack
- [[OpenClaw]] — Agent orchestration framework
- [[Sovereign-AI]] — Philosophical foundation
- [[DevStack]] — Parent project and development environment

## Takeout Source Index

- `Building a Private Local AI Development Environmen` and `The Sovereign Software Factory Blueprint` clusters map to this page.
- Stable infrastructure facts should stay here or in [[DevStack]]; old blueprint claims remain evidence until verified against the active workspace.
- Corpus map: [[NotebookLM-Corpus-Map]].

## Sources

- `raw/agent-logs/*_walkthrough.md` — Multiple deployment walkthroughs
- `raw/notebooklm/Building_a_Private_Local_AI_Development_Environmen__source__*.md`
- `raw/notebooklm/The_Sovereign_Software_Factory_Blueprint__source__*.md`

- [[source-013c8bf1-2cfc-4b66-b0a7-4db9cffaca37-sovereign-blueprint-analysis]]

- [[source-0b4a0bc3-327c-4ed2-8c29-bf638987158e-walkthrough]]

- [[source-1ae46419-de0a-4da1-9193-3f29c246c12b-implementation-plan]]

- [[source-1ae46419-de0a-4da1-9193-3f29c246c12b-walkthrough]]

- [[source-34eb875f-6b6b-47b5-a919-03fc9bcde698-drift-analysis]]

- [[source-404c175f-dcb8-4f73-9ee6-169af66c4ca7-walkthrough]]

- [[source-4453493b-34eb-4a26-aa85-d2c6828bef98-walkthrough]]

- [[source-48a649b9-7302-41c2-89a2-c94a0be41f58-artifacts-master-rust-orchestrator-blueprin]]

- [[source-48a649b9-7302-41c2-89a2-c94a0be41f58-artifacts-mcp-integration-blueprint]]

- [[source-51b6a24b-18d2-47e7-8680-05ebcd13d818-gzmo-lmstudio-blueprint]]

- [[source-51b6a24b-18d2-47e7-8680-05ebcd13d818-orchestrator-architecture-analysis]]

- [[source-730e2574-4e11-4f5a-b39b-80f57a616fe9-walkthrough]]

- [[source-736d9f58-2548-4221-b7f1-565d2ed799ef-devstack-v3-filesystem-audit]]

- [[source-736d9f58-2548-4221-b7f1-565d2ed799ef-walkthrough]]
