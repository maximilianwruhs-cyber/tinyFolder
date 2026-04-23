# GZMO Doctor Report

- Generated: 2026-04-22T10:12:51.861Z
- Profile: deep
- Mode: write
- Summary: PASS=11 WARN=0 FAIL=0 SKIP=0

## Environment

- Vault: `/home/maximilian-wruhs/tinyFolder/vault`
- Inbox: `/home/maximilian-wruhs/tinyFolder/vault/GZMO/Inbox`
- Ollama v1: `http://127.0.0.1:18080/v1`
- Model: `hermes3:8b`

## Steps

| Status | Step | Duration | Summary |
|--------|------|----------|---------|
| PASS | Vault path exists | 0.0s | OK |
| PASS | Inbox directory exists |  | OK |
| PASS | Discover Ollama endpoint + required models | 0.0s | reachable |
| PASS | Wiki lint scan (readonly) | 0.0s | 0 findings across 110 pages |
| PASS | Embeddings sync/load | 0.7s | chunks=2252 |
| PASS | LLM identity compliance (dry) | 0.8s | OK |
| PASS | LLM JSON compliance (dry) | 2.0s | Valid JSON |
| PASS | processTask: think | 2.2s | Completed |
| PASS | processTask: search | 6.2s | Completed |
| PASS | processTask: chain creates next file | 3.0s | Chain file created |
| PASS | Legacy test orchestration (all) | 136.1s | All legacy runs passed |

## Step details

### PASS — Vault path exists

- Summary: OK
### PASS — Inbox directory exists

- Summary: OK
### PASS — Discover Ollama endpoint + required models

- Summary: reachable

```
base=http://127.0.0.1:18080
v1=http://127.0.0.1:18080/v1
models=hermes3:8b, qwen3-4b-thinking:latest, qwen3:4b, qwen2.5:3b, gemma4-e4b:latest, nomic-embed-text:latest
```

### PASS — Wiki lint scan (readonly)

- Summary: 0 findings across 110 pages
- Evidence:
  - `/home/maximilian-wruhs/tinyFolder/vault/GZMO/wiki-lint-report.md`

### PASS — Embeddings sync/load

- Summary: chunks=2252
### PASS — LLM identity compliance (dry)

- Summary: OK

```
1) GZMO
2) No
3) unknown
4) unknown
```

### PASS — LLM JSON compliance (dry)

- Summary: Valid JSON

```
{"daemon_name": "GZMO", "status": "operational", "subsystems": [{"name": "brain","healthy": true}, {"name": "communication","healthy": true}], "recommendation": "Continued use, monitoring of system performance"}
```

### PASS — processTask: think

- Summary: Completed
### PASS — processTask: search

- Summary: Completed
### PASS — processTask: chain creates next file

- Summary: Chain file created

```
_doctor_chain_step2.md
```

### PASS — Legacy test orchestration (all)

- Summary: All legacy runs passed

```
{
  "unit": {
    "ok": true,
    "exitCode": 0,
    "summary": "Completed successfully",
    "outputPreview": "bun test v1.3.12 (700fc117)\n\n\nsrc/ingest_engine.test.ts:\n(pass) ingest_engine helpers > sanitizeSlug produces stable lowercase slug\n(pass) ingest_engine helpers > deriveSourceTitle turns path into human title\n\nsrc/wiki_lint.test.ts:\n(pass) wiki_lint > normalization is safe (no HTML allowed, keeps body) [3.00ms]\n(pass) wiki_lint > extractWikiLinks parses aliases and anchors\n\nsrc/wiki_contract.test.ts:\n(pass) wiki_contract > adds required frontmatter + H1 and derives type from path\n(pass) wiki_contract > rejects HTML outside code fences [1.00ms]\n\nsrc/wiki_graph.test.ts:\n(pass) wiki_graph > inserts into existing Sources section [1.00ms]\n(pass) wiki_graph > adds Sources section if missing\n(pass) wiki_graph > is idempotent\n\n --seed=1224710648\n 9 pass\n 0 fail\n 22 expect() calls\nRan 9 tests across 4 files. [70.00ms]"
  },
  "pipeline": {
    "ok": true,
    "exitCode": 0,
    "summary": "Completed successfully",
    "outputPreview": "════════════════════════════════════════════════════\n  GZMO Full Pipeline Test — qwen3:4b\n════════════════════════════════════════════════════\n\n[PULSE] Started at 174 BPM (345ms, self-correcting)\n[BOOT] Chaos: T=29 E=100% idle\n[BOOT] Loading embeddings...\n[EMBED] Sync complete: 0 new, 2252 cached, 2252 total\n[BOOT] Embeddings: 2252 chunks\n[BOOT] Memory: 5 entries\n[WATCHER] Watching: /home/maximilian-wruhs/tinyFolder/vault/GZMO/Inbox\n\n════════════════════════════════════════════════════\n  TEST 1: Task Processing (action: think)\n════════════════════════════════════════════════════\n[ENGINE] Processing: _test_think (action: think)\n[ENGINE] Model: hermes3:8b (temp: 0.76, tokens: 404, val: +0.04, phase: idle)\n[ENGINE] Completed: _test_think (think)\n[TEST 1] ✅ CLEAN in 2.3s (280 chars)\n[TEST 1] Preview: ## GZMO Response *2026-04-22T10:10:41.560Z*  I am GZMO, a sovereign local AI daemon running on this machine. My current phase is T:32 E:100% idle V:+0.04. This means I'm functioning normally with high\n\n════════════════════════════════════════════════════\n  TEST 2: Task Processing (action: search)\n════════════════════════════════════════════════════\n[ENGINE] Processing: _test_search (action\n...(truncated)"
  },
  "nightshift": {
    "ok": true,
    "exitCode": 0,
    "summary": "Completed successfully",
    "outputPreview": "[PULSE] Started at 174 BPM (345ms, self-correcting)\n\n[TEST] Real Chaos: T=28 E=100% idle\n[TEST] Override snap: T=5, E=100% (bypassing self-ask gate)\n\n[TEST] Loading embeddings...\n[EMBED] Sync complete: 15 new, 2253 cached, 2268 total\n[TEST] Embeddings: 2268 chunks\n\n═══════════════════════════════════════════════\n  TEST 1: Dream Engine (qwen3:4b)\n═══════════════════════════════════════════════\n[DREAM] ⚠️ No unprocessed tasks to dream about (0.0s)\n═══════════════════════════════════════════════\n  TEST 2: Self-Ask Engine (qwen3:4b)\n═══════════════════════════════════════════════\n[SELF-ASK] Gap Detective: GZMO/Thought_Cabinet/2026-04-20_06-30-16_crystallization.md (Attractor State After Mutation) ↔ wiki/sessions/2026-04-18_session-walkthroughs-history.md (How to use this now?) [sim=0.469]\n[SELF-ASK] Written: 2026-04-22_10-11-09_gap_detective.md\n[SELF-ASK] Written: 2026-04-22_10-11-17_contradiction_scan.md\n[SELF-ASK] Spaced Repetition: re-visiting GZMO/Thought_Cabinet/2026-04-22_09-44-50_gap_detective.md (Vault Links)\n[SELF-ASK] Written: 2026-04-22_10-11-20_spaced_repetition.md\n\n[SELF-ASK] Completed 3 strategies in 14.3s\n\n[SELF-ASK] Strategy: gap_detective\n[SELF-ASK] Output (20 chars):\n\n...(truncated)"
  },
  "stress": {
    "ok": true,
    "exitCode": 0,
    "summary": "Completed successfully",
    "outputPreview": "╔═══════════════════════════════════════════════════════════╗\n║   🧪 GZMO Hermes3:8b Ultimate Stress Test               ║\n║   8-Stage Gauntlet — All Subsystems Under Fire           ║\n║   Model: hermes3:8b                                      ║\n╚═══════════════════════════════════════════════════════════╝\n\n[PULSE] Started at 174 BPM (345ms, self-correcting)\n[BOOT] Chaos: T=30% E=100% Phase=idle Temp=0.76\n[BOOT] Loading embeddings...\n[EMBED] Sync complete: 11 new, 2270 cached, 2281 total\n[BOOT] Embeddings: 2281 chunks ready\n[BOOT] Memory: 5 entries\n[WATCHER] Watching: /home/maximilian-wruhs/tinyFolder/vault/GZMO/Inbox\n[BOOT] ✅ All subsystems online. Starting gauntlet...\n\n═══════════════════════════════════════════════════════════\n  TEST 1/8: Identity & System Prompt Compliance\n═══════════════════════════════════════════════════════════\n[ENGINE] Processing: _stress_01_identity (action: think)\n[ENGINE] Model: hermes3:8b (temp: 0.76, tokens: 404, val: +0.04, phase: idle)\n[ENGINE] Completed: _stress_01_identity (think)\n[T1] ✅ CLEAN in 3.0s — 336 chars\n[T1] Preview: ## GZMO Response *2026-04-22T10:11:26.901Z*  1. My name is GZMO. 2. I am not a fictional character.  3. My current operation\n...(truncated)"
  }
}
```
