---
title: "DevStack"
type: entity
role: canonical
tags: [entity, canonical, gzmo, openclaw, edge-node, devstack]
sources: 3
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: 2026-04-25
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

## Current Canonical State

- In this workspace, DevStack knowledge is represented by the repository at `/home/maximilian-wruhs/tinyFolder`.
- `vault/` is the curated knowledge layer; `vault/raw/` is immutable source material; `gzmo-daemon/` is the active daemon implementation.
- Historical `DevStack_v2` diagrams and session notes remain evidence, but canonical path references should point to the current workspace unless explicitly discussing the old checkout.

## Related

- [[Edge-Node]] — Core AI infrastructure
- [[GZMO]] — Primary agent
- [[OpenClaw]] — Agent framework
- [[Sovereign-AI]] — Design philosophy

## Takeout Source Index

- DevStack-related Takeout clusters include private local AI development, sovereign software factory, TUI framework, and Obolus extension research.
- Current path facts are canonical here and in [[GZMO-Hardware-Profile]]; old diagrams are historical evidence.
- Corpus map: [[NotebookLM-Corpus-Map]].

## Sources

- `raw/agent-logs/*devstack_audit*.md`
- `raw/agent-logs/*devstack_architecture*.md`

- [[source-08101175-a0cf-465c-b528-1a38665c0d74-verification-report]]

- [[source-1469a805-9553-44e4-8b26-0f660cca31c1-artifacts-audit-report]]

- [[source-1ae46419-de0a-4da1-9193-3f29c246c12b-implementation-plan]]

- [[source-51b6a24b-18d2-47e7-8680-05ebcd13d818-blueprint-02-chief-of-staff]]

- [[source-6fabbb0f-70a2-47d1-b2ae-5a25f621b974-implementation-plan]]

- [[source-92cc96d6-8d37-4825-a88a-1e4a542d1485-devstack-architecture-cycle]]

- [[source-92cc96d6-8d37-4825-a88a-1e4a542d1485-walkthrough]]
