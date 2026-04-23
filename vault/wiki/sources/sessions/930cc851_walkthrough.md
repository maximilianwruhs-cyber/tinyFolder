---
title: Edge Node Stack — Setup & Launch Walkthrough
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Edge Node Stack — Setup & Launch Walkthrough

## Zusammenfassung

Komplett-Setup des Edge Node Sovereign AI Stacks: qmd Search Engine installiert, Dreams-Workflow verifiziert, Stack gestartet mit OpenRouter Free-Tier-Modell.

## Step 1: qmd Search Engine ✅

- **qmd v2.1.0** global installiert (`npm install -g @tobilu/qmd`)
- Collection `wiki` — 16 Dateien (kuratiertes LLM-Wiki)
- Collection `raw` — 330 Dateien (Agent-Logs + NotebookLM-Exporte)
- **2918 Vektor-Embeddings** generiert (GPU: GTX 1070)
- Context-Beschreibungen für beide Collections gesetzt
- CUDA native Build erfolgreich kompiliert (Driver 12.2 / Toolkit 12.0 Mismatch behoben)
- Test-Search erfolgreich: "GZMO identity evolution" → 5 Treffer, 86% Score

## Step 2: Dreams-Workflow ✅ (bereits vorhanden)

War schon aus der vorherigen Session da:
- `wiki/dreams/index.md` — Workflow-Definition
- `SOUL.md` — Self-Evolution via Dreams Direktive
- `AGENTS.md` — 🌙 Dreams Sektion mit Template

## Step 3: Edge Node Stack Launch ✅

### Architektur

| Container | Image | Status |
|---|---|---|
| edgenode-pgvector | ankane/pgvector | ✅ healthy |
| edgenode-openclaw | Custom (openclaw@2026.4.2) | ✅ live |
| edgenode-llama-engine | — | ⏸️ deaktiviert (kein Model) |

### Konfigurationsänderungen

#### [MODIFY] [.env](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/.env)
- Gemini API Key erneuert (alter war expired)
- OpenRouter API Key hinzugefügt
- SerpAPI Key hinzugefügt

#### [MODIFY] [docker-compose.yml](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/docker-compose.yml)
- `OPENROUTER_API_KEY` und `SERPAPI_API_KEY` an openclaw-gateway durchgereicht

#### [MODIFY] [openclaw.json](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/config/openclaw.json)
- Model von `google/gemini-3.1-pro-preview` → `openrouter/qwen/qwen3-coder:free` (Free-Tier, 480B MoE, 262K context)

### Probleme gelöst

1. **CUDA PTX Mismatch** — qmd Embedding Model crashte wegen inkompatiblem vorgebautem Binary. Lösung: node-llama-cpp wurde nativ für die lokale CUDA 12.0 Toolchain neu kompiliert
2. **Gemini API Key expired** — alter Key war abgelaufen, neuer Key eingetragen
3. **Gemini Free-Tier Quota exhausted** — auf OpenRouter Free-Tier gewechselt (Qwen3 Coder 480B)

## Verifizierung

- `curl http://127.0.0.1:18789/health` → `{"ok":true,"status":"live"}`
- Telegram Bot Provider gestartet, keine Fehler
- qmd search funktioniert mit GPU-Beschleunigung

## Nächste Schritte

1. **Telegram-Test** — GZMO eine Nachricht auf Telegram schicken, prüfen ob er antwortet
2. **qmd als MCP-Server** in openclaw.json eintragen (für Wiki-Suche direkt aus GZMO)
3. **Heartbeat testen** — prüfen ob GZMO den Wiki-Maintenance-Zyklus autonom startet
4. **Optional**: Gemini Billing aktivieren für stärkeres Modell (Gemini 2.5 Pro)
