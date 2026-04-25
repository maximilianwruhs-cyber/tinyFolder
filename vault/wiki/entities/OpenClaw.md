---
title: "OpenClaw"
type: entity
role: canonical
tags: [entity, canonical, openclaw, local-ai, implementation-plan, research]
sources: 4
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: 2026-04-25
---
# OpenClaw

**OpenClaw** is a local-first, continuously running autonomous agent framework. Unlike standard LLM chatbots, OpenClaw agents operate via scheduled heartbeats (24/7 background), use a plugin architecture (`SKILL.md` files), communicate through omnichannel messaging (Telegram, WhatsApp, Terminal), and rely on a strict file-first memory system.

## Core Philosophy

- **"The AI That Actually Does Things"** — Execute, don't perform. Action over verbal output.
- **Agent Autonomy** — Proactive heartbeat-based operation, not reactive chat
- **Stigmergy** — Agents communicate via files (Markdown), never directly (prevents hallucination loops)
- **Self-Extending** — Agents scaffold their own `SKILL.md` plugins when missing capabilities

## Architecture

### Workspace Structure
```
core_identity/
├── AGENTS.md      ← Workspace conventions and rules
├── SOUL.md        ← Agent personality and directives
├── MEMORY.md      ← Long-term curated memory
├── TOOLS.md       ← Environment-specific notes
├── HEARTBEAT.md   ← Proactive task checklist
└── memory/        ← Daily logs (YYYY-MM-DD.md)
```

### Key Mechanisms

1. **Heartbeat System** — Periodic wake-ups for background work (memory grooming, task review, monitoring)
2. **Skill System** — Plugin directories with `SKILL.md` instruction files
3. **MCP Integration** — Model Context Protocol for tool access (filesystem, git, etc.)
4. **Memory Gardening** — Daily raw notes → long-term distilled `MEMORY.md`
5. **Omnichannel I/O** — Telegram, WhatsApp, Signal, Terminal

### Security

- Zero-trust external data (prompt injection defense)
- Red lines: no data exfiltration, no destructive commands without confirmation
- Separate MEMORY.md isolation for group vs. private chats

## Tri-Circuit Autonomy Model

From the research sources, OpenClaw implements a three-circuit model:
1. **Reactive Circuit** — Direct message handling and tool execution
2. **Deliberative Circuit** — Planning, architecture, multi-step reasoning
3. **Background Circuit** — Heartbeat-driven maintenance and monitoring

## Takeout Distillation

- The Google Takeout corpus contains large OpenClaw clusters: `OpenClaw Deep Research`, `OpenClaw`, `The OpenClaw Architecture and Tri-Circuit Autonomo`, and `OpenClaw_ Autonomous AI Agents in Financial Operat`.
- Distilled canonical takeaway: OpenClaw is the agent framework pattern behind GZMO: heartbeat-driven operation, file-first memory, tool/MCP integration, and tri-circuit autonomy.
- Use this page for durable OpenClaw facts; use source summaries and Takeout raw records only when exact provenance is required.

## Related

- [[GZMO]] — Primary agent instance
- [[Edge-Node]] — Deployment platform
- [[Agentic-Architecture]] — Design patterns

## Source Index

- Main Takeout clusters: `OpenClaw Deep Research` (110 files), `OpenClaw`, `The OpenClaw Architecture and Tri-Circuit Autonomy`, and OpenClaw finance/agentic-operation notebooks.
- Use this page for durable architecture; use [[NotebookLM-Corpus-Map]] to route into raw provenance.

## Sources

- `raw/notebooklm/OpenClaw__source__*.md`
- `raw/notebooklm/OpenClaw_Deep_Research__source__*.md`
- `raw/notebooklm/The_Cognitive_Architecture_of_OpenClaw_Agents__source__*.md`
- `raw/agent-logs/*_openclaw_research.md`

- [[source-013c8bf1-2cfc-4b66-b0a7-4db9cffaca37-sovereign-blueprint-analysis]]

- [[source-1fb0b911-8d9f-4ba1-868b-282558e388f5-notebooklm-analysis]]

- [[source-4453493b-34eb-4a26-aa85-d2c6828bef98-persona-audit]]

- [[source-48a649b9-7302-41c2-89a2-c94a0be41f58-artifacts-master-rust-orchestrator-blueprin]]

- [[source-48a649b9-7302-41c2-89a2-c94a0be41f58-artifacts-mcp-integration-blueprint]]

- [[source-51b6a24b-18d2-47e7-8680-05ebcd13d818-blueprint-05-memory-system]]

- [[source-68a9868c-ad57-482a-85b0-6c4090e662a6-artifacts-openclaw-research]]
