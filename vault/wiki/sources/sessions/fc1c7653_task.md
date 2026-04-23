---
title: LLM Wiki — Edge Node Integration
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# LLM Wiki — Edge Node Integration

## Phase 1: Daten filtern & kopieren
- [x] Gefilterte Dateien nach `Obsidian_Vault/raw/agent-logs/` kopiert (171 Dateien, 1.2 MB)
- [x] NotebookLM-Exporte nach `Obsidian_Vault/raw/notebooklm/` kopiert (159 Dateien, 4.6 MB)
- [x] Noise-Dateien ausgeschlossen (408 DOM-Dumps, 138 System-Steps, 49 Scratchpads)
- [x] Verifiziert: 330 Dateien total, 5.8 MB

## Phase 2: Wiki-Struktur aufbauen
- [x] `wiki/` Verzeichnis mit Unterordnern (entities, concepts, topics, sources)
- [x] `wiki/index.md` — Zentraler Inhaltskatalog
- [x] `wiki/log.md` — Chronologisches Operationsprotokoll
- [x] `schema/WIKI.md` — Regelwerk für GZMO (Ingest/Query/Lint Workflows)

## Phase 3: GZMO-Integration
- [x] `core_identity/AGENTS.md` — Wiki Maintenance Sektion + Heartbeat-Regeln
- [x] `core_identity/SOUL.md` — Knowledge Gardener Rolle hinzugefügt

## Phase 4: Seed-Ingest (14 Wiki-Seiten)
- [x] Entity-Seiten: GZMO, Edge-Node, OpenClaw, DevStack
- [x] Konzept-Seiten: Sovereign-AI, Agentic-Architecture, LLM-Wiki
- [x] Topic-Seiten: Trading-Automation, Linux-Workstation, Eignungsdiagnostik, Music-Production, Game-Engine
- [x] `wiki/overview.md` — High-Level-Synthese
- [x] Index & Log aktualisiert
- [x] Wikilinks verifiziert: 80+ Cross-References gesetzt

## Phase 5 (Future): qmd Search-Engine
- [ ] qmd installieren (`npm install -g @tobilu/qmd`)
- [ ] Collections für wiki/ und raw/ konfigurieren
- [ ] MCP-Server in openclaw.json eintragen (`"wiki-search": {"command":"qmd","args":["mcp"]}`)
