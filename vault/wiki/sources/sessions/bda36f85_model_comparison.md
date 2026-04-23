---
title: 'Modellvergleich: GZMO Edge Node auf GTX 1070 (8GB eGPU)'
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Modellvergleich: GZMO Edge Node auf GTX 1070 (8GB eGPU)

## Anforderungen

| Kriterium | Wert |
|---|---|
| **VRAM** | 8.192 MiB (GTX 1070 via Thunderbolt eGPU) |
| **Min. Context** | ~20K Tokens (19K System-Prompt + Antwort) |
| **Primärer Use Case** | Autonomer Agent: Tool-Calling, Heartbeat, Wiki-Maintenance, Dreams |
| **KV-Cache** | TurboQuant turbo4 (3.8× Kompression) verfügbar |
| **Inference Engine** | llama.cpp (TurboQuant Fork) |

## VRAM-Budget-Rechnung

```
8.192 MiB Total
- Modell-Weights (quantisiert)
- KV-Cache (turbo4: ~0.13 MiB pro 1K Tokens bei 4B, ~0.3 MiB bei 9B)
- Overhead (~200 MiB)
= verfügbarer Context
```

---

## Die Kandidaten

### 🥇 Gemma 4 E4B-it (Q4_K_M) — **EMPFEHLUNG**

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~5.0 GB |
| Nativer Context | 128K Tokens |
| Freier VRAM nach Modell | ~3.0 GB → **~24K–40K Context mit turbo4** |
| Tool Calling | ✅ **Nativ eingebaut** (nicht prompt-basiert) |
| Thinking Mode | ✅ Ja |
| Multimodal | ✅ Text + Bild + Audio |
| Lizenz | Apache 2.0 |

**Pro:**
- ✅ **Natives Function Calling** — kein Prompt-Engineering nötig, zuverlässiger
- ✅ **Genug VRAM für 24K+ Context** — passt für den 19K System-Prompt
- ✅ Google-Optimierung für Edge-Deployment (genau unser Use Case)
- ✅ Apache 2.0 — volle kommerzielle Freiheit
- ✅ Thinking Mode für komplexe Reasoning-Tasks
- ✅ **Bereits auf der SSD vorhanden** (`gemma-4-E4B-it-Q4_K_M.gguf`, 5.0G)

**Contra:**
- ⚠️ 4B aktive Parameter — weniger "intelligent" als 8-9B Modelle
- ⚠️ Noch relativ neu (April 2026), Community-Erfahrung wächst noch

---

### 🥈 Qwen3-4B (Q4_K_M)

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~2.4 GB |
| Nativer Context | 32K Tokens |
| Freier VRAM nach Modell | ~5.6 GB → **~32K+ Context problemlos** |
| Tool Calling | ✅ Prompt-basiert (gut getestet) |
| Thinking Mode | ✅ Hybrid (toggle thinking on/off) |
| Lizenz | Apache 2.0 |

**Pro:**
- ✅ **Extrem klein** — nur 2.4 GB, massig Headroom für Context
- ✅ Qwen-Familie hat exzellente Coding/Logic-Benchmarks
- ✅ Hybrid Thinking Mode (schnell oder deep, per Request)
- ✅ **Bereits auf SSD vorhanden** (`qwen3-4b.Q4_K_M.gguf`, 2.4G)

**Contra:**
- ⚠️ Nur 4B Parameter — bei komplexen Agentic-Tasks schwächer
- ⚠️ Tool Calling nicht nativ, prompt-basiert = fehleranfälliger

---

### 🥉 Qwen3.5-9B (Q4_K_M) — aktuell installiert

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~5.3 GB |
| Nativer Context | 128K Tokens |
| Freier VRAM nach Modell | ~2.7 GB → **~16K Context mit turbo4** |
| Tool Calling | ✅ Prompt-basiert |
| Thinking Mode | ✅ Ja |
| Lizenz | Apache 2.0 |

**Pro:**
- ✅ Stärkstes Reasoning unter den kleinen Modellen
- ✅ 9B Parameter = spürbar intelligenter als 4B
- ✅ Bereits installiert und getestet

**Contra:**
- ❌ **Context reicht nicht** — 16K max, aber 19K System-Prompt → blockiert
- ❌ Kein Raum für Conversation-History oder Tool-Outputs
- ❌ Nur nutzbar wenn AGENTS.md signifikant gekürzt wird

---

### 4. Qwen3.5-35B-A3B MoE (Q4_K_M)

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~20 GB |
| Aktive Parameter | 3B (MoE) |
| Freier VRAM | ❌ **Passt nicht in 8GB** |

**Pro:**
- ✅ 35B Wissen, 3B Rechenaufwand — theoretisch beste Qualität
- ✅ **Bereits auf SSD** (`qwen3.5-35b-a3b.Q4_K_M.gguf`, 20G)

**Contra:**
- ❌ **20 GB > 8 GB VRAM** — benötigt CPU-Offloading
- ❌ CPU-Inferenz auf Laptop = extrem langsam (3-5 tok/s)
- ❌ Thunderbolt-Bandwidth limitiert GPU-CPU-Kommunikation

---

### 5. DeepSeek-R1-Qwen3-8B (Q4_K_M)

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~4.7 GB |
| Freier VRAM | ~3.3 GB → **~20K-24K Context** |
| Tool Calling | ⚠️ Eingeschränkt (Reasoning-optimiert, nicht Agent-optimiert) |

**Pro:**
- ✅ Besseres Reasoning als Standard-Qwen3-8B
- ✅ Passt in VRAM mit ausreichendem Context
- ✅ **Bereits auf SSD** (`deepseek-r1-qwen3-8b.Q4_K_M.gguf`, 4.7G)

**Contra:**
- ⚠️ DeepSeek-R1 ist auf **Reasoning** optimiert, nicht auf **Agentic/Tool-Use**
- ⚠️ Tendenz zu übermäßig langem Chain-of-Thought bei einfachen Tasks
- ⚠️ Tool Calling weniger zuverlässig als Gemma/Qwen-Instruct

---

### 6. Phi-4 Mini (~3.8B)

| Eigenschaft | Wert |
|---|---|
| Größe (Q4_K_M) | ~2.5 GB |
| Freier VRAM | ~5.5 GB → massig Context |
| Tool Calling | ✅ Gut für strukturierte Aufgaben |

**Pro:**
- ✅ Microsoft-Optimierung für Reasoning pro Parameter
- ✅ Sehr effizient, viel Raum für Context

**Contra:**
- ⚠️ **Nicht auf SSD vorhanden** — müsste heruntergeladen werden
- ⚠️ Community/Ecosystem kleiner als Qwen oder Gemma
- ⚠️ 3.8B Parameter — am unteren Ende für Agent-Tasks

---

## Zusammenfassung

| Modell | VRAM | Max Context | Agent-Qualität | Auf SSD? | Verdict |
|---|---|---|---|---|---|
| **Gemma 4 E4B** | 5.0G | ~24-40K ✅ | ⭐⭐⭐⭐ | ✅ | **🏆 Best fit** |
| Qwen3-4B | 2.4G | ~32K+ ✅ | ⭐⭐⭐ | ✅ | Fallback |
| DeepSeek-R1-8B | 4.7G | ~20-24K ✅ | ⭐⭐⭐ | ✅ | Reasoning only |
| Qwen3.5-9B | 5.3G | ~16K ❌ | ⭐⭐⭐⭐⭐ | ✅ lokal | Context zu klein |
| Qwen3.5-35B-A3B | 20G | — ❌ | ⭐⭐⭐⭐⭐ | ✅ | Passt nicht in VRAM |
| Phi-4 Mini | 2.5G | ~32K+ ✅ | ⭐⭐⭐ | ❌ | Download nötig |

> [!IMPORTANT]
> **Empfehlung: Gemma 4 E4B-it** — natives Tool Calling, guter Context-Headroom, bereits auf der SSD, von Google für genau diesen Edge-Use-Case gebaut.
