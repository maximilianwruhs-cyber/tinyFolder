---
title: GZMO Chaos Engine Architecture
type: entity
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# GZMO Chaos Engine Architecture

## Frontmatter
```yaml
tags:
  - architecture
  - self-documentation
  - auto-generated
```

## System Overview
The GZMO Chaos Engine is a standalone inference engine designed to run on commodity hardware. It autonomously performs tasks, adapts a model of the world through crystallizations, and exhibits complex behaviors characteristic of chaotic systems - all while consuming minimal resources. The system consists of interlinked modules that perform specialized functions for overall behavior regulation.

## Module Map
- **types.ts**: Defines shared type definitions used throughout the engine.
- **embeddings.ts**: Embeds vault markdown files using nomic-embed-text and maintains an embedding store to prevent redundant computations.
- **engines/state.ts**: Manages engine state, including energy (0-100), phase (Idle/Build/Drop), death/rebirth lifecycle.  
- **memory.ts**: Implements episodic task memory by recording the most recent completions for context injection in future prompts.
- **search/ts**: Provides semantic search support through cosine similarity against embedded vault content.
- **skills/ts**: Scans skills directory for structured skill injections based on engine phase.
- **thoughts.cabinet**: A disco-themed internalization system where lore/skill outputs can be absorbed. Thoughts incubate, mature and crystallize into irreversible physical mutations of the Lorenz attractor topology.
- **alloysstasis.ts**: Manages computational allostatic stress response to prevent "dark room" system sedation, allowing for real signal response.
- **dreams.ts**: Distills completed tasks into higher-level thought cabinet content, employing dream schema structures and evidence-based claim separation.
- **wiki.contract/**: Enforces wiki page quality by detecting HTML outside code blocks.
- **engines/engine.ts**: Core inference logic that orchestrates task processing based on prompts and skill entries.  
- **engine\_state.ts**: Handles engine state changes including energy, phase transitions, and determines when the system will die or be reborn.
- **wiki.index.ts**: Rebuilds wiki index content periodically to reflect current known facts and relationships. 
- **wiki.graph.test/**: Tests functions used in graph-based concept-entity mapping.
- **engines/pulse.ts**: The sovereign heartbeat controlling all subsystem activation, managing time step progression through Lorenz attractor calculations.  

## Hardware Profile
The GZMO Chaos Engine system utilizes a single NVIDIA GeForce GTX 1070 GPU with 8GB of VRAM. Linux kernel version is 6.17.0-22-generic.

## Available Models
Currently no specific pre-trained models are listed as being available for use in the architecture.

## Data Flow Diagram Description
The data flow of the GZMO Chaos Engine is primarily centered around the 'pulse' heartbeat mechanism which controls all operations:
1. Hardware telemetry flows into tension calculations.
2. Lorenz attractor and logistic map subsystems update every system tick.
3. System state and memory entries are used to inform inferencing decisions.
4. Task outputs (skills, prompts) are absorbed by thoughts incubating and eventually crystallizing; mutating the model of reality.
5. Through allostatic regulation, a homeostatic balance prevents task dormancy while allowing responsiveness. 
6. Completed tasks move into memories, informing new contexts, and dreams process insights into higher-level knowledge.  
7. Constant semantic searches against vault embeddings feed ongoing context for inferencing operations.
8. Throughout the system, quality assurance functions maintain wiki integrity and concept relationships.
9. A self-documenting aspect ensures that changes are noted in a manner reflective of the current state.

The described architecture facilitates an intricate dance between deterministic task processing and stochastic thought evolution, driven by an underpinning of chaotic and adaptive systems behavior. The design showcases a high level of modularity combined with robust integration points ensuring operational coherence within the complex system.
