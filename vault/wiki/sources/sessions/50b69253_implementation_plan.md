---
title: Unsloth "Dreams" Fine-Tuning Pipeline
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Unsloth "Dreams" Fine-Tuning Pipeline

Der `train_orchestrator.sh` wurde erfolgreich ausgeführt. Step 1 (Das Parsen der Dreams durch `ingest_brain.py`) hat einwandfrei funktioniert; deine neuen Memory-Files liegen fixfertig formatiert im `training/data/` Verzeichnis. 

**Jedoch:** Step 2 und Step 3 (das eigentliche Unsloth-Training und das Hot-Reloading in Ollama) sind aktuell nur als Konzept-Dummys auskommentiert, da weder das Python-Skript (`train_dreams.py`) noch die Python-Umgebung inkl. Unsloth/PyTorch auf deiner Edge-Node existieren.

Um den "Dreams"-Loop in die Tat umzusetzen, müssen wir die Unsloth-Pipeline jetzt programmieren.

## Feedback & Decisions
Dank deines Feedbacks haben wir nun eine klare Marschrichtung:

1. **Hardware-Agnostisches "Grundgerüst"**: Wir nutzen einen dedizierten **Docker-Container (`unsloth-trainer`)** für das Training. So bleibt die Edge-Node absolut sauber und das System ist sofort portierbar (auf "bessere Rechner" in der Zukunft), ohne dass wir lokal mit Pipenv & Conda herumbasteln müssen.
2. **Die "blöde GTX 1070" (Pascal Architektur)**: Der Hund lag beim letzten Mal vermutlich bei der Architektur begraben. Die GTX 1070 besitzt noch Compute Capability 6.1 und unterstützt kein `bfloat16` (das moderne Format für LLMs). Ich werde den Python-Code so schreiben, dass er die alte Pascal-Architektur erkennt und automatisch auf sicheres `float16` zurückfällt!
3. **Paralleler Betrieb (Kein VRAM-Kill)**: Ollama bleibt laufen! Ein zukünftiger (besserer) Rechner lacht über die parallele Auslastung. Wir legen das Skript also robust aus, anstelle von dreckigen Workarounds.

## Proposed Changes

### 1. Create `docker-compose.training.yml`
Wir bauen einen dedizierten Service `unsloth-trainer`, der alle ML-Abhängigkeiten (PyTorch, Unsloth, Xformers für Pascal) vorinstalliert mitbringt. Er wird lokal gebuildet und startet nur dann, wenn das Bash-Skript ihn triggert.

### 2. Create `training/train_dreams.py`
Ein frisches neues Skript in deinem Training-Ordner, welches:
- Den `qwen2.5-3b-instruct` aus deinem SSD-Lager lädt.
- **Wichtig**: Harte GPU-Prüfung macht! (Falls Pascal/GTX 1070 erkannt wird -> Fallback auf `dtype=float16` anstatt `bfloat16`, sonst Crash).
- Den Unsloth-SFTTrainer initialisiert mit dem in Schritt 1 erzeugten `data` Datensatz.
- Ein neues quantisiertes GGUF (4-bit) Model exportiert.

### 3. Update `training/train_orchestrator.sh`
- Einkommentieren der Unsloth-Aufrufe als Docker-Run-Befehl: `docker-compose -f docker-compose.training.yml up unsloth-trainer`
- Sobald er fertig ist, triggern wir den Ollama Hot-Reload.

## Open Questions

Ich habe deinen Input verstanden und den Plan entsprechend wasserdicht gemacht. 
**Gibt mir einfach ein GO (Approve), und ich beginne mit der Umsetzung der Docker-Files und des Unsloth-Skripts!**
