---
title: "GZMO Model Registry"
type: entity
role: canonical
tags: [entity, canonical, gzmo, local-ai]
sources: 0
created: '2026-04-22'
updated: '2026-04-25'
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


## Model Tiers For Small-LLM Work

| Tier | Model | Use |
|---|---|---|
| Primary | `hermes3:8b` | highest local instruction-following and agentic work when VRAM permits |
| Fast reasoning | `qwen3:4b`, `qwen3-4b-thinking` | faster local responses, useful for structured audits and constrained tasks |
| Tiny fallback | `qwen2.5:3b` | fastest least-capable fallback; needs strong vault scaffolding and explicit context |
| Embeddings | `nomic-embed-text` | vector index for curated vault layers |

Small models perform best when retrieval lands on [[START]], [[Local-RAG-Contract]], canonical entity pages, and short source summaries before long generated histories.

## Takeout Source Index

- `AI research`, `Speculative Decoding and Inference Optimization`, `The Evolution of Artificial Intelligence Evaluatio`, and model/session distillations feed this registry.
- Promote only currently useful model constraints and selection rules; leave speculative architectures in source pages unless implemented.
- Corpus map: [[NotebookLM-Corpus-Map]].

## Sources

- [[source-013c8bf1-2cfc-4b66-b0a7-4db9cffaca37-advanced-ai-features-guide]]

- [[source-34eb875f-6b6b-47b5-a919-03fc9bcde698-medusa-architecture]]

- [[source-ae7ccb36-2701-49e0-9394-3ec98e7d11fe-walkthrough]]
