---
title: GZMO Edge-Node - Portability & Deployment Audit
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# GZMO Edge-Node - Portability & Deployment Audit

Dieses Dokument fasst alle hardcodierten Pfade, Secrets und maschinenspezifischen Parameter zusammen, die aktuell im Code vergraben sind. Um die Edge-Node als robustes, portables "Grundgerüst" (z.B. für den Umzug auf einen stärkeren Rechner oder einen Cloud-Server) deployen zu können, müssen diese Parameter abstrahiert werden.

## 1. Gefundene Lokale Abhängigkeiten (Hardcoded Values)

### A. Pfade & Speichermedien
- **`training/train_orchestrator.sh`**
  - *Hardcoded*: `QWEN_MODEL_PATH="/media/maximilian-wruhs/Extreme SSD/LLM_Models_Export/models--unsloth--qwen2.5-3b-instruct-bnb-4bit"`
  - *Problem*: Verweist explizit auf eine externe SSD, die nur auf diesem Host existiert.
- **`training/ingest_brain.py`**
  - *Hardcoded*: `OBSIDIAN_VAULT = Path.home() / "Dokumente" / "Playground" / "DevStack_v2" / "Obsidian_Vault"`
  - *Problem*: Funktioniert nur, wenn das Vault genau in diesem Windows/Linux User-Folder liegt.
- **`docker-compose.yml`**
  - *Abhängigkeit*: Nutzt intern `${OBSIDIAN_VAULT_PATH}` und mountet `${HOME}/.cache/qmd`. Setzt voraus, dass diese Variablen im Environment aufscheinen.

### B. Secrets & Tokens
- **`config/openclaw.json`**
  - *Hardcoded*: `"token": "0a9892ad1f2f99d506fa2494d40ac7793bc6bade44aa447e"`
  - *Problem*: Der Gateway-Auth-Token für das ACP-Plugin/Browser-Control liegt im Klartext in der JSON-Config.
- **`docker-compose.yml`**
  - *Abhängigkeit*: Lädt API-Keys (`GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DB_PASSWORD` etc.) aus dem System, es fehlt jedoch ein klar strukturiertes `.env` Template.

---

## 2. Konzept für eine portable Version

Um das Projekt auf Knopfdruck ("Plug & Play") auf jeder neuen Hardware starten zu können, sollten wir folgende Architekturänderungen vornehmen:

### Das universelle `.env` File
Alle projektspezifischen Konstanten werden aus dem Code gelöscht und wandern in eine zentrale `.env` Datei. Wir werden eine `.env.example` Datei erstellen, die man beim Start einer neuen Node nur noch kopieren und ausfüllen muss.

```env
# ----------------------------------------
# 1. PATH CONFIGURATION
# ----------------------------------------
# Der absolute Pfad zum Obsidian Vault (Wissensbasis)
OBSIDIAN_VAULT_PATH=/path/to/your/Obsidian_Vault
# Der Pfad zu deinen Basis-Modellen für das Unsloth-Training
MODEL_STORAGE_PATH=/path/to/your/SSD/LLM_Models_Export

# ----------------------------------------
# 2. AGENT SECRETS & API KEYS
# ----------------------------------------
TELEGRAM_BOT_TOKEN=your_telegram_token
GEMINI_API_KEY=your_gemini_key
OPENROUTER_API_KEY=your_openrouter_key
SERPAPI_API_KEY=your_serpapi_key

# ----------------------------------------
# 3. INTERNAL SECURITY
# ----------------------------------------
# Generierter Token für die ACP Kommunikation (VS Code <-> Agent)
OPENCLAW_AUTH_TOKEN=generate_random_hex_here
# Passwort für die PGVector Datenbank
DB_PASSWORD=rag_secure_pass
```

### Anpassungen im Code
1. **Python & Bash Skripte**: `ingest_brain.py` und `train_orchestrator.sh` werden so umgebaut, dass sie die Pfade mittels `os.getenv("OBSIDIAN_VAULT_PATH")` respektive `$MODEL_STORAGE_PATH` einlesen.
2. **OpenClaw Adapter**: Wenn möglich, ersetzen wir in der `openclaw.json` den fixen Auth-Token durch ein environment variable mapping (oder wir schreiben ein winziges Init-Skript, welches die JSON-Datei beim Systemstart on-the-fly mit den Werten aus der `.env` befüllt).

### Die "How to Configure" Anleitung (README.md)
Es wird ein Dokumentation-File geben, welches dem Nutzer beim Deployen genau 3 kurze Befehle vorgibt:
1. `cp .env.example .env`
2. Pfade in der `.env` eintragen
3. `docker-compose up -d && ./training/train_orchestrator.sh`

> [!TIP]
> **Vorteil dieser Trennung:** Wenn du auf einen stärkeren Rechner wechselst, musst du dort nur den Code per `git clone` ziehen, die `.env` an den neuen SSD-Pfad anpassen, und der Edge-Node läuft binnen Sekunden identisch hoch!
