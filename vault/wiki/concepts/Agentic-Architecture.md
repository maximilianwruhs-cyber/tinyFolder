---
title: Agentic Architecture
type: concept
tags:
  - architecture
  - agents
  - multi-agent
  - autonomous
  - patterns
sources: 6
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: '2026-04-22'
---
# Agentic Architecture

Design patterns and architectural principles for building autonomous, multi-agent AI systems that operate independently and collaborate via structured protocols.

## Key Patterns

### Stigmergy (Docs-Driven Development)
Agents communicate by passing Markdown files — never directly. Direct agent-to-agent communication causes infinite hallucination loops. Obsidian acts as the shared medium.

### File-First Memory
Agents have no database. Continuity exists purely in markdown files:
- `MEMORY.md` — Long-term curated wisdom
- `memory/YYYY-MM-DD.md` — Daily raw logs
- The wiki itself (see [[LLM-Wiki]])

### Heartbeat-Driven Autonomy
Unlike reactive chatbots, agentic systems wake on schedule to:
- Review and groom tasks
- Monitor system health
- Update documentation
- Process new information

### Tri-Circuit Model
From [[OpenClaw]] research:
1. **Reactive** — Direct message handling
2. **Deliberative** — Planning and architecture
3. **Background** — Heartbeat maintenance

### Self-Extension
Agents that detect missing capabilities scaffold new skills (`SKILL.md` directories) rather than patching problems manually.

## Architectures in Practice

| System | Pattern | Notes |
|---|---|---|
| [[GZMO]] | Single proactive agent | Heartbeat + omnichannel + self-extending |
| [[OpenClaw]] | Framework for above | Provides the runtime and conventions |
| Sovereign Factory | Multi-agent hierarchy | GPU Architect + CPU Builder + Night Shift |

## Memory Systems Compared

From the NotebookLM research on agentic memory:
- **Virtual Context** — Compressing relevant memory into the prompt window
- **Cognitive Graphs** — Graph-based knowledge representation
- **[[LLM-Wiki]]** — Persistent compiled wiki (the approach we use)

## Related

- [[Sovereign-AI]] — The philosophical foundation
- [[OpenClaw]] — The primary implementation framework
- [[LLM-Wiki]] — The knowledge persistence pattern

## Sources

- `raw/notebooklm/Architectures_for_Agentic_Memory*`
- `raw/notebooklm/The_Cognitive_Architecture_of_OpenClaw_Agents*`
- `raw/notebooklm/Prompt_Agent_engineering*`
- `raw/agent-logs/*architecture*.md`
