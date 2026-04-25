---
title: "Trading Automation"
type: topic
role: canonical
tags: [topic, canonical, edge-node, notebooklm, implementation-plan, research]
sources: 3
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: 2026-04-25
---
# Trading Automation

Automated and semi-autonomous trading systems spanning crypto (Bitpanda), equities (IBKR), and structured savings plans.

## Systems

### Bitpanda Pipeline
- **Signal Source:** TradingView webhooks
- **Orchestration:** n8n workflow engine
- **Execution:** Bitpanda API
- **Compliance:** Austrian tax and regulatory requirements (KESt)

### IBKR Architecture
- From NotebookLM research on automated IBKR trading systems
- Focus on autonomous execution with risk management

### Market Analysis
- Q2 2026 Global Momentum and Strategic Market Positioning
- Flatex brokerage architecture and DACH market operations

## Regulatory Context

Austrian-specific:
- KESt (Kapitalertragsteuer) compliance
- Bitpanda as regulated Austrian platform
- Legal deployment requirements for autonomous trading

## Related

- [[Sovereign-AI]] — Local processing of financial signals
- [[Edge-Node]] — Potential host for trading agent

## Takeout Source Index

- Main clusters include OpenClaw financial operations, Q2 2026 global momentum, IBKR architecture, and autonomous trading-system handbooks.
- Treat this topic as high-risk: keep claims source-bound and do not convert research notes into execution advice without explicit validation.
- Corpus map: [[NotebookLM-Corpus-Map]].

## Sources

- `raw/notebooklm/Architecting_Automated_IBKR_Trading_Systems*`
- `raw/notebooklm/The_Architect-s_Handbook_for_Autonomous_Agentic_Trading_Systems*`
- `raw/notebooklm/Q2_2026_Global_Momentum*`
- `raw/notebooklm/Flatex_Brokerage*`

- [[source-4453493b-34eb-4a26-aa85-d2c6828bef98-implementation-plan]]

- [[source-48a649b9-7302-41c2-89a2-c94a0be41f58-artifacts-implementation-plan]]
