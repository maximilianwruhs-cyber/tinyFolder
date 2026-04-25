---
title: "GZMO Hardware Profile"
type: entity
role: canonical
tags: [entity, canonical, gzmo, edge-node, devstack, local-ai]
sources: 0
created: '2026-04-22'
updated: 2026-04-25
---
# GZMO Hardware Profile

## Current Hardware And Paths

Use this section for queries like `GZMO hardware path`, `current vault path`, `daemon path`, `workspace path`, `GPU`, `VRAM`, or `Ollama host`.

- **Current Workspace Path**: `/home/maximilian-wruhs/tinyFolder`
- **Current Vault Path**: `/home/maximilian-wruhs/tinyFolder/vault`
- **Current Daemon Path**: `/home/maximilian-wruhs/tinyFolder/gzmo-daemon`
- **Historical Path Warning**: `/home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/` is historical unless a task explicitly asks about that checkout.

## Host Machine
- **Hostname**: GZMO
- **OS**: Ubuntu Linux (Kernel 6.17.0-22-generic)
- **Architecture**: x86_64

## CPU
- **Model**: AMD (8 cores, 4 physical, 2 threads/core)
- **Scaling**: 92% utilization headroom

## Memory
- **RAM**: 32 GB DDR (31Gi usable)
- **Typical usage**: ~7.4 GB system, ~23 GB available for cache/apps

## GPU
- **Model**: NVIDIA GeForce GTX 1070
- **VRAM**: 8192 MiB (8 GB)
- **Driver**: 535.288.01
- **CUDA**: Supported
- **Constraint**: All LLM inference must fit within 8 GB VRAM. This limits model size to ~8B parameters (Q4 quantization).

## Storage
- **Primary**: NVMe SSD
- **Current Workspace**: `/home/maximilian-wruhs/tinyFolder`
- **Vault Path**: `/home/maximilian-wruhs/tinyFolder/vault`
- **Daemon Path**: `/home/maximilian-wruhs/tinyFolder/gzmo-daemon`
- **Historical DevStack v2 Path**: `/home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/` — treat as historical unless a task explicitly references that checkout.

## Inference Stack
- **Runtime**: Bun (JavaScriptCore, smol heap mode)
- **Inference**: Ollama (localhost:11434)
- **Embedding**: nomic-embed-text (274 MB)
