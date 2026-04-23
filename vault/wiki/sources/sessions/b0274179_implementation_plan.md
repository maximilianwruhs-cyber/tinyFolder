---
title: 'Edge Node v2: Sovereign Agent — Clean Slate'
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Edge Node v2: Sovereign Agent — Clean Slate

GTX-1070-Ära ist vorbei. Qwen 2.5 3B schafft die Heartbeats nicht. Unsloth ist tot auf Pascal.
**Ziel: Alles rauswerfen was nicht funktioniert, den Node hardware- und model-agnostisch machen, und `install_node.sh` mit Phantom-Drive Hardware-Sensing bauen.**

Die neue Maschine macht `./install_node.sh` und bekommt einen voll konfigurierten Sovereign Agent.

---

## Was bleibt, was fliegt

| Komponente | Entscheidung | Begründung |
|---|---|---|
| **Ollama** | ✅ bleibt | Inference Engine, model-agnostisch — zieht sich selbst das passende Modell |
| **OpenClaw Gateway** | ✅ bleibt | Agent-Orchestrator, Telegram, ACP, MCP |
| **Obsidian Vault + qmd** | ✅ bleibt | Wiki, Dreams, hybrid RAG — funktioniert perfekt |
| **core_identity/** | ✅ bleibt | SOUL.md, AGENTS.md, CORTEX.md, MEMORY.md, HEARTBEAT.md |
| **dreams/ Workflow** | ✅ bleibt | Identity Evolution Pipeline — GZMO schlägt vor, User merged |
| **PGVector** | 🗑️ **PURGE** | 0 Tabellen, 0 Referenzen. qmd hat die RAG-Rolle komplett übernommen |
| **Unsloth Pipeline** | 🗑️ **PURGE** | Dockerfile, train_dreams.py, docker-compose.training.yml, training/data/ — alles weg |
| **Qwen 2.5 3B Hardcoding** | 🗑️ **PURGE** | Model wird dynamisch gewählt via `install_node.sh` basierend auf VRAM |
| **deploy.sh + init-secrets.sh** | 🗑️ → fusioniert in `install_node.sh` | Ein Skript statt drei |

---

## User Review Required

> [!IMPORTANT]
> **Dreams-Workflow bleibt intakt.** Die 3 pending Dreams (No-Yap, Tool-Fanatiker, ACP-Bewusstsein) bleiben als `proposed` im Vault. Sie werden **nicht** von mir in SOUL.md gemerged — das macht GZMO auf der neuen Maschine selbst über den Dreams-Workflow, sobald du sie approvst.

> [!IMPORTANT]
> **Modell-Agnostik:** Das `install_node.sh` wird basierend auf VRAM automatisch ein passendes Modell vorschlagen und pullen (z.B. 8GB → Qwen 2.5 3B, 12GB → Qwen 2.5 7B, 24GB → Qwen3 235B-A22B MoE). Die `openclaw.json` wird dynamisch generiert.

> [!WARNING]
> **PGVector PURGE:** Die PGVector-Datenbank hat 0 Tabellen. Qmd (BM25 + vector + LLM reranking) macht alles besser. Einverstanden mit komplettem Entfernen?

---

## Proposed Changes

### Phase 1: Purge — Totes Holz entfernen

#### [DELETE] `training/` (ganzes Verzeichnis)
- `Dockerfile.unsloth`
- `train_dreams.py`
- `ingest_brain.py`
- `train_orchestrator.sh`
- `data/` (auto-ingestierte Dateien)
- `output/` (leerer Output-Ordner)

#### [DELETE] `docker-compose.training.yml`

#### [DELETE] `deploy.sh` — wird durch `install_node.sh` ersetzt
#### [DELETE] `init-secrets.sh` — wird durch `install_node.sh` ersetzt

#### [MODIFY] [docker-compose.yml](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/docker-compose.yml)
- PGVector Service komplett entfernen
- `rag_data` Volume entfernen
- Ollama Model-ID parametrisieren via `${OLLAMA_MODEL:-qwen2.5:3b}`

#### [DELETE] `Modelfile` — Ollama Model-Hardcoding wird obsolet

---

### Phase 2: `install_node.sh` — Der Hardware-Sensing Wizard

#### [NEW] [install_node.sh](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/install_node.sh)

Fusioniert die besten Teile aus **Phantom-Drive** (`detect_gpu_arch()`, VRAM-Sensing, Tier-System) und **Edge-Node** (`deploy.sh`, `init-secrets.sh`):

```
┌──────────────────────────────────────────────────┐
│            install_node.sh Workflow               │
├──────────────────────────────────────────────────┤
│ 1. Hardware Probe                                │
│    ├─ detect_gpu_arch()     [phantom-drive]      │
│    ├─ get_cuda_cc()         [nvidia-smi]         │
│    ├─ get_available_vram()  [phantom-drive]      │
│    └─ get_available_ram()   [phantom-drive]      │
│                                                  │
│ 2. Model Selection (VRAM-basiert)                │
│    ├─ ≥24 GB → qwen3-235b-a22b (MoE)           │
│    ├─ ≥12 GB → qwen2.5:7b / gemma3:12b         │
│    ├─ ≥ 8 GB → qwen2.5:3b / gemma3:4b          │
│    └─ < 8 GB → phi4-mini:3.8b                   │
│                                                  │
│ 3. Interactive Config                            │
│    ├─ Obsidian Vault Pfad abfragen               │
│    ├─ Telegram Bot Token abfragen                │
│    ├─ API Keys (Gemini, optional)                │
│    └─ .env generieren                            │
│                                                  │
│ 4. Security                                      │
│    └─ OpenClaw Auth Token generieren             │
│                                                  │
│ 5. Deploy                                        │
│    ├─ docker compose up -d --build               │
│    ├─ ollama pull ${SELECTED_MODEL}              │
│    └─ Health Check                               │
│                                                  │
│ 6. Post-Install Report                           │
│    ├─ GPU: RTX 4060 (Ada, CC 8.9)               │
│    ├─ Model: qwen2.5:7b (12GB VRAM)             │
│    ├─ Telegram: @gzmo0815_bot ✓                  │
│    └─ qmd: Install instructions                  │
└──────────────────────────────────────────────────┘
```

Key-Features aus **Phantom-Drive** die wir übernehmen:
- `detect_gpu_arch()` — PCI ID hex-matching (Pascal → Blackwell)
- `get_available_vram_mb()` — nvidia-smi Query
- `select_model()` — VRAM-basierte Modellauswahl mit Fallback-Ladder
- PID Lock Pattern — verhindert Doppel-Starts
- Farbige Terminal-Ausgabe mit Log/Warn/Err/Ok Helper

---

### Phase 3: Config aktualisieren

#### [MODIFY] [.env.example](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/.env.example)
- PGVector-Referenzen entfernen
- Unsloth-Referenzen entfernen
- `OLLAMA_MODEL` Variable hinzufügen (wird von install_node.sh gesetzt)
- `CUDA_ARCHITECTURE` durch `GPU_ARCH` ersetzen (human-readable: "ada", "ampere", etc.)
- TurboQuant-Referenzen entfernen

#### [MODIFY] [config.example.json](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/config.example.json)
- Model-Hardcoding durch Platzhalter ersetzen
- `install_node.sh` setzt das Model dynamisch per `sed`

---

### Phase 4: Identity-Dateien bereinigen

#### [MODIFY] [MEMORY.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/core_identity/MEMORY.md)
- Unsloth-Referenz raus
- "GTX 1070" raus — Hardware wird dynamisch beschrieben
- Modell-Hardcoding raus — wird zur Laufzeit aus Ollama gelesen
- PGVector-Referenz raus
- Open Dreams: Status bleibt `proposed` (GZMO merged sie selbst)
- Neuer Lesson Learned: "Hardware changes — use install_node.sh to reconfigure"

#### [MODIFY] [HEARTBEAT.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/core_identity/HEARTBEAT.md)
- Unsloth-Referenzen entfernen
- Dream Cycle Workflow bleibt (ohne Training-Step)

#### [MODIFY] [dreams/index.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/Obsidian_Vault/wiki/dreams/index.md)
- Die 3 Dreams (No-Yap, Tool-Fanatiker, ACP-Bewusstsein) in "Open Proposals" aufnehmen
- Status bleibt `proposed`

#### [MODIFY] Dream Frontmatter (alle 3 Dateien)
- `status: "pending_unsloth"` → `status: "proposed"`
- Die Dreams sollen über den normalen Workflow laufen, nicht über Training

---

### Phase 5: README + Migration Guide

#### [MODIFY] [README.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/README.md)
Komplettüberarbeitung:
- "Sovereign Agent Stack" statt "Agentic AI Stack"
- Architektur-Diagramm: PGVector raus, model-agnostisch
- Quick Start: `./install_node.sh` statt manuellem Flow
- Training-Referenzen komplett entfernen
- Phantom-Drive Heritage erwähnen (Hardware-Sensing)

#### [NEW] [MIGRATION.md](file:///home/maximilian-wruhs/Dokumente/Playground/DevStack_v2/edge-node/MIGRATION.md)
```markdown
# Migration auf neue Hardware

1. git clone <repo> edge-node && cd edge-node
2. ./install_node.sh
3. Obsidian Vault Pfad angeben (oder bestehenden kopieren)
4. Fertig.

Das install_node.sh erkennt deine GPU, wählt das optimale
Modell, generiert alle Configs, und startet den Stack.
```

---

## Open Questions

> [!IMPORTANT]
> **1. PGVector PURGE okay?** 0 Tabellen, 0 Code-Referenzen. qmd hat alles übernommen.

> [!IMPORTANT]
> **2. Training komplett raus?** `training/` Verzeichnis wird gelöscht. Modelle kann man extern trainieren, der Edge Node ist für Inference + Agent + Wiki.

> [!IMPORTANT]
> **3. Dreams-Status:** Die 3 pending Dreams werden von `pending_unsloth` auf `proposed` gesetzt und bleiben im Vault. GZMO verarbeitet sie selbst auf der neuen Maschine wenn du sie approvst. Korrekt?

> [!IMPORTANT]
> **4. Modell-Empfehlung in install_node.sh:** Soll das Skript das Modell automatisch pullen, oder nur empfehlen und fragen?

---

## Verification Plan

### Automated Tests
1. `./install_node.sh --dry-run` → muss GPU erkennen, Modell empfehlen, Config-Preview zeigen
2. `grep -r "pgvector\|unsloth\|training" docker-compose.yml` → 0 Treffer
3. `grep -r "qwen2.5:3b" .` → Nur in Beispielen, nicht hardcoded
4. `docker compose config` → muss ohne Fehler parsen (2 Services: ollama + openclaw)
5. Dreams-Status Check: `grep "status:" Obsidian_Vault/wiki/dreams/*.md` → alle `proposed` oder `merged`

### Manual Verification
- Auf neuer Maschine: `./install_node.sh` → Full Stack kommt hoch mit passendem Modell
- GZMO über Telegram anschreiben → antwortet mit neuem Modell
