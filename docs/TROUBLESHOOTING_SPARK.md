# Troubleshooting — DGX Spark + Ollama + GZMO

Quick reference for **common failures and fixes** when running tinyFolder/GZMO on **NVIDIA DGX Spark** (128 GB unified) with **Qwen 3.6 MoE** and desktop **Dropzone** ingest.

This doc points to **official and community sources** on the web, then maps each issue to **GZMO-specific** checks. For generic GZMO issues (systemd `216/GROUP`, CRLF, golden task), see [README — Troubleshooting](../README.md#troubleshooting).

---

## Official NVIDIA resources

| Resource | URL |
|----------|-----|
| Spark playbooks index | https://build.nvidia.com/spark |
| CLI coding agent (Qwen 3.6 default) | https://build.nvidia.com/spark/cli-coding-agent |
| Open WebUI + Ollama troubleshooting | https://build.nvidia.com/spark/open-webui/troubleshooting |
| Text → Knowledge Graph (Ollama env hints) | https://build.nvidia.com/spark/txt2kg/troubleshooting |
| OpenShell / agents (Ollama host binding) | https://build.nvidia.com/spark/openshell/troubleshooting |
| DGX Spark developer forum | https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10 |

---

## Ollama resources

| Resource | URL |
|----------|-----|
| Troubleshooting (logs, GPU, Docker) | https://docs.ollama.com/troubleshooting |
| Context length (`OLLAMA_CONTEXT_LENGTH`, `ollama ps`) | https://docs.ollama.com/context-length |
| Qwen 3.6 model page (nvfp4) | https://ollama.com/library/qwen3.6:35b-a3b-nvfp4 |
| Embeddings (`nomic-embed-text`) | https://ollama.com/library/nomic-embed-text |

---

## GZMO in-repo references

| Topic | Location |
|-------|----------|
| Spark `.env` template | [`gzmo-daemon/.env.spark.example`](../gzmo-daemon/.env.spark.example) |
| Start Ollama (256k on Spark) | [`scripts/start-ollama-optimized.sh`](../scripts/start-ollama-optimized.sh) |
| Spark installers | [`scripts/lib/dgx-spark.sh`](../scripts/lib/dgx-spark.sh), [`agentic-setup.sh`](../scripts/agentic-setup.sh) |
| Doctor | [`./scripts/doctor-agentic.sh`](../scripts/doctor-agentic.sh) → `cd gzmo-daemon && bun run doctor` |
| README — DGX quick path | [Bigger machine (DGX Spark)](../README.md#bigger-machine-dgx-spark--64gb-ram--quick-path) |
| README — context budget | [Maximizing context on DGX Spark](../README.md#maximizing-context-on-dgx-spark-128-gb-unified-memory) |
| Agent playbook F | [AGENTS.md — DGX Spark](../AGENTS.md#f-dgx-spark--document--invoice-rag-production) |

---

## Day-one diagnostic order

Run top to bottom on a new Spark box:

```bash
# 1. Ollama up
curl -sf http://localhost:11434/api/tags

# 2. Models present
ollama pull qwen3.6:35b-a3b-nvfp4   # fallback: qwen3.6:35b-a3b
ollama pull nomic-embed-text

# 3. Sanity generation (must be coherent, not empty or !!!!!)
ollama run qwen3.6:35b-a3b-nvfp4 "What is 2+2? Reply with only the number."

# 4. Context + GPU (ground truth beats formulas)
ollama ps
# Expect: PROCESSOR 100% GPU, CONTEXT ≈ 262144 when using start-ollama-optimized.sh

# 5. GZMO env
cp gzmo-daemon/.env.spark.example gzmo-daemon/.env
# Edit VAULT_PATH, GZMO_DROPZONE_DIR

# 6. Doctor
export GZMO_ENV_FILE="$(pwd)/gzmo-daemon/.env"
./scripts/doctor-agentic.sh --deep

# 7. Daemon
systemctl --user status gzmo-daemon
journalctl --user -u gzmo-daemon -n 100 --no-pager

# 8. Bill smoke test: drop file in GZMO_DROPZONE_DIR → wiki/incoming → Inbox search → [E#] in answer
```

**Logs:**

```bash
journalctl -u ollama --no-pager -n 200    # if Ollama runs as systemd service
journalctl --user -u gzmo-daemon -f
```

---

## Failure → fix matrix

### Ollama / infrastructure

| Symptom | Likely cause | Fix | External |
|---------|----------------|-----|----------|
| `curl /api/tags` fails | Ollama not running | `systemctl start ollama` or `./scripts/start-ollama-optimized.sh` | [Ollama troubleshooting](https://docs.ollama.com/troubleshooting) |
| Port 11434 in use | Another Ollama/instance | `ss -lntp \| grep 11434`; stop duplicate | [Open WebUI troubleshooting](https://build.nvidia.com/spark/open-webui/troubleshooting) |
| GPU not used in Docker | Missing `--gpus all` | Recreate container with GPU flag | NVIDIA playbooks |
| Slow / OOM despite “free” RAM | **UMA** accounting | `sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'`; close other LLM apps | [Open WebUI troubleshooting](https://build.nvidia.com/spark/open-webui/troubleshooting) |
| `/api/generate` hangs minutes | Spark/aarch64 or stuck runner | Update Ollama; use `/api/chat`; restart serve | [NVIDIA/NemoClaw#3249](https://github.com/NVIDIA/NemoClaw/issues/3249) |
| Poor tok/s | Wrong quant, CPU offload, UMA pressure | `ollama ps`; use **nvfp4**; env: `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_MAX_LOADED_MODELS=1` | [Forum: poor performance](https://forums.developer.nvidia.com/t/very-poor-performance-with-ollama-on-dgx-spark-looking-for-help/353456), [txt2kg troubleshooting](https://build.nvidia.com/spark/txt2kg/troubleshooting) |
| Remote client can’t reach Ollama | Binds localhost only | `OLLAMA_HOST=0.0.0.0 ollama serve` (+ firewall) | [OpenShell troubleshooting](https://build.nvidia.com/spark/openshell/troubleshooting) |

### Qwen 3.6 / generation quality

| Symptom | Likely cause | Fix | External |
|---------|----------------|-----|----------|
| **Empty** model response | Thinking mode burned token budget | Disable thinking (`/no_think`, chat API, `think=false` top-level) | [ollama#12593](https://github.com/ollama/ollama/issues/12593), [ollama#14793](https://github.com/ollama/ollama/issues/14793) |
| Empty with tools | think + tools broken | Don’t combine; GZMO uses chat-style inference | [ollama#10976](https://github.com/ollama/ollama/issues/10976) |
| Output only `!!!!!` or gibberish | Wrong FP4 path / SM121 (vLLM) or bad nvfp4 pack | Prefer Ollama **nvfp4** tag; verify 2+2 test; update Ollama | [ai-muninn SM121](https://ai-muninn.com/en/blog/part1-why-your-dgx-spark-says-exclamation-marks) |
| Incoherent nvfp4 output | **coding-nvfp4** packaging bug (zeroed K proj) | Use `qwen3.6:35b-a3b-nvfp4` (not `*-coding-nvfp4`) or `qwen3.6:35b-a3b` | [ollama#15866](https://github.com/ollama/ollama/issues/15866) |
| Stuck in long “thinking” loop | Thinking enabled on short task | Turn off thinking for bill/search tasks | [ollama#15880](https://github.com/ollama/ollama/issues/15880) |

### Context / memory

| Symptom | Likely cause | Fix | External |
|---------|----------------|-----|----------|
| `ollama ps` shows **CPU** | Context too large vs loaded weights | Lower `OLLAMA_CONTEXT_LENGTH` (try 131072); use **nvfp4** not BF16 70B | [Context length](https://docs.ollama.com/context-length), [ollama#1385](https://github.com/ollama/ollama/issues/1385) |
| Very slow first reply | Huge prefill on long prompt | Normal; GZMO rarely needs 256k **input** — raise retrieval knobs instead | [Context length](https://docs.ollama.com/context-length) |
| CUDA OOM | Model + KV exceeds pool | Reduce context; `OLLAMA_MAX_LOADED_MODELS=1`; don’t load 72B dense + embed | [ollama#1952](https://github.com/ollama/ollama/issues/1952) |

**Spark + nvfp4 note:** 256k context uses ~5–6 GB KV with Qwen 3.6 MoE; ~85–90 GB typically remains free. See [README — Maximizing context](../README.md#maximizing-context-on-dgx-spark-128-gb-unified-memory).

### Embeddings / RAG

| Symptom | Likely cause | Fix | External |
|---------|----------------|-----|----------|
| `[EMBED] Embedding failed: 404` | Model not pulled | `ollama pull nomic-embed-text` (or your `GZMO_EMBED_MODEL`) | [ollama#3613](https://github.com/ollama/ollama/issues/3613) |
| Embeddings work, search empty | Vault not synced / wrong `VAULT_PATH` | Restart daemon; check `wiki/incoming/`; `bun run doctor` | README |
| Wrong or invented bill lines | Too few chunks in evidence | Set `GZMO_TOPK=12`, `GZMO_EVIDENCE_MAX_SNIPPETS=16`, `GZMO_EVIDENCE_MAX_CHARS=2400`, `GZMO_LLM_MAX_TOKENS=2048` | `.env.spark.example` |
| Answer cut off mid-invoice | Output token cap | `GZMO_LLM_MAX_TOKENS=2048` | README Configure |
| `status: unbound` / halt | GAH/DSJ/teachback | Keep `GZMO_PROFILE=core`; enable gates only when wanted | README Profiles |

### Dropzone ingest

| Symptom | Likely cause | Fix | External |
|---------|----------------|-----|----------|
| Drop ignored | Wrong folder / watcher off | Confirm `GZMO_DROPZONE_DIR`; `GZMO_ENABLE_DROPZONE` not off | README Dropzone |
| PDF useless in search | Image-only PDF (no text layer) | Use `.md` test first; Docling/Marker manually | README Dropzone |
| Duplicate drops | Dedup index | Expected `dropzone-duplicate-ref`; check `GZMO/.gzmo_dropzone_index.json` | README |

### GZMO / systemd (all platforms)

| Symptom | Likely cause | Fix | External |
|---------|----------------|-----|----------|
| `216/GROUP` on start | `User=%u` in user unit | Re-run `./install_service.sh` | README |
| Daemon starts before Ollama | Boot race | Raise `GZMO_OLLAMA_WAIT_MAX_SEC`; or restart daemon after Ollama | README |
| `env: bash\r` | CRLF scripts | `sed -i 's/\r$//' install_service.sh scripts/*.sh` | README |
| Task stays `pending` | Wrong `VAULT_PATH` / permissions | `./scripts/doctor-agentic.sh`; golden task | README |

---

## Recommended Ollama environment (Spark)

Use [`scripts/start-ollama-optimized.sh`](../scripts/start-ollama-optimized.sh) or equivalent:

```bash
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KEEP_ALIVE=-1
OLLAMA_CONTEXT_LENGTH=262144
OLLAMA_MAX_LOADED_MODELS=1
./scripts/start-ollama-optimized.sh
```

---

## Recommended GZMO environment (Spark)

Copy [`gzmo-daemon/.env.spark.example`](../gzmo-daemon/.env.spark.example). Minimum for document / invoice RAG:

```bash
GZMO_PROFILE=core
OLLAMA_MODEL=qwen3.6:35b-a3b-nvfp4
GZMO_EMBED_MODEL=nomic-embed-text
GZMO_DROPZONE_DIR=/home/you/Schreibtisch/GZMO-Dropzone
GZMO_TOPK=12
GZMO_EVIDENCE_MAX_SNIPPETS=16
GZMO_EVIDENCE_MAX_CHARS=2400
GZMO_LLM_MAX_TOKENS=2048
```

Optional upgrade after `ollama pull qwen3-embedding:4b`:

```bash
GZMO_EMBED_MODEL=qwen3-embedding:4b
```

Re-run embedding sync after changing embed model (restart daemon or trigger live sync).

---

## Community write-ups (worth reading)

| Title | URL |
|-------|-----|
| DGX Spark Ollama benchmark (agents, JSON, thinking traps) | https://ai-muninn.com/en/blog/dgx-spark-ollama-benchmark-8-models |
| DGX Spark + Qwen3.5/3.6 vLLM guide (context stress tests) | https://github.com/adadrag/qwen3.5-dgx-spark |
| Why DGX Spark outputs `!!!!!` (NVFP4 / SM121) | https://ai-muninn.com/en/blog/part1-why-your-dgx-spark-says-exclamation-marks |

---

## When to open an upstream issue

- **Ollama / Qwen nvfp4** incoherent after clean `2+2` test and latest Ollama → [ollama/issues](https://github.com/ollama/ollama/issues) (cite tag digest, `ollama ps`, log snippet).
- **Spark hardware / driver** → [DGX Spark forum](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10).
- **GZMO daemon logic** (watcher, evidence, Dropzone) → this repo’s issues with `doctor-report.json` and a minimal Inbox task file.
