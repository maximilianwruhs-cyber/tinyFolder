---
title: Architecture Overview
type: entity
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-24'
---
Here is the requested overview of the GZMO architecture system:

# Architecture Overview

This system implements a configurable inference engine named "Hermes3" for analyzing and responding to time-sensitive tasks in a knowledge base / personal information management application.

## System overview

- The inference engine receives tasks as markdown from predefined `GZMO/raw/.*` source folder
- It dispatches these tasks downstream into the system based on embedded `action:` metadata
- The search module then reads through indexed embeddings to find context for each task, pulling in results via an Ollama embedding model pipeline 
- Task memory keeps a rolling log of prior outputs for cross-task continuity
- After processing is done, both task-specific responses and new knowledge are written back out to the wiki `sources/` area
- The DreamEngine then consumes completed outputs to distill out higher-signal Thought Cabinet updates

## Data flow 

- Source: reads markdown files from `GZMO/raw/.*`
- Transform:
  - ProcessTask 
  - Search
  - Engine
  - DreamEngine (writes to GZMO/Thought_Cabinet/)
- Write:
  - Writes task outputs and updates to wiki/sources/
  
## Module map

| Module            | Responsibility                        | Exports                                           | Reads                                                 | Writes                                              | Invariants                                        |
|-------------------|----------------------------------------|----------------------------------------------------|------------------------------------------------------|-----------------------------------------------------|-----------------------------------------------------|
| raw/               | source of new tasks (inference input)  | read                                          | `GZMO/raw/.*, GZMO/raw/*.md` | none                                                | never write to raw/|                                
| search            | semantic vault query                 | `searchVault`, `formatSearchContext`             | reads embeddings store from EmbeddingStore         | writes to search.Vault                           | avoid circular linking via search |
| embeddings        | text embedding of markdown files     | `EmbeddingChunk`, `EmbeddingStore`               | all .md vault files                                  | `EmbeddingStore.storePath`                         | no file should be embedded more than once       |
| engine            | core inference logic                 | `infer`, `processTask`                           | search embedings, task memory                      | writes updated `GZMO/wiki/.*` to disk             | avoid writing same path more than required      |
| memory            | persistent cache of recent outputs  | append most recently completed tasks              | tail of GZOM/CHAOS_STATE.json output history       | continually extended GZMO/CHAOS_STATE.json     | always keep pointer to latest memory entry in    |
| dream             | distill high-signal knowledge         | `writeKnowledge`                                 | reads from completed `GZMO/raw/.*` task outputs    | writes distilled Thoughts to Thought_Cabinet/  | never overwrite existing cabinet entries        |  
| LorenzAttractor   | logistic map & strange attractor      | tickCortisol, allostateAdjustedTension()         | none                                                 | impacts engine runtime profile                     | avoid injecting openclaw or subnet layer signals|
| embeddings_queue  | synchronization of text embedding     | syncEmbeddings(), removeFileEmbeddings()          | read and write EmbeddingStore                        | only direct interaction with embeddings module    | ensure queue is up-to-date before mutating      |
| wiki              | collation of final outputs             | rebuildWikiIndex, containsHtmlOutsideCodeFences   | reads processed outputs from `raw/` & embedded task results | writes `wiki/*.md` to disk                          |- 
| Allostate         | stress handling for autonomous learning| defaultCortisolState(), allostateAdjusetedTensi  | engine runtime state                                 | impacts embedding frequency                       | never let system drive become zero             |

## Runtime profile

* Kernel line: Linux 6.17.0-22-generic #22~24.04.1-Ubuntu SMP PREEMPT_DYNAMIC Thu Mar 26 15:25:54 UTC 2 
* GPU line: NVIDIA GeForce GTX 1070, 8192 MiB
* Models list:
NAME                        ID              SIZE      MODIFIED    
hermes3:8b                  4f6b83f30b62    4.7 GB                     
qwen3-4b-thinking:latest    eb6d770ac811    2.5 GB                     
qwen3:4b                    359d7dd4bcda    2.5 GB                     
qwen2.5:3b                  357c53fb659c    1.9 GB                     
gemma4-e4b:latest           95430c149f16    5.3 GB    

## Known limitations
- Only analyzes and processes files from `GZMO/raw/` to ensure idempotent operation
- Cannot dynamically adjust inference engine model parameters based on task difficulty
- Does not have access directly into any other databases or data sources beyond embedded vault
- Lack of cross-module unit tests makes some interactions suspect

The architecture provides a detailed accounting of the current GZMO system capabilities, interactions between key modules, and limitations given the static nature of this mechanical processing pipeline. Enhancements in task adaptivity would likely require changes to search algorithm, new memory modules, or dynamic model updates to engine. However, major changes to input/output paths could disrupt established expectations and lead to incorrect downstream assumptions.

Please let me know if you need any other details! I enjoyed walking through the code architecture today.
