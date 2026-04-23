---
title: LLM Wiki Integration — Walkthrough
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# LLM Wiki Integration — Walkthrough

## Was wurde gemacht

Das Karpathy-Pattern eines **LLM-gestützten persönlichen Wikis** wurde in den Edge Node Sovereign AI Stack integriert. GZMO fungiert ab sofort als autonomer "Knowledge Gardener".

## Datenfilterung

**847+ Rohdateien → 330 kuratierte Quellen**

| Behalten | Anzahl | Pfad |
|---|---|---|
| Agent-Logs (Walkthroughs, Plans, Audits, Reports) | 171 | `raw/agent-logs/` |
| NotebookLM-Quellen & Notizen (52 Notebooks) | 159 | `raw/notebooklm/` |

| Gefiltert (Noise) | Anzahl |
|---|---|
| DOM-Dumps (tempmediaStorage) | 408 |
| System-Step-Outputs | 138 |
| Browser-Scratchpads | 49 |
| Task-Checklisten | 59 |

## Vault-Architektur

```
Obsidian_Vault/
├── raw/                    ← Immutable Quellen (330 Dateien, 5.8 MB)
│   ├── agent-logs/         ←   171 gefilterte Session-Artefakte
│   └── notebooklm/         ←   159 NotebookLM-Quellexporte
├── wiki/                   ← LLM-generiertes Wiki (14 Seiten)
│   ├── index.md            ←   Inhaltskatalog
│   ├── log.md              ←   Operationsprotokoll
│   ├── overview.md          ←   High-Level-Synthese
│   ├── entities/           ←   GZMO, Edge-Node, OpenClaw, DevStack
│   ├── concepts/           ←   Sovereign-AI, Agentic-Architecture, LLM-Wiki
│   └── topics/             ←   Trading, Eignungsdiagnostik, Linux, Musik, Game
└── schema/
    └── WIKI.md             ←   Regelwerk (Ingest/Query/Lint Workflows)
```

## Geänderte Dateien

### Neu erstellt

| Datei | Zweck |
|---|---|
| [WIKI.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/Obsidian_Vault/schema/WIKI.md) | Schema — GZMOs Regelwerk für Wiki-Pflege |
| [index.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/Obsidian_Vault/wiki/index.md) | Wiki-Index |
| [log.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/Obsidian_Vault/wiki/log.md) | Operationslog |
| [overview.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/Obsidian_Vault/wiki/overview.md) | Gesamtsynthese |
| 4× Entity-Seiten | GZMO, Edge-Node, OpenClaw, DevStack |
| 3× Concept-Seiten | Sovereign-AI, Agentic-Architecture, LLM-Wiki |
| 5× Topic-Seiten | Trading, Eignungsdiagnostik, Linux, Musik, Game-Engine |

### Modifiziert

| Datei | Änderung |
|---|---|
| [AGENTS.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/core_identity/AGENTS.md) | Wiki Maintenance Sektion + Heartbeat-Regeln |
| [SOUL.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/core_identity/SOUL.md) | Knowledge Gardener Rolle |

## Wikilink-Netzwerk

Das initiale Wiki hat **80+ Cross-References** zwischen 14 Seiten. Die meistvernetzten Nodes:

| Page | Inbound Links |
|---|---|
| Edge-Node | 13 |
| Sovereign-AI | 10 |
| GZMO | 10 |
| OpenClaw | 9 |
| LLM-Wiki | 9 |

## Nächste Schritte

1. **Obsidian öffnen** — Vault in Obsidian öffnen, Graph View prüfen
2. **GZMO antriggern** — Heartbeat starten, prüfen ob neue Quellen in `raw/` erkannt werden
3. **qmd installieren (bei ~50+ Wiki-Seiten):**
   ```bash
   npm install -g @tobilu/qmd
   qmd collection add ~/Dokumente/Playground/DevStack_v2/Obsidian_Vault/wiki --name wiki
   qmd collection add ~/Dokumente/Playground/DevStack_v2/Obsidian_Vault/raw --name raw
   qmd embed
   ```
   Dann in `openclaw.json`:
   ```json
   "wiki-search": { "command": "qmd", "args": ["mcp"] }
   ```
