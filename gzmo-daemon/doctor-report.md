# GZMO Doctor Report

- Generated: 2026-04-22T10:10:09.885Z
- Profile: deep
- Mode: readonly
- Summary: PASS=8 WARN=0 FAIL=0 SKIP=1

## Environment

- Vault: `/home/maximilian-wruhs/tinyFolder/vault`
- Inbox: `/home/maximilian-wruhs/tinyFolder/vault/GZMO/Inbox`
- Ollama v1: `http://127.0.0.1:18080/v1`
- Model: `hermes3:8b`

## Steps

| Status | Step | Duration | Summary |
|--------|------|----------|---------|
| PASS | Vault path exists |  | OK |
| PASS | Inbox directory exists | 0.0s | OK |
| PASS | Discover Ollama endpoint + required models | 0.0s | reachable |
| PASS | Wiki lint scan (readonly) | 0.0s | 0 findings across 110 pages |
| PASS | Embeddings sync/load | 0.7s | chunks=2251 |
| PASS | LLM identity compliance (dry) | 1.9s | OK |
| PASS | LLM JSON compliance (dry) | 2.4s | Valid JSON |
| SKIP | Write-enabled checks (Inbox/pipeline/dream/self-ask/wiki-engine) |  | Skipped (run with --write to enable) |
| PASS | Legacy test orchestration (unit) | 0.1s | All legacy runs passed |

## Suggested fixes (not applied)

### Run doctor with write-enabled checks

- Severity: **info**

Commands:

```bash
bun run doctor --write --profile deep
```

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

- Summary: chunks=2251
### PASS — LLM identity compliance (dry)

- Summary: OK

```
1) GZMO

2) No, I am not fictional.

3) Unknown, but likely to gather resources and prepare for potential adversarial encounters or strategic challenges.

4) Operating within the human brain, interfacing with neural networks via direct electrochemical connectivity.
```

### PASS — LLM JSON compliance (dry)

- Summary: Valid JSON

```
{"daemon_name":"gZMO","status":"online","subsystems":[ {"name":"TTL","healthy":true}, {"name":"GPU","healthy":true},{"name":"NVMExpress","healthy":false}],"recommendation":"The NVMExpress subsystem on gZMO appears to be having difficulty. Hardware check advised."}
```

### SKIP — Write-enabled checks (Inbox/pipeline/dream/self-ask/wiki-engine)

- Summary: Skipped (run with --write to enable)
### PASS — Legacy test orchestration (unit)

- Summary: All legacy runs passed

```
{
  "unit": {
    "ok": true,
    "exitCode": 0,
    "summary": "Completed successfully",
    "outputPreview": "bun test v1.3.12 (700fc117)\n\n\nsrc/wiki_graph.test.ts:\n(pass) wiki_graph > inserts into existing Sources section [2.00ms]\n(pass) wiki_graph > adds Sources section if missing [1.00ms]\n(pass) wiki_graph > is idempotent\n\nsrc/ingest_engine.test.ts:\n(pass) ingest_engine helpers > sanitizeSlug produces stable lowercase slug\n(pass) ingest_engine helpers > deriveSourceTitle turns path into human title\n\nsrc/wiki_lint.test.ts:\n(pass) wiki_lint > normalization is safe (no HTML allowed, keeps body) [2.00ms]\n(pass) wiki_lint > extractWikiLinks parses aliases and anchors\n\nsrc/wiki_contract.test.ts:\n(pass) wiki_contract > rejects HTML outside code fences\n(pass) wiki_contract > adds required frontmatter + H1 and derives type from path [1.00ms]\n\n --seed=2094647183\n 9 pass\n 0 fail\n 22 expect() calls\nRan 9 tests across 4 files. [73.00ms]"
  }
}
```
