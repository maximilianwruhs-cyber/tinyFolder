---
title: DevStack_v2 — Full Project Audit
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# DevStack_v2 — Full Project Audit

## Disk Usage

| Directory | Size | Purpose | Verdict |
|---|---|---|---|
| `BitNet/` | **39 GB** | llama.cpp 1-bit fork + compiled `build/` | 🗑️ **PURGE** |
| `AOS/` | 7.7 GB | Dev environment (FastAPI gateway) | ✅ keep (hat eigenen `.venv`) |
| `TurboQuant/` | 2.4 GB | llama.cpp speculative decoding fork | 🗑️ **PURGE** |
| `AOS VS Codium Extension/` | 200 MB | VS Codium sidebar plugin | ⚠️ veraltet |
| `Obsidian_Vault/` | 20 MB | Wiki + raw sources | ✅ keep |
| `AOS_Brain/` | 3.5 MB | Nur `04_Visual_ARC/` drin | 🗑️ **PURGE** |
| `unsloth_compiled_cache/` | 1.7 MB | 30 PyTorch Compiled Module Caches | 🗑️ **PURGE** |
| `edge-node/` | 1.5 MB | Sovereign Agent Stack | ✅ keep (frisch aufgeräumt) |

---

## 🗑️ Tote Projekte — sofort löschbar

### 1. `BitNet/` — 39 GB (!!!)
- Ein geklonter llama.cpp 1-bit Fork mit kompilierten `build/` Artefakten
- **39 GB** auf der Festplatte für ein Experiment das nie in Produktion ging
- Modell-Kandidat "Falcon3 3B 1.58-bit" wurde in Session 57af45bf explizit als "Not Ready for Stable Training" klassifiziert
- **Empfehlung:** `rm -rf BitNet/` spart 39 GB

### 2. `TurboQuant/` — 2.4 GB
- Eigener Fork von llama.cpp mit Speculative Decoding
- **Vollständig ersetzt durch Ollama** seit der Migration in Session 57af45bf
- Enthält noch `server_architect.log` (23 KB), `.venv/` (groß), kompilierte `build/` Artefakte
- Das Root `docker-compose.yml` referenziert noch TurboQuant auf Port 1238 — aber dieser Stack ist tot
- **Empfehlung:** `rm -rf TurboQuant/` spart 2.4 GB

### 3. `unsloth_compiled_cache/` — 1.7 MB
- 30 PyTorch-kompilierte Module (SFTTrainer, CPOTrainer, BatchNorm, etc.)
- Unsloth-Artefakte die bei der Training-Pipeline-Entwicklung gecached wurden
- **Unsloth ist vollständig aus dem Edge Node entfernt** — dieser Cache ist verwaist
- **Empfehlung:** `rm -rf unsloth_compiled_cache/`

### 4. `AOS_Brain/` — 3.5 MB
- Enthält NUR ein leeres Sub-Verzeichnis: `04_Visual_ARC/`
- War mal für Training-Daten gedacht, aber `ingest_brain.py` wurde in `edge-node/training/` verschoben (und dann gelöscht)
- **Empfehlung:** `rm -rf AOS_Brain/`

---

## ⚠️ Veraltet — braucht Review

### 5. `AOS VS Codium Extension/` — 200 MB
- TypeScript Extension für VS Codium Sidebar (Telemetrie, Leaderboard)
- Enthält eine vorgebaute `.vsix` Datei, `node_modules/`, `_archive/`
- **Frage:** Wird das noch aktiv entwickelt? Falls nicht → purge (200 MB gespart)

### 6. Root `docker-compose.yml`
- Referenziert:
  - `AOS_BACKEND_URL=http://127.0.0.1:1238/v1` — **TurboQuant Port (tot)**
  - `pgvector-data` Volume — **PGVector (aus Edge Node gelöscht)**
  - `sovereign-net` Network — **unbenutzt**
- Das Edge Node hat seinen eigenen `docker-compose.yml` — dieser Root-Level ist redundant
- **Empfehlung:** Updaten (AOS zeigt auf Ollama statt TurboQuant) oder löschen

### 7. Root `README.md`
- Beschreibt das alte Architektur-Diagramm mit TurboQuant, Port 1238/1239, pgvector, Speculative Decoding
- Erwähnt `edge-node/` **gar nicht**
- **Komplett veraltet** — braucht Neufassung

### 8. Root-Level Loose Files
| Datei | Problem |
|---|---|
| `docker_procs.txt` | Snapshot der Docker-Container vom 13. April — Debugging-Artefakt |
| `sys_procs.txt` | Snapshot aller Systemprozesse — Debugging-Artefakt |
| `launch.sh` | Startet `AOS/tui.app` — noch relevant falls AOS dev-aktiv |
| `USAGE.md` | 6 KB Anleitung — müsste geprüft werden ob noch aktuell |
| `_config.yml` | Jekyll Theme Config (GitHub Pages?) — wahrscheinlich tot |
| `.env.example` | Referenziert `TURBOQUANT_MODEL`, `pgvector`, `MODELS_DIR` — veraltet |

---

## ✅ Sauber — kein Problem

| Projekt | Status |
|---|---|
| `edge-node/` | ✅ Frisch aufgeräumt (18 Dateien, 0 Ballast) |
| `Obsidian_Vault/` | ✅ 17 Wiki-Seiten + 330 raw sources, qmd-indexiert |
| `AOS/` | ✅ Eigenständiges Python-Projekt mit eigenem Git |

---

## Zusammenfassung: Mögliche Einsparung

| Aktion | Ersparnis |
|---|---|
| `rm -rf BitNet/` | **39.0 GB** |
| `rm -rf TurboQuant/` | **2.4 GB** |
| `rm -rf AOS_Brain/` | **3.5 MB** |
| `rm -rf unsloth_compiled_cache/` | **1.7 MB** |
| `rm docker_procs.txt sys_procs.txt _config.yml` | ~33 KB |
| **Total** | **~41.4 GB** |

Plus optional: `AOS VS Codium Extension/` (200 MB) wenn nicht mehr aktiv.
