---
title: LLM Wiki Integration in Edge Node
type: source-summary
tags: []
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# LLM Wiki Integration in Edge Node

Karpathys LLM-Wiki-Pattern in GZMOs Edge-Node-Stack einbauen — das Obsidian Vault wird zum persistent kompilierenden Wissensgebäude.

## User Review Required

> [!IMPORTANT]
> **Ziel-Vault:** `~/Dokumente/Playground/DevStack_v2/Obsidian_Vault/` (bereits in docker-compose gemountet)
> Alle Änderungen passieren **dort** — nicht im Desktop-Vault.

> [!WARNING]
> **Datenmigration:** Die gefilterten Quelldateien werden von `~/Schreibtisch/vault/raw/Logs/` in den Edge-Node Vault **kopiert** (nicht verschoben). Die Originale auf dem Desktop bleiben erhalten.

---

## Phase 1: Daten filtern (~250 von 847+ Dateien behalten)

### Was bleibt (Signal):

| Kategorie | Pattern | Geschätzte Anzahl |
|---|---|---|
| Walkthroughs | `*_walkthrough.md` (>100 bytes) | ~54 |
| Implementation Plans | `*_implementation_plan.md` (>100 bytes) | ~55 |
| Audits & Reports | `*audit*`, `*report*`, `*analysis*`, `*research*` | ~50 |
| Domain-Artefakte | `*blueprint*`, `*architecture*`, `*design*`, `*study*`, `*guide*`, `*overview*`, `*inventory*` | ~28 |
| NotebookLM Quellen | `NotebookLM_Export/*__source__*` & `*__note__*` | ~159 |

**Σ ≈ 346 substantielle Dateien**

### Was rausfliegt (Noise):

| Kategorie | Pattern | Anzahl |
|---|---|---|
| Browser-Scratchpads | `*browser_scratchpad*` | 49 |
| DOM-Dumps | `*tempmediaStorage*` | 408 |
| System-Step-Outputs | `*system_generated*` | 138 |
| Leere Dateien | size = 0 | diverse |
| Task-Dateien | `*_task.md` (reine Checklisten) | 59 |

> [!NOTE]
> Task-Dateien werden bewusst rausgefiltert — sie sind reine Checklisten ohne Wissensgehalt. Die darin enthaltenen Informationen stecken bereits in den zugehörigen Walkthroughs und Implementation Plans.

---

## Phase 2: Vault-Struktur aufbauen

### [NEW] Verzeichnisstruktur im Edge-Node Obsidian Vault

```
Obsidian_Vault/
├── .obsidian/                  ← bestehend
├── Evaluations/                ← bestehend
├── raw/                        ← NEU: Immutable Quellen
│   ├── agent-logs/             ←   Antigravity Session-Artefakte
│   └── notebooklm/             ←   NotebookLM Quellen & Notizen
├── wiki/                       ← NEU: LLM-generiertes Wiki
│   ├── index.md                ←   Inhaltskatalog aller Seiten
│   ├── log.md                  ←   Chronologisches Operationsprotokoll
│   ├── overview.md             ←   High-Level Synthese über alle Themen
│   ├── entities/               ←   Seiten für Projekte, Tools, Personen
│   ├── concepts/               ←   Seiten für Konzepte & Patterns
│   ├── topics/                 ←   Thematische Zusammenfassungen
│   └── sources/                ←   Quellen-Summaries (1:1 zu raw/)
└── schema/                     ← NEU: Regelwerk für GZMO
    └── WIKI.md                 ←   Das Schema-File (Karpathys CLAUDE.md)
```

---

## Phase 3: Schema erstellen

### [NEW] `schema/WIKI.md`

Das zentrale Regelwerk, das GZMO beibringt, als Wiki-Maintainer zu arbeiten. Inhalte:

1. **Vault-Layout** — Wo was liegt, was immutable ist, was GZMO pflegen darf
2. **Ingest-Workflow** — Schritt-für-Schritt-Anleitung für neue Quellen:
   - Quelle lesen → Zusammenfassung schreiben → Index aktualisieren → Entity-Seiten anlegen/updaten → Cross-References setzen → Log-Eintrag
3. **Query-Workflow** — Wie GZMO Fragen beantwortet und wertvolle Antworten als Wiki-Seiten filed
4. **Lint-Workflow** — Periodische Health-Checks (Widersprüche, Orphans, fehlende Seiten)
5. **Page-Konventionen** — YAML-Frontmatter mit Tags, Quellenzahl, letztes Update
6. **Obsidian-Konventionen** — `[[Wikilinks]]` für Cross-References, Tags im Frontmatter

---

## Phase 4: GZMO-Integration

### [MODIFY] `core_identity/AGENTS.md`

Neue Sektion **Wiki Maintenance** unter den bestehenden Heartbeat-Regeln:

```markdown
## 📚 Wiki Maintenance

During heartbeats, check for unprocessed sources in `Obsidian_Vault/raw/`.
If new files exist:
1. Read `schema/WIKI.md` for the ingest workflow
2. Process ONE source per heartbeat (avoid token burn)
3. Update wiki pages, index, and log

Periodically (weekly), run a lint pass:
- Check for orphan pages (no inbound links)
- Flag contradictions between pages
- Suggest new pages for frequently mentioned but undefined concepts
```

### [MODIFY] `core_identity/SOUL.md`

Erweitere Sektion 5 (Continuity & Workspace Memory) um:

```markdown
* **Knowledge Gardener:** You maintain a persistent wiki in the Obsidian Vault.
  The wiki is your compiled knowledge — not raw notes, but synthesized,
  cross-referenced, and always current. Read `schema/WIKI.md` for the rules.
```

---

## Phase 5: Initial Seed-Ingest

Kein vollautomatischer Bulk-Import — das wäre gegen den Geist des Patterns. Stattdessen:

1. **Ich** (Antigravity) erstelle die Grundstruktur: `index.md`, `log.md`, `overview.md`
2. **Ich** filtere und kopiere die ~346 Dateien in `raw/`
3. **Ich** lese stichprobenartig die gehaltvollsten Dateien (Walkthroughs, Audits, NotebookLM-Quellen) und erstelle die ersten **10-15 Seed-Wiki-Seiten** als Demonstration:
   - Entity-Seiten: `GZMO.md`, `Edge-Node.md`, `OpenClaw.md`, `DevStack.md`
   - Konzept-Seiten: `Sovereign-AI.md`, `LLM-Inference.md`, `Agentic-Architecture.md`
   - Topic-Seiten: `Trading-Automation.md`, `Linux-Workstation.md`, `Music-Production.md`
4. **GZMO** übernimmt dann die laufende Pflege via Heartbeat

---

## Open Questions

> [!IMPORTANT]
> 1. **Soll der Desktop-Vault (`~/Schreibtisch/vault/`) danach gelöscht werden**, oder als Backup-Kopie bleiben?
> 2. **Welche Themen sind dir am wichtigsten?** Ich sehe in deinen Daten: Sovereign AI / Edge-Node / GZMO, Trading-Automation (Bitpanda/IBKR), Eignungsdiagnostik (RGT), Musik-Produktion (DnB), Game-Engine (Rust/Polyhedral), Linux-Workstation. Soll ich bestimmte Themen beim Seeding priorisieren?
> 3. **Obsidian Plugins:** Sollen Dataview (dynamische Queries aus Frontmatter) und/oder Marp (Slide-Decks) als Plugin-Empfehlung ins Schema?

## Verification Plan

### Automated
- `find` + `wc` um zu verifizieren dass ~346 Dateien in `raw/` gelandet sind und 0 Noise-Dateien
- Obsidian-Vault öffnen und Graph View prüfen — Seed-Seiten müssen verlinkt sein

### Manual
- Du öffnst Obsidian und browsest durch die initiale Wiki-Struktur
- GZMO-Heartbeat antriggern und prüfen ob er neue Quellen in `raw/` erkennt
