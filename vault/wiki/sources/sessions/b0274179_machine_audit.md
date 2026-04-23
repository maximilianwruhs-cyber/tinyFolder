---
title: 'Maschinen-Audit: Reclaimable Disk Space'
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Maschinen-Audit: Reclaimable Disk Space

**Disk: 308 GB benutzt / 937 GB total (35%)**

---

## 🐳 Docker — 88 GB reclaimable

Das ist der mit Abstand größte Posten. Docker hortet alte Images und Build-Caches.

| Was | Größe | Details |
|---|---|---|
| **Dangling Images** | ~22 GB | 3 untagged images (inkl. 20.3 GB alter Unsloth Build) |
| **Unbenutzte Images (90%)** | ~79 GB | 80 Images total, nur 2 aktiv (ollama + openclaw). Rest: `swe-bench` evaluations, `openclaw-contained-*`, `n8n`, alter `unsloth-trainer` (16.7 GB) |
| **Build Cache** | 12 GB | 149 cache entries, 0 aktiv |
| **Unbenutzte Volumes** | ~10 GB | 12 verwaiste Volumes (pgvector, openclaw-contained, trading-agent, etc.) |

```bash
# Nuclear option — alles unbenutzte weg:
docker system prune -a --volumes
# Oder gezielt:
docker image prune -a    # alle ungenutzten Images
docker builder prune -a   # Build Cache
docker volume prune       # verwaiste Volumes
```

---

## 📥 Downloads — 11.2 GB

| Datei | Größe | Löschbar? |
|---|---|---|
| `ubuntu-24.04.4-desktop-amd64.iso` | 6.2 GB | ✅ Ubuntu ist installiert |
| `ubuntu-24.04.4-live-server-amd64.iso` | 3.2 GB | ✅ Ubuntu ist installiert |
| `GZMO-main.zip` | 1.1 GB | ✅ Bereits extrahiert |
| `LM-Studio-0.4.8-1-x64.deb` | 615 MB | ✅ Bereits installiert |
| `google-chrome-stable_current_amd64.deb` | 122 MB | ✅ Bereits installiert |

```bash
rm ~/Downloads/ubuntu-*.iso ~/Downloads/GZMO-main.zip \
   ~/Downloads/LM-Studio-*.deb ~/Downloads/google-chrome-*.deb
```

---

## 🧠 Modell-Caches — 25 GB total

| Cache | Größe | Was drin? | Aktion |
|---|---|---|---|
| `.local/share/aos/models/` | **11 GB** | `qwen/` (5.8 GB) + `gemma4/` (5.0 GB) — GGUF Modelle für TurboQuant | ⚠️ TurboQuant ist gelöscht → Modelle prüfen |
| `.lmstudio/` | **6.7 GB** | Extensions (3.7 GB), LLMster (2.6 GB), Bins, Logs | ⚠️ Nutzt du LM Studio noch? |
| `.ollama/models/` | **5.3 GB** | Qwen 2.5:3b (aktiv!) | ✅ behalten |
| `.cache/huggingface/hub/` | **2.1 GB** | HF Model Downloads (vermutlich Unsloth-Artefakte) | ⚠️ prüfen |

---

## 📦 Package Manager Caches — 5.2 GB

| Cache | Größe | Safe to clear? |
|---|---|---|
| `.npm/` | 2.4 GB | ✅ `npm cache clean --force` |
| `.cache/uv/` | 1.2 GB | ✅ Python package cache |
| `.cache/go-build/` | 627 MB | ✅ Go build cache |
| `.cache/Homebrew/` | 930 MB | ✅ `brew cleanup` |

---

## 🌐 Browser & App Caches — 1.8 GB

| Cache | Größe | Safe? |
|---|---|---|
| `.cache/google-chrome/` | 1.1 GB | ✅ Regeneriert sich |
| `.cache/electron/` | 330 MB | ✅ alte Electron Downloads |
| `.cache/tracker3/` | 271 MB | ✅ GNOME file indexer cache |
| `.cache/cloud-code/` | 127 MB | ✅ Google Cloud Code cache |

---

## 📊 Zusammenfassung

| Kategorie | Potenzielle Einsparung |
|---|---|
| Docker (prune all) | **~88 GB** |
| Downloads (ISOs/debs) | **~11 GB** |
| AOS Models (TurboQuant tot) | **~11 GB** |
| LM Studio (falls ungenutzt) | **~6.7 GB** |
| Package Caches (npm/uv/go/brew) | **~5.2 GB** |
| HuggingFace Cache | **~2.1 GB** |
| Browser/App Caches | **~1.8 GB** |
| **Grand Total** | **~126 GB** |

Danach: **~182 GB belegt** statt **308 GB**. Über 40% gespart.

---

## ⚡ Quick Wins (low risk, high reward)

```bash
# 1. Docker cleanup (BIGGEST WIN)
docker system prune -a --volumes

# 2. Downloads aufräumen
rm ~/Downloads/ubuntu-*.iso ~/Downloads/GZMO-main.zip \
   ~/Downloads/LM-Studio-*.deb ~/Downloads/google-chrome-*.deb

# 3. Package caches
npm cache clean --force
rm -rf ~/.cache/uv/ ~/.cache/go-build/ ~/.cache/electron/

# 4. AOS legacy models (prüfe vorher ob noch gebraucht)
# rm -rf ~/.local/share/aos/models/
```
