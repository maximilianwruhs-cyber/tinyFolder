# AGENTS — tinyFolder / GZMO

> **Archived.** Use **[gzmo_tinyFolder](https://github.com/maximilianwruhs-cyber/gzmo_tinyFolder)** and its [`AGENTS.md`](https://github.com/maximilianwruhs-cyber/gzmo_tinyFolder/blob/main/AGENTS.md) for new work.

This file is the **control tower** for coding agents. It states non‑negotiables, the **order in which to use [README.md](README.md)**, and deep links into that playbook. **Do not skip README** for examples, full env var lists, or task YAML—open the linked section.

---

## Non‑negotiables

| Topic | Rule |
|--------|------|
| **Platform** | **Ubuntu Linux** (or similar with `systemctl --user`). Unsupported: Windows, macOS. |
| **Integration** | **Filesystem inbox is the contract** — tasks are Markdown under `$VAULT_PATH/GZMO/Inbox/` with YAML frontmatter (`status`, `action`, …). An optional HTTP layer only **mirrors** those files into the same Inbox (see README HTTP API); there is no separate task queue API. |
| **`VAULT_PATH`** | Must be an **absolute** path in `gzmo-daemon/.env`. |
| **Dropzone** | Physical drops: **`GZMO_DROPZONE_DIR`** (e.g. `~/Schreibtisch/GZMO-Dropzone`). Vault may live elsewhere. |
| **Inference models** | **Best overall:** **`qwen3.6:35b-a3b-nvfp4`** (Blackwell / compute **12.0+**). **Fallback same gen:** **`qwen3.6:35b-a3b`** (≈**24 GB** Q4, ≥24 GB VRAM). **Code default if unset:** `hermes3:8b` (4–8 GB). Full VRAM table: [README — Recommended models](README.md#recommended-models). |
| **DGX Spark** | Template: [`.env.spark.example`](gzmo-daemon/.env.spark.example) · Profile **`core`** · Ollama ctx **262144** via [`scripts/start-ollama-optimized.sh`](scripts/start-ollama-optimized.sh). |
| **Line endings** | Repo shell scripts are **LF**. If `install_service.sh` fails with `bash\r`, run: `sed -i 's/\r$//' install_service.sh scripts/*.sh`. |
| **User systemd unit** | Must **not** contain `User=%u` (causes **216/GROUP**). Regenerate with `./install_service.sh`. |

---

## README map (open these sections)

Use [README.md — Table of contents](README.md#table-of-contents) as the canonical outline. Quick index:

| Goal | README section |
|------|----------------|
| Fastest path from zero | [First 5 minutes](README.md#first-5-minutes-copypaste-checklist) |
| Pick an installer (human vs agent) | [Which installer?](README.md#which-installer-human-vs-agent) |
| DGX Spark setup | [Bigger machine (DGX Spark)](README.md#bigger-machine-dgx-spark--64gb-ram--quick-path) |
| Context + memory on 128 GB | [Maximizing context on DGX Spark](README.md#maximizing-context-on-dgx-spark-128-gb-unified-memory) |
| Spark failures (Ollama, Qwen, GZMO) | [docs/TROUBLESHOOTING_SPARK.md](docs/TROUBLESHOOTING_SPARK.md) |
| **On-box self-help (read first when stuck)** | `$VAULT_PATH/GZMO/SELF_HELP.md` — from [`scripts/spark-self-check.sh`](scripts/spark-self-check.sh) |
| Repeatable fresh-machine setup | [Fresh machine agentic bootstrap](README.md#fresh-machine-agentic-bootstrap-recommended) |
| Doctor / readiness wrapper | [Doctor (agentic readiness)](README.md#doctor-agentic-readiness) |
| How tasks work (mental model) | [Mental model](README.md#mental-model) |
| Design philosophy (vault vs chat UX) | [Why GZMO is not a chatbot](README.md#why-gzmo-is-not-a-chatbot) · [`contrib/env-modes/`](contrib/env-modes/README.md) |
| Bun, Ollama, models | [Prerequisites](README.md#prerequisites) → [Recommended models](README.md#recommended-models) |
| `bun install` | [Install](README.md#install) |
| Directory layout | [Create a vault scaffold](README.md#create-a-vault-scaffold) |
| `.env` and all env knobs | [Configure (environment variables)](README.md#configure-environment-variables) |
| Dev / foreground daemon | [Run (foreground)](README.md#run-foreground) |
| Production / boot | [Run (systemd user service)](README.md#run-systemd-user-service) |
| Task formats, golden test | [Submit tasks (Inbox contract)](README.md#submit-tasks-inbox-contract) → [Golden minimal task](README.md#golden-minimal-task-end-to-end-verification) |
| What files the daemon writes | [Operational outputs](README.md#operational-outputs-what-the-daemon-writes) |
| Subsystem toggles / `GZMO_PROFILE` | [Profiles / safe modes](README.md#profiles--safe-modes) |
| Tests / eval | [Proof / smoke / eval commands](README.md#proof--smoke--eval-commands) |
| Ollama, doctor, CRLF, 216, ExecStartPre | [Troubleshooting](README.md#troubleshooting) |
| What’s in git | [Repo contents](README.md#repo-contents-what-is-public) |
| Fine-tuning, perf baselines | [Additional documentation](README.md#additional-documentation) |
| Pi / shell inbox scripts | [contrib/pi-gzmo-skill](contrib/pi-gzmo-skill/README.md) |

---

## Pi extension (auto-loaded inside repo)

When Pi opens the tinyFolder repo, the project extension [`.pi/extensions/gzmo-tinyfolder.ts`](.pi/extensions/gzmo-tinyfolder.ts) auto-loads. It:

- Registers **7 GZMO tools**: `gzmo_submit_task`, `gzmo_read_task`, `gzmo_watch_task`, `gzmo_query_context`, `gzmo_list_tasks`, `gzmo_last_tasks`, `gzmo_health`.
- Registers **`resources_discover`** so Pi auto-discovers the bundled skill at [`.pi/extensions/skills/gzmo-daemon/`](.pi/extensions/skills/gzmo-daemon/) — **no manual install** in `~/.pi/skills/` needed.
- Provides **ambient inbox status** via `before_agent_start` injection, plus a live widget/status bar.
- Exposes `/gzmo` (dashboard) and `/gzmo-last [N]` commands.

**Environment:** same resolution as before (`GZMO_ENV_FILE` → `VAULT_PATH` → walk for `.env`). `VAULT_PATH` must be absolute.

## Shell / CI / non‑Pi fallback

If you need plain shell scripts (no Pi), use the **vendored** pack [`contrib/pi-gzmo-skill/`](contrib/pi-gzmo-skill/README.md). It includes `submit_task.sh`, `watch_task.sh`, and `resolve_env.sh`.

Install into `~/.pi/skills/gzmo-daemon` **only if** you want the shell helpers visible in Pi's global skills tree alongside other skills (the bundled skill is already auto-loaded by the extension when in this repo):

```bash
REPO=/absolute/path/to/tinyFolder
mkdir -p ~/.pi/skills/gzmo-daemon/scripts
cp "$REPO/contrib/pi-gzmo-skill/"{SKILL.md,README.md} ~/.pi/skills/gzmo-daemon/
cp "$REPO/contrib/pi-gzmo-skill/scripts/"*.sh ~/.pi/skills/gzmo-daemon/scripts/
chmod +x ~/.pi/skills/gzmo-daemon/scripts/*.sh
export GZMO_ENV_FILE="$REPO/gzmo-daemon/.env"
```

**Shell usage:** `submit_task.sh think|search "body"` · `submit_task.sh chain next.md "body"` · `watch_task.sh /path/to/task.md`. Contract matches [Submit tasks](README.md#submit-tasks-inbox-contract).

---

## Playbooks (which README sections, in order)

### A. Cold start (local dev, foreground)

1. [Prerequisites](README.md#prerequisites) — Bun, Ollama, pull models.
2. [Install](README.md#install) — `cd gzmo-daemon && bun install`.
3. Either follow [Create a vault scaffold](README.md#create-a-vault-scaffold) + [Configure](README.md#configure-environment-variables), or use [`./scripts/setup.sh`](README.md#which-installer-human-vs-agent) (`human` for full stack + wizard, `agent --vault …` for minimal bootstrap).
4. [Run (foreground)](README.md#run-foreground) — Ollama + `bun run summon`.
5. [Golden minimal task](README.md#golden-minimal-task-end-to-end-verification) — prove end‑to‑end.

### B. Production (systemd user service)

1. Complete **A** or ensure Ollama is available (often `sudo systemctl enable --now ollama`).
2. [Run (systemd user service)](README.md#run-systemd-user-service) — `./install_service.sh`, `daemon-reload`, `enable --now gzmo-daemon`.
3. Optional: `./scripts/boot-stack.sh` for one‑shot Ollama + daemon.
4. Logs: `journalctl --user -u gzmo-daemon -f` (see README). Expect `[OLLAMA] Connected` after a clean boot.
5. After **any** `.env` or unit change: `systemctl --user daemon-reload && systemctl --user restart gzmo-daemon`.

### C. Submit or debug a task

1. [Mental model](README.md#mental-model) — lifecycle `pending → processing → completed | failed`.
2. [Submit tasks](README.md#submit-tasks-inbox-contract) — copy YAML patterns for `think` / `search` / `chain`.
3. For `search`, respect the evidence / `[E#]` rules in Mental model.
4. If stuck: read **`$VAULT_PATH/GZMO/SELF_HELP.md`** (regenerated by doctor/boot), then [Troubleshooting](README.md#troubleshooting) + `./scripts/doctor-agentic.sh` (or `cd gzmo-daemon && bun run doctor`).
5. Inspect artifacts under `$VAULT_PATH/GZMO/` per [Operational outputs](README.md#operational-outputs-what-the-daemon-writes).

### D. Change behavior without code edits

1. [Configure](README.md#configure-environment-variables) — feature toggles, retrieval knobs, `GZMO_PROFILE`.
2. [Profiles / safe modes](README.md#profiles--safe-modes) — reduced subsystems.

### E. Pi or shell helpers for the inbox

1. [Pi skill (optional)](README.md#pi-skill-optional) — with the repo extension active, the GZMO skill loads from `.pi/extensions/skills/`; otherwise install `contrib/pi-gzmo-skill` into `~/.pi/skills/gzmo-daemon` for shell helpers, set `GZMO_ENV_FILE`, run `submit_task.sh` / `watch_task.sh`.

### F. DGX Spark — document / invoice RAG (production)

1. [Bigger machine (DGX Spark)](README.md#bigger-machine-dgx-spark--64gb-ram--quick-path) — bootstrap + Dropzone on Desktop.
2. Start Ollama: [`scripts/start-ollama-optimized.sh`](scripts/start-ollama-optimized.sh) (`OLLAMA_CONTEXT_LENGTH=262144` on Spark).
3. Copy [`gzmo-daemon/.env.spark.example`](gzmo-daemon/.env.spark.example) → `.env` (or use `agent` bootstrap — writes Dropzone + `GZMO_TOPK` / evidence / `GZMO_LLM_MAX_TOKENS`).
4. `ollama pull qwen3.6:35b-a3b-nvfp4` · `ollama pull nomic-embed-text` · optional `qwen3-embedding:4b`.
5. [Run (systemd)](README.md#run-systemd-user-service) — `install_service.sh`, enable `gzmo-daemon`.
6. **Self-check:** `./scripts/spark-self-check.sh --heal --write-vault` → updates **`$VAULT_PATH/GZMO/SELF_HELP.md`** (ordered fixes for agents).
7. Bill smoke test: drop fake invoice in `GZMO_DROPZONE_DIR` → `wiki/incoming/` → auto search task → answer cites **`[E#]`** with correct amounts.
8. Enable `GZMO_PROFILE=interactive` / GAH / DSJ only when clarification halts are desired.

### G. Chaos / dreams (“art metabolism”) without Inbox floods

1. [Profiles / safe modes](README.md#profiles--safe-modes) — use `GZMO_PROFILE=art`: pulse + dreams + self-ask stay on; wiki auto-consolidation off; `GZMO_AUTO_INBOX_*` defaults keep Thought Cabinet loops from spawning unsolicited Inbox thinks unless you opt in.
2. Re-enable bridges when desired: `GZMO_AUTO_INBOX_FROM_SELF_ASK=on`, `GZMO_AUTO_INBOX_FROM_DREAMS=on`, `GZMO_AUTO_INBOX_FROM_WIKI_REPAIR=on`, or `GZMO_ENABLE_WIKI=on`.

---

## Minimal execution checklist (copy)

Use this as a **order-of-operations** reminder; details and commands live in README links above.

- [ ] `curl -sf "${OLLAMA_URL:-http://localhost:11434}/api/tags"` succeeds (or fix Ollama).
- [ ] **Ollama:** `./scripts/start-ollama-optimized.sh` (Spark: confirm `OLLAMA_CONTEXT_LENGTH=262144` in logs).
- [ ] `ollama pull` for `OLLAMA_MODEL` + `GZMO_EMBED_MODEL` per [VRAM tier](README.md#recommended-models): laptop **`hermes3:8b`**; workstation **≥24 GB** **`qwen3.6:35b-a3b`**; Blackwell / Spark **`qwen3.6:35b-a3b-nvfp4`**; always **`nomic-embed-text`**.
- [ ] `cd gzmo-daemon && bun install`
- [ ] `gzmo-daemon/.env`: copy from [`.env.example`](gzmo-daemon/.env.example); absolute `VAULT_PATH`; `GZMO_PROFILE=core` unless you intentionally use `art`/`interactive`; `OLLAMA_*`; optional `GZMO_DROPZONE_DIR` (**Spark:** copy [`.env.spark.example`](gzmo-daemon/.env.spark.example)).
- [ ] Document RAG on Spark: `GZMO_TOPK=12`, `GZMO_EVIDENCE_MAX_*`, `GZMO_LLM_MAX_TOKENS=2048` (bootstrap writes these on Spark).
- [ ] Vault dirs: `GZMO/Inbox`, `wiki/incoming`, … (see scaffold); Dropzone dir exists on Desktop if using `GZMO_DROPZONE_DIR`.
- [ ] `ollama ps` after first run: **100% GPU**, `CONTEXT` ≈ 262144 on Spark.
- [ ] Foreground **or** `./install_service.sh` + `systemctl --user enable --now gzmo-daemon`
- [ ] Golden minimal task → `status: completed`; bill drop test → correct `[E#]` citations

---

## Pitfalls (expanded)

Full Spark matrix: **[`docs/TROUBLESHOOTING_SPARK.md`](docs/TROUBLESHOOTING_SPARK.md)** (NVIDIA + Ollama + GitHub links).

- **Ollama after daemon:** internal retries can exhaust before Ollama is up. Prefer systemd `ExecStartPre` wait ([Configure — Clean boot](README.md#clean-boot-systemd-helper-env)) or `systemctl --user restart gzmo-daemon` after Ollama is ready.
- **Embedding 404 in logs:** missing **`GZMO_EMBED_MODEL`** (default `nomic-embed-text`) — `ollama pull` that tag.
- **Empty or `!!!!!` answers:** thinking mode or bad **nvfp4** variant — see TROUBLESHOOTING_SPARK (use `qwen3.6:35b-a3b-nvfp4`, not `*-coding-nvfp4`; run `2+2` sanity test).
- **Weak bill answers on Spark:** raise **`GZMO_TOPK` / `GZMO_EVIDENCE_MAX_*` / `GZMO_LLM_MAX_TOKENS`** — Ollama 256k context alone does not inject more vault text.
- **Wrong model on big hardware:** prefer **`qwen3.6:35b-a3b-nvfp4`** (Blackwell) or **`qwen3.6:35b-a3b`** (≥24 GB), not legacy **`qwen2.5:72b`** / dense **70B** — see [Recommended models](README.md#recommended-models) and [`.env.spark.example`](gzmo-daemon/.env.spark.example).
- **UMA memory pressure on Spark:** `drop_caches` per NVIDIA playbook — TROUBLESHOOTING_SPARK.
- **ExecStartPre timeout:** raise `GZMO_OLLAMA_WAIT_MAX_SEC` or set `GZMO_SYSTEMD_WAIT_FOR_OLLAMA=0` (see README Configure).
- **`install_service` / `env` errors:** CRLF on scripts — see Non‑negotiables.

---

## Single source for prose detail

Everything long‑form (exact golden task text, example frontmatter blocks, full env list) stays in **[README.md](README.md)**. This file tells you **when** to open **which** section.
