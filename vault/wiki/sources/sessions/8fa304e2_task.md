---
title: Edge-Node Portability Refactor
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Edge-Node Portability Refactor

- [x] `.env.example` Template — GPU-Config, Setup-Anleitung, `MODEL_STORAGE_PATH` entfernt (Ollama macht das)
- [x] `.gitignore` — war schon korrekt (schützt `.env`, `config/`, `training/data/`, `training/output/`)
- [x] `training/ingest_brain.py` — hardcoded Pfad-Fallback entfernt → erfordert jetzt explizit `OBSIDIAN_VAULT_PATH`
- [x] `training/train_orchestrator.sh` — Pre-flight Env-Validation + Ollama Hot-Reload Pfad-Fix (`docker cp` statt hardcoded Volume-Pfad)
- [x] `config.example.json` — Hardcoded Auth-Token durch Placeholder ersetzt, auf aktuellen Feature-Stand gebracht (Ollama, qmd, ACPX)
- [x] `deploy.sh` — Legacy GGUF-Prüfung entfernt, `init-secrets.sh` Auto-Run, auf Ollama-Stack angepasst
- [x] `README.md` — Komplett neu geschrieben: Ollama-Architektur, Dreams-Pipeline, ASCII-Diagramm, File-Übersicht
- [x] Verifiziert: Null hardcoded Pfade in Source-Code (nur in gitignored `.ingest_manifest.json`)
