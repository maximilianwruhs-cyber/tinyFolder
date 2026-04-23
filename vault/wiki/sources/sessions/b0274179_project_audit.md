---
title: 'Projekt-Audit: Verfeinerungspotenzial'
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Projekt-Audit: Verfeinerungspotenzial

## edge-node ✅ — Sauber

Das Edge-Node Projekt ist nach dem heutigen Refactor bereits clean. **Kein Handlungsbedarf.**

18 Dateien, 0 Shims, 0 tote Referenzen, 0 Duplikate.

---

## AOS — Braucht Deep Clean

### 🏗️ Architektur-Schuld: Die Shim-Schicht

AOS hat eine halbfertige DDD-Migration durchlaufen. Code wurde von `telemetry/` und `tools/` nach `features/` und `infra/` verschoben, aber die alten Pfade existieren noch als **Re-Export Shims**:

| Shim (2-3 Zeilen) | Re-exportiert von | Importeur (die die Shims nutzen) |
|---|---|---|
| `telemetry/fitness_scorer.py` | `features/benchmark/fitness_scorer` | niemand direkt |
| `telemetry/model_discovery.py` | `features/benchmark/model_discovery` | niemand direkt |
| `telemetry/recommender.py` | `features/benchmark/recommender` | niemand direkt |
| `telemetry/runner.py` | `features/benchmark/runner` | `tools/hardware_telemetry.py` |
| `telemetry/task_suite.py` | `features/benchmark/task_suite` | niemand direkt |
| `telemetry/evaluator.py` | `features/evaluation/evaluator` | `inference/service.py`, `inference/router.py`, `gateway/routes.py`, `benchmark/runner.py` |
| `telemetry/energy_meter.py` | `features/energy/meter` | `inference/router.py`, `gateway/routes.py`, `benchmark/runner.py` |
| `telemetry/awattar.py` | `features/energy/pricing` | `inference/router.py`, `benchmark/recommender.py`, `benchmark/runner.py` |
| `telemetry/leaderboard.py` | *nichts* (empty shim) | niemand |
| `tools/watchdog.py` | `infra/watchdog` | niemand direkt |
| `tools/vram_manager.py` | `infra/vram` | `inference/service.py`, `inference/router.py`, `gateway/routes.py` |
| `rag_engine.py` | `features/rag/engine` | niemand direkt |

> [!TIP]
> **Fix:** Die 9 Importe in `inference/`, `gateway/`, `benchmark/` direkt auf `features.*` und `infra.*` umbiegen, dann die 12 Shim-Dateien löschen. Spart ~30 Dateien (inkl. `__pycache__`) und macht den Import-Graph klar.

---

### 🗑️ Toter Code

#### 1. `features/training/` — 293 Zeilen
- `merge_datasets.py` (86), `merge_lora.py` (54), `train_native_micro.py` (153)
- Diese referenzieren Unsloth, TinyLlama, LoRA — alles tot seit dem Edge-Node Refactor
- **Empfehlung:** Löschen oder in `_archive/` verschieben

#### 2. `requirements-unsloth.txt` — 20 Zeilen
- Pinned PyTorch + Unsloth dependencies für GTX 1070
- **Empfehlung:** Löschen

#### 3. `scripts/master_train_pipeline.sh` — 43 Zeilen
- Orchestriert: train → merge LoRA → convert to GGUF → quantize → restart engine → benchmark
- Referenziert **TurboQuant** (`convert_hf_to_gguf.py`, `llama-quantize`) — beides gelöscht
- **Empfehlung:** Löschen

#### 4. `scripts/boot/start_engine.sh` — 48 Zeilen
- Startet TurboQuant mit Qwen 3.5-9B + 0.5B Drafter auf Port 1238
- **TurboQuant ist gelöscht** — Script ist tot
- **Empfehlung:** Löschen

#### 5. `scripts/boot/start_autocomplete.sh` — 21 Zeilen
- Startet TurboQuant FIM Engine auf Port 1239
- Gleicher Grund — tot
- **Empfehlung:** Löschen

#### 6. `scripts/centralize_models.sh` — 197 Zeilen
- Verschiebt GGUF-Modelle in ein zentrales Verzeichnis
- Referenziert LM Studio Pfade, TurboQuant Modelle
- **Empfehlung:** Prüfen — könnte für Ollama adaptiert werden, aber ist wahrscheinlich überflüssig

#### 7. `scripts/run_benchmarks.sh` — 93 Zeilen
- Referenziert Port 1238 (TurboQuant)
- **Empfehlung:** Updaten (auf Ollama umbiegen) oder löschen

#### 8. `scripts/deploy/rag_watcher.py` — 118 Zeilen
- File-watcher der Obsidian Vault Änderungen in pgvector embeddet
- **pgvector ist tot** — ersetzt durch qmd
- **Empfehlung:** Löschen

#### 9. `deploy/` Verzeichnis — diverse tote Referenzen
- `bootstrap.sh`: 9× pgvector Referenzen
- `ansible/install.yml`: pgvector Start-Tasks
- `systemd/aos-engine-main.service`: Port 1238
- `systemd/aos-engine-autocomplete.service`: Port 1239
- `systemd/aos-rag-watcher.service`: rag_watcher.py
- **Empfehlung:** Alles updaten oder löschen

---

### 🔄 Duplikate

#### `core_identity/` — 2 divergierte Kopien

Beide Projekte haben ein eigenes `core_identity/`:

| Datei | edge-node | AOS | Status |
|---|---|---|---|
| `SOUL.md` | 50 Zeilen (aktuell) | ? Zeilen | **DIFFERENT** — vermutlich veraltet |
| `AGENTS.md` | 282 Zeilen (aktuell) | ? Zeilen | **DIFFERENT** |
| `MEMORY.md` | 47 Zeilen (frisch) | ? Zeilen | **DIFFERENT** |
| `HEARTBEAT.md` | 19 Zeilen (frisch) | ? Zeilen | **DIFFERENT** |
| `USER.md` | 13 Zeilen | 13 Zeilen | **IDENTICAL** |
| `CORTEX.md` | 33 Zeilen | ❌ fehlt | nur edge-node |
| `IDENTITY.md` | ❌ gelöscht | ✅ vorhanden | **DEAD** in AOS |
| `TOOLS.md` | ❌ gelöscht | ✅ vorhanden | **DEAD** in AOS |
| `README.md` | ❌ gelöscht | ✅ vorhanden | **DEAD** in AOS |

> [!IMPORTANT]
> **Edge-node hat die kanonische Version.** AOS hat die alte + 3 tote Dateien (IDENTITY.md, TOOLS.md, README.md).
> **Fix:** AOS `core_identity/` entweder via Symlink auf edge-node's Version zeigen lassen, oder die AOS-Kopie auf den gleichen Stand bringen.

#### `AOS_Brain/` — Leeres Dir innerhalb AOS
- Enthält nichts Nützliches, nur ein git-submodule Relikt
- **Empfehlung:** Löschen

---

### 🧹 Hygiene

| Was | Aktion |
|---|---|
| `__pycache__/` (2269 Verzeichnisse!) | `find . -name __pycache__ -exec rm -rf {} +` |
| `config/__pycache__/` (2 .pyc) | Löschen |
| `data/pgdata/` (175 MB, permission denied) | PGVector Postgres Daten — braucht `sudo rm -rf` |
| `_archive/unsloth/` (2 tote Training Scripts) | Schon archiviert, aber veraltet |
| `AOS/docker-compose.yml` | Nur pgvector Service — entweder updaten oder löschen |
| `AOS/.env` + `.env.example` | Referenziert `TURBOQUANT_MODEL`, `PG_*` Variablen |

---

## Zusammenfassung: Aufwand vs. Impact

| Aktion | Dateien | Zeilen | Aufwand |
|---|---|---|---|
| Shims eliminieren (Imports umbiegen) | -12 Shims, ~9 Import-edits | ~36 Zeilen gespart | 🔧 mittel |
| Training-Code purgen | -3 Dateien + req file + script | ~400 Zeilen | 🗑️ trivial |
| TurboQuant-Scripts purgen | -4 Scripts | ~310 Zeilen | 🗑️ trivial |
| Deploy/Systemd updaten | ~6 Dateien | ~300 Zeilen | 🔧 mittel |
| core_identity synchronisieren | 5 Dateien | Divergenz auflösen | ⚠️ Designentscheidung |
| rag_watcher + pgvector purgen | -2 Dateien + docker-compose | ~170 Zeilen | 🗑️ trivial |
| `__pycache__` + `data/pgdata` | 2269 dirs + 175 MB | — | 🗑️ trivial |
