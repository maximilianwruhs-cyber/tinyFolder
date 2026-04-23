---
title: LLM Wiki
type: concept
tags:
  - knowledge-management
  - wiki
  - obsidian
  - pattern
sources: 1
created: 'Mon Apr 13 2026 02:00:00 GMT+0200 (Central European Summer Time)'
updated: '2026-04-22'
---
# LLM Wiki

A pattern by Andrej Karpathy for building personal knowledge bases using LLMs. Instead of RAG (re-discovering knowledge on every query), the LLM **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of markdown files that compounds over time.

## Core Insight

> "The wiki is a persistent, compounding artifact. The cross-references are already there. The contradictions have already been flagged. The synthesis already reflects everything you've read."

The human curates sources and asks questions. The LLM does the grunt work — summarizing, cross-referencing, filing, and bookkeeping.

## Three Layers

1. **Raw Sources** — Immutable collection of source documents. The LLM reads but never modifies.
2. **The Wiki** — LLM-generated markdown files. Summaries, entity pages, concept pages, comparisons. The LLM owns this layer entirely.
3. **The Schema** — Configuration file telling the LLM how the wiki is structured and what workflows to follow. See `schema/WIKI.md`.

## Operations

- **Ingest** — New source → read → summarize → update index → update entities → log
- **Query** — Question → search index → read pages → synthesize → optionally file answer as new page
- **Lint** — Health check: contradictions, orphans, stale pages, missing cross-references

## Our Implementation

- **Vault:** [[Edge-Node]] Obsidian Vault at `/workspace/Obsidian_Vault`
- **Maintainer:** [[GZMO]] via MCP filesystem access
- **Schema:** `schema/WIKI.md`
- **Future search:** `qmd` (hybrid BM25/vector/LLM-reranking search engine)

## Inspiration

Related to Vannevar Bush's Memex (1945) — a personal knowledge store with associative trails. The part Bush couldn't solve was maintenance. The LLM handles that.

## Related

- [[Agentic-Architecture]] — The wiki as a component of agent memory
- [[Sovereign-AI]] — Local knowledge, no cloud dependency

## Sources

- `raw/llm-wiki.md` (Karpathy's original document)
