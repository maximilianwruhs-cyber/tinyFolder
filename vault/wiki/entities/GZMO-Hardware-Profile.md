---
title: GZMO Hardware Profile
type: entity
tags:
  - hardware
  - gpu
  - system
  - seed-document
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# GZMO Hardware Profile

## Host Machine
- **Hostname**: GZMO
- **OS**: Ubuntu 24.04 LTS (Kernel 6.17.0-20-generic PREEMPT_DYNAMIC)
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
- **Vault Path**: `/home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/Obsidian_Vault`
- **Daemon Path**: `/home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/gzmo-daemon`

## Inference Stack
- **Runtime**: Bun (JavaScriptCore, smol heap mode)
- **Inference**: Ollama (localhost:11434)
- **Embedding**: nomic-embed-text (274 MB)
