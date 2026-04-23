---
title: Sovereign AI
type: concept
tags:
  - philosophy
  - architecture
  - privacy
  - zero-trust
  - local-first
sources: 5
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: '2026-04-22'
---
# Sovereign AI

**Sovereign AI** is the design philosophy that all AI inference, data processing, and agent execution should run on hardware you physically own and control — with zero telemetry, zero cloud dependency, and zero trust of external services for core functionality.

## Core Principles

1. **Absolute Sovereignty** — No telemetry, no forced cloud accounts, no external dependencies for core inference. Your models, your data, your machine.
2. **Immutable Infrastructure** — All dependencies burned into containers. If internet access is lost, the system still boots and operates.
3. **Hardware Maximization** — Use every transistor efficiently. GPU for reasoning, CPU for fast execution (see: bitnet.cpp 1.58-bit ternary models).
4. **Zero-Trust External Data** — All external input (emails, web pages) is assumed potentially hostile (prompt injection defense).

## The Sovereign Software Factory

A vision for a 100% local, offline, multi-agent AI engineering firm on consumer hardware:

- **GPU (Frontal Lobe)** — Deep reasoning model on LM Studio (Port 1234), wakes for planning, sleeps to save power
- **CPU (Spinal Cord)** — 1.58-bit ternary model via bitnet.cpp (Port 8080), continuous fast execution at 80+ tokens/sec
- **Obsidian** — Long-term memory and inter-agent communication (stigmergy)
- **MCP** — Secure "hands" for file and git operations

## Implementations

- [[Edge-Node]] — The production sovereign stack
- [[GZMO]] — Sovereign agent running inside Edge Node
- [[DevStack]] — The umbrella development environment

## Tensions & Open Questions

- **Cloud fallback trade-off:** [[GZMO]] currently uses Gemini 3.1 Pro (cloud) as primary model, with local llama.cpp as secondary. This breaks pure sovereignty but provides better reasoning quality. How to bridge this gap?
- **Model capability limits:** Local 9B Q4 models at 8K context struggle with complex multi-document synthesis. 32B+ models need more VRAM.
- **Update paradox:** Immutable infrastructure means slower adoption of new model releases.

## Related

- [[Agentic-Architecture]] — How sovereign agents are structured
- [[LLM-Wiki]] — Knowledge persistence without cloud dependencies

## Sources

- `raw/notebooklm/The_Sovereign_Software_Factory_Blueprint__source__*.md`
- `raw/notebooklm/Building_a_Private_Local_AI_Development_Environmen__source__*.md`
- `raw/agent-logs/*sovereign*.md`
