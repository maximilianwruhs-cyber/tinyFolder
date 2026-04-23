---
title: DevStack
type: entity
tags:
  - infrastructure
  - development
  - sovereign-ai
  - architecture
sources: 3
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: '2026-04-22'
---
# DevStack

**DevStack** (currently v2) is the umbrella project housing the User's entire development infrastructure. It encompasses the [[Edge-Node]] sovereign AI stack, the Obsidian knowledge vault, and all supporting tooling.

## Evolution

- **DevStack v1** — Initial development environment (archived)
- **DevStack v2** — Current production, featuring Edge Node, OpenClaw integration, and Obsidian vault
- **LLM Wiki integration** (2026-04-13) — Added persistent knowledge base using Karpathy's [[LLM-Wiki]] pattern

## Repository Structure

```
DevStack_v2/
├── edge-node/              ← [[Edge-Node]] sovereign AI stack
│   ├── core_identity/      ← [[GZMO]] workspace files
│   ├── config/             ← [[OpenClaw]] configuration
│   ├── docker-compose.yml  ← Container orchestration
│   └── ansible/            ← Bare-metal deployment
├── Obsidian_Vault/          ← Knowledge base & wiki
│   ├── raw/                ← Immutable source documents
│   ├── wiki/               ← LLM-maintained wiki
│   └── schema/             ← Wiki conventions
└── ...
```

## Related

- [[Edge-Node]] — Core AI infrastructure
- [[GZMO]] — Primary agent
- [[OpenClaw]] — Agent framework
- [[Sovereign-AI]] — Design philosophy

## Sources

- `raw/agent-logs/*devstack_audit*.md`
- `raw/agent-logs/*devstack_architecture*.md`
