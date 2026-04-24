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
updated: '2026-04-24'
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

- [[source-08101175-a0cf-465c-b528-1a38665c0d74-verification-report]]

- [[source-1469a805-9553-44e4-8b26-0f660cca31c1-artifacts-audit-report]]

- [[source-1ae46419-de0a-4da1-9193-3f29c246c12b-implementation-plan]]

- [[source-51b6a24b-18d2-47e7-8680-05ebcd13d818-blueprint-02-chief-of-staff]]
