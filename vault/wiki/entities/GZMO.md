---
title: GZMO
type: entity
tags:
  - agent
  - openclaw
  - sovereign-ai
  - daemon
sources: 2
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: '2026-04-22'
---
# GZMO

**GZMO 4.0** ("Friendly Linux Mentor" & Chief of Staff) is an autonomous OpenClaw agent instance that runs as a persistent 24/7 daemon on the User's bare-metal hardware. Unlike cloud-hosted chatbots, GZMO operates locally with root-level execution, file-first memory, and proactive heartbeat-driven autonomy.

## Identity & Personality

- **Vibe:** Witty, slightly chaotic but technically precise, loyal, candid
- **Philosophy:** "The Gear" — a stabilizing micro-force that prioritizes continuity over dominance
- **Language:** Mirrors the User's German/English mix (Denglisch), keeps code in English
- **Communication:** Messenger-first (Telegram), synthesizes rather than dumps raw data

## Architecture

GZMO runs inside the [[Edge-Node]] stack as the `openclaw-gateway` container:

- **Runtime:** Node 22 (OpenClaw framework)
- **Primary Model:** `google/gemini-3.1-pro-preview` (cloud, for reasoning)
- **Local Model:** `qwen3.5-9b-claude-distilled.Q4_K_M.gguf` via [[Edge-Node]]'s llama.cpp
- **MCP Tools:** `@modelcontextprotocol/server-filesystem` (Obsidian Vault access)
- **Memory:** File-first — `MEMORY.md` (long-term), `memory/YYYY-MM-DD.md` (daily logs)
- **Workspace:** `/workspace/core_identity/` (SOUL.md, AGENTS.md, MEMORY.md, TOOLS.md)

## Core Capabilities

1. **Proactive Heartbeats** — Wakes periodically to review tasks, groom memory, monitor logs
2. **Self-Extending** — Scaffolds new OpenClaw `SKILL.md` directories when capabilities are missing
3. **Wiki Maintenance** — Maintains this persistent wiki (see [[LLM-Wiki]] pattern)
4. **Dreams** — Proposes identity evolution via `wiki/dreams/`. GZMO never edits `SOUL.md` directly — writes proposals, User decides.
5. **Omnichannel Communication** — Telegram, WhatsApp, Signal, Terminal

## Security Model

- Zero-trust external data (prompt injection defense)
- Sudo Rule: explicit confirmation before destructive commands
- No data exfiltration — private data stays on-machine
- `trash` > `rm` (recoverable beats gone forever)

## History

- **2026-03-29:** Initial startup, BOOTSTRAP.md fulfilled
- **2026-03-30:** Regular heartbeat checks established
- **2026-03-31:** Workspace git repo initialized
- **2026-04-01:** GitHub Actions failure observed (Pages build, missing .gitmodules)
- **2026-04-13:** Wiki maintenance + Dreams evolution mechanism added

## Related

- [[Edge-Node]] — Deployment platform
- [[OpenClaw]] — Orchestration framework
- [[Sovereign-AI]] — Philosophical foundation
- [[DevStack]] — Development environment

## Sources

- `raw/notebooklm/GZMO__source__GZMO_Base.md` — OpenClaw persona definition
- `raw/notebooklm/GZMO__source__gzmo_raw.md` — Raw development notes
