---
title: GZMO Edge Node Refactoring Tasks
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# GZMO Edge Node Refactoring Tasks

This task checklist executes the transition to Qwen 2.5 3B with strict verification stops after each step to prevent breaking edge cases.

- `[x]` **Step 1: Docker Compose Refactoring (Current)**
  - Add Ollama container config with GPU pass-through to replace TurboQuant.
  - Review OpenClaw config limits.
  - *Verify:* Run `docker compose config` to guarantee valid syntax and correct volume definitions.

- `[x]` **Step 2: Gateway Target Alignment**
  - Update `edge-node/config/openclaw.json` for Qwen 2.5 3B on Port 11434.
  - Enable ACP variables in config.
  - *Verify:* Validate JSON schema via `jq`.

- `[x]` **Step 3: Auto-Training Engine Setup**
  - Refactor `AOS/_archive/unsloth` pipelines to the active edge-node infrastructure.
  - hardcode path mapping to Extreme SSD model directory.
  - *Verify:* Execute Python syntax checking on the training scripts.

- `[x]` **Step 4: Memory / Identity Sync**
  - Update `MEMORY.md` to establish the new system baseline limits and state.
