---
title: GZMO Model Registry
type: entity
tags:
  - models
  - ollama
  - inference
  - seed-document
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# GZMO Model Registry

## Active Model
| Model | Size | Params | Role | Notes |
|-------|------|--------|------|-------|
| **hermes3:8b** | 4.7 GB | 8B | Primary inference | Superior instruction-following, agentic tool-calling, system-prompt compliance. Based on Llama-3.2-8B. |

## Available Models
| Model | Size | Params | Status | Notes |
|-------|------|--------|--------|-------|
| hermes3:8b | 4.7 GB | 8B | ✅ Active | Best overall for agentic tasks |
| qwen3:4b | 2.5 GB | 4B | Standby | Fast fallback, weaker reasoning |
| qwen3-4b-thinking | 2.5 GB | 4B | Standby | Extended thinking variant |
| qwen2.5:3b | 1.9 GB | 3B | Standby | Smallest, fastest, least capable |
| gemma4-e4b | 5.3 GB | ~4B | Standby | Google's hybrid-attention model |
| nomic-embed-text | 274 MB | - | ✅ Active | Embedding model for RAG |

## VRAM Budget
- **Total**: 8192 MiB (GTX 1070)
- **Model overhead**: ~500 MiB for Ollama server
- **hermes3:8b**: ~4.7 GB loaded → ~2.5 GB remaining for KV cache
- **Concurrent models**: NOT recommended. Only one inference model at a time.

## Selection Criteria
1. Must fit in 8 GB VRAM (Q4 quantized)
2. System prompt compliance (GZMO identity must be maintained)
3. Structured output capability (JSON, Markdown)
4. Agentic reasoning (tool-calling, chain-of-thought)
