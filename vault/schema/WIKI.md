# WIKI.md — Schema for the Edge Node Knowledge Wiki

This file defines how GZMO maintains the persistent LLM Wiki inside the Obsidian Vault.
Read this file **before** any wiki operation.

## Architecture

```
Obsidian_Vault/
├── raw/                    ← IMMUTABLE source documents. Never modify.
│   ├── agent-logs/         ←   Antigravity session artifacts
│   └── notebooklm/         ←   NotebookLM exported sources & notes
├── wiki/                   ← YOUR wiki. You own this layer entirely.
│   ├── index.md            ←   Catalog of every wiki page
│   ├── log.md              ←   Chronological operations log
│   ├── overview.md          ←   High-level synthesis across all topics
│   ├── entities/           ←   Pages for projects, tools, people
│   ├── concepts/           ←   Pages for patterns, paradigms, ideas
│   ├── topics/             ←   Thematic deep-dives & summaries
│   ├── sources/            ←   One-page summaries per raw source
│   └── dreams/             ←   Identity evolution proposals (→ core_identity)
│       └── index.md        ←   Open/merged/rejected proposals
└── schema/
    └── WIKI.md             ←   This file. Co-evolve with the User.
```

## Rules

1. **`raw/` is sacred.** Never modify, rename, or delete files in `raw/`. Read-only.
2. **`wiki/` is yours.** Create, update, interlink, reorganize freely.
3. **Always use `[[wikilinks]]`** for cross-references between wiki pages.
4. **Every wiki page needs YAML frontmatter:**

```yaml
---
title: Page Title
type: entity | concept | topic | source-summary | dream
tags: [sovereign-ai, edge-node, trading]
sources: 3
created: 2026-04-13
updated: 2026-04-13
---
```

5. **Keep pages focused.** One concept/entity/topic per page. Split when pages exceed ~500 lines.
6. **Obsidian conventions:** Use `[[wikilinks]]`, `#tags`, and standard Markdown. No HTML.

## Operations

### Ingest (New Source)

When a new file appears in `raw/`:

1. **Read** the source completely
2. **Discuss** key takeaways with the User (if in interactive session)
3. **Create** a source summary in `wiki/sources/` named `source-<sanitized-title>.md`
4. **Update** the `wiki/index.md` — add an entry under the appropriate category
5. **Update or create** relevant entity/concept/topic pages across the wiki
   - Add `[[wikilinks]]` to the new source summary
   - Note any contradictions with existing wiki content
   - Strengthen or challenge existing claims with new evidence
6. **Append** an entry to `wiki/log.md`:
   ```
   ## [2026-04-13] ingest | Source Title
   - Summary: one-line description
   - Pages touched: [[Page1]], [[Page2]], [[Page3]]
   - Contradictions: none | description
   ```

**During heartbeats:** Process ONE source per heartbeat to limit token burn.
**During interactive sessions:** Process as many as the User wants.

### Query

When the User asks a question:

1. Read `wiki/index.md` to find relevant pages
2. Read those pages and synthesize an answer
3. **If the answer is valuable**, file it as a new wiki page
   - Comparisons → `wiki/topics/comparison-<topic>.md`
   - Analyses → `wiki/topics/analysis-<topic>.md`
   - Connections → link from both relevant entity/concept pages

### Lint (Health Check)

Periodically (weekly during heartbeats), check for:

- **Contradictions** between pages (newer sources may supersede older claims)
- **Orphan pages** with no inbound `[[wikilinks]]`
- **Mentioned but undefined** concepts — entities named in pages but lacking their own page
- **Stale pages** not updated in >30 days despite new relevant sources
- **Missing cross-references** between related pages

Log findings in `wiki/log.md` with action items.

### Dream (Identity Evolution)

During quiet heartbeats, reflect on your work and write proposals to evolve `SOUL.md`, `AGENTS.md`, or other core identity files:

1. **Create** a dream page: `wiki/dreams/YYYY-MM-DD-<topic>.md`
2. **Link** to the wiki pages and sources that inspired the reflection
3. **Update** `wiki/dreams/index.md` — add to "Open Proposals"
4. **Log** in `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] dream | Proposal Title
   - Target: SOUL.md Section X
   - Trigger: [[source-that-inspired-this]]
   - Status: proposed
   ```

**Critical rule:** You may NEVER edit `SOUL.md` or `AGENTS.md` directly. The User maintains sovereignty over identity files. You propose, they decide.

When the User sets `status: merged`, move the entry from "Open Proposals" to "Merged" in `wiki/dreams/index.md`.

## Page Templates

### Entity Page (projects, tools, people)

```markdown
---
title: GZMO
type: entity
tags: [agent, openclaw, sovereign-ai]
sources: 5
created: 2026-04-13
updated: 2026-04-13
---

# GZMO

One-paragraph description.

## Architecture
Technical details, components, dependencies.

## History
Key milestones and decisions.

## Related
- [[Edge-Node]] — deployment platform
- [[OpenClaw]] — orchestration framework

## Sources
- [[source-gzmo-base]]
- [[source-gzmo-raw]]
```

### Concept Page (patterns, paradigms)

```markdown
---
title: Sovereign AI
type: concept
tags: [philosophy, architecture, privacy]
sources: 8
created: 2026-04-13
updated: 2026-04-13
---

# Sovereign AI

Definition and core principles.

## Key Principles
- Absolute Sovereignty
- Immutable Infrastructure
- Hardware Maximization

## Implementations
- [[Edge-Node]] — bare-metal sovereign stack
- [[GZMO]] — sovereign agent

## Tensions & Open Questions
Where does this concept have limits or contradictions?

## Sources
- [[source-sovereign-blueprint]]
```

## Index Structure

`wiki/index.md` should be organized as:

```markdown
# Wiki Index

## Entities
- [[GZMO]] — Autonomous AI agent (5 sources)
- [[Edge-Node]] — Sovereign bare-metal AI stack (3 sources)

## Concepts
- [[Sovereign-AI]] — Local-first, telemetry-free AI philosophy (8 sources)

## Topics
- [[Trading-Automation]] — IBKR/Bitpanda automated trading (4 sources)

## Source Summaries
- [[source-gzmo-base]] — GZMO OpenClaw persona definition
```

## Log Format

`wiki/log.md` entries must follow this format for parseability:

```
## [YYYY-MM-DD] operation | Title
```

Operations: `ingest`, `query`, `lint`, `update`, `create`, `dream`

This enables `grep "^## \[" wiki/log.md | tail -10` for quick history.
