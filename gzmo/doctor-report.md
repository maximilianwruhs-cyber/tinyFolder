# GZMO Doctor Report

- Generated: 2026-04-24T13:45:19.202Z
- Profile: deep
- Mode: readonly
- Summary: PASS=3 WARN=1 FAIL=2 SKIP=5

## Environment

- Vault: `/app/vault`
- Inbox: `/app/vault/GZMO/Inbox`
- Ollama v1: `unknown`
- Model: `unknown`

## Steps

| Status | Step | Duration | Summary |
|--------|------|----------|---------|
| PASS | Runtime profile (safe-mode) visibility | 0.0s | doctor=deep → implied daemon profile=full |
| PASS | Vault path exists |  | OK |
| FAIL | Inbox directory exists |  | Inbox missing |
| FAIL | Discover Ollama endpoint + required models | 0.0s | No reachable Ollama endpoint found (tried localhost/127.0.0.1:11434 and preferred URL). |
| PASS | Unit tests (bun test) | 3.2s | All unit tests passed |
| WARN | Wiki lint scan (readonly) | 0.1s | 88 findings across 67 pages |
| SKIP | Embeddings sync/load | 0.0s | Skipped (Ollama unavailable) |
| SKIP | Embeddings queue serialization (temp vault) | 0.0s | Skipped (Ollama unavailable) |
| SKIP | LLM identity compliance (dry) |  | Skipped (Ollama unavailable) |
| SKIP | LLM JSON compliance (dry) |  | Skipped (Ollama unavailable) |
| SKIP | Write-enabled checks (Inbox/pipeline/dream/self-ask/wiki-engine) |  | Skipped (run with --write to enable) |

## Suggested fixes (not applied)

### Start Ollama

- Severity: **error**
- Rationale: Ollama must be running for LLM/embedding checks.

Commands:

```bash
ollama serve
```

### Review wiki lint report and apply fixes

- Severity: **warn**
- Rationale: Doctor runs lint in readonly mode; it only reports.

Commands:

```bash
sed -n '1,200p' "/app/vault/GZMO/wiki-lint-report.md"
```

### Run doctor with write-enabled checks

- Severity: **info**

Commands:

```bash
bun run doctor --write --profile deep
```

## Step details

### PASS — Runtime profile (safe-mode) visibility

- Summary: doctor=deep → implied daemon profile=full

```
GZMO_PROFILE env: (unset)
Resolved: full (inboxWatcher=on, taskProcessing=on, embeddingsSync=on, embeddingsLive=on, dreams=on, selfAsk=on, wiki=on, ingest=on, wikiLint=on, pruning=on, dashboardPulse=on)
```

### PASS — Vault path exists

- Summary: OK
### FAIL — Inbox directory exists

- Summary: Inbox missing

```
/app/vault/GZMO/Inbox
```

### FAIL — Discover Ollama endpoint + required models

- Summary: No reachable Ollama endpoint found (tried localhost/127.0.0.1:11434 and preferred URL).
### PASS — Unit tests (bun test)

- Summary: All unit tests passed

```
bun test v1.2.14 (6a363a38)
[PULSE] Started at 174 BPM (345ms, self-correcting)
[PULSE] Stopped (final snapshot flushed)


src/__tests__/ingest_engine.test.ts:
(pass) ingest_engine helpers > sanitizeSlug produces stable lowercase slug [4.04ms]
(pass) ingest_engine helpers > deriveSourceTitle turns path into human title [0.43ms]

src/__tests__/auto_tasks.test.ts:
(pass) auto_tasks > parseTypedNextAction parses known types [0.36ms]
(pass) auto_tasks > parseTypedNextAction rejects untyped lines [0.07ms]
(pass) quarantine assessWikiDraft > rejects drafts without per-entry evidence citations [0.18ms]
(pass) quarantine assessWikiDraft > accepts drafts with Entry citations [0.05ms]

src/__tests__/wiki_graph.test.ts:
(pass) wiki_graph > adds Sources section if missing [2.57ms]
(pass) wiki_graph > inserts into existing Sources section [0.38ms]
(pass) wiki_graph > is idempotent [0.17ms]

src/__tests__/regressions.integration.test.ts:
(pass) regressions (integration) > embedding dedup preserves provenance for identical text in multiple files [2.56ms]
(pass) regressions (integration) > task_failed event affects tension in next snapshots [3011.36ms]

src/__tests__/wiki_lint.test.ts:
(pass) wiki_lint > extractWikiLinks parses aliases and anchors [0.26ms]
(pass) wiki_lint > normalization is safe (no HTML allowed, keeps body) [3.06ms]

src/__tests__/wiki_contract.test.ts:
(pass) wiki_contract > adds required frontmatter + H1 and derives type from path [1.17ms]
(pass) wiki_contract > rejects HTML outside code fences [0.30ms]

 15 pass
 0 fail
 33 expect() calls
Ran 15 tests across 6 files. [3.15s]
```

### WARN — Wiki lint scan (readonly)

- Summary: 88 findings across 67 pages
- Evidence:
  - `/app/vault/GZMO/wiki-lint-report.md`

### SKIP — Embeddings sync/load

- Summary: Skipped (Ollama unavailable)
### SKIP — Embeddings queue serialization (temp vault)

- Summary: Skipped (Ollama unavailable)
### SKIP — LLM identity compliance (dry)

- Summary: Skipped (Ollama unavailable)
### SKIP — LLM JSON compliance (dry)

- Summary: Skipped (Ollama unavailable)
### SKIP — Write-enabled checks (Inbox/pipeline/dream/self-ask/wiki-engine)

- Summary: Skipped (run with --write to enable)