# AGENTS — tinyFolder / GZMO

This file is the **control tower** for coding agents. It states non‑negotiables, the **order in which to use [README.md](README.md)**, and deep links into that playbook. **Do not skip README** for examples, full env var lists, or task YAML—open the linked section.

---

## Non‑negotiables

| Topic | Rule |
|--------|------|
| **Platform** | **Ubuntu Linux** (or similar with `systemctl --user`). Unsupported: Windows, macOS. |
| **Integration** | **Filesystem inbox is the contract** — tasks are Markdown under `$VAULT_PATH/GZMO/Inbox/` with YAML frontmatter (`status`, `action`, …). An optional HTTP layer only **mirrors** those files into the same Inbox (see README HTTP API); there is no separate task queue API. |
| **`VAULT_PATH`** | Must be an **absolute** path in `gzmo-daemon/.env`. |
| **Line endings** | Repo shell scripts are **LF**. If `install_service.sh` fails with `bash\r`, run: `sed -i 's/\r$//' install_service.sh scripts/*.sh`. |
| **User systemd unit** | Must **not** contain `User=%u` (causes **216/GROUP**). Regenerate with `./install_service.sh`. |

---

## README map (open these sections)

Use [README.md — Table of contents](README.md#table-of-contents) as the canonical outline. Quick index:

| Goal | README section |
|------|----------------|
| Fastest path from zero | [First 5 minutes](README.md#first-5-minutes-copypaste-checklist) |
| Pick an installer (human vs agent) | [Which installer?](README.md#which-installer-human-vs-agent) |
| Repeatable fresh-machine setup | [Fresh machine agentic bootstrap](README.md#fresh-machine-agentic-bootstrap-recommended) |
| Doctor / readiness wrapper | [Doctor (agentic readiness)](README.md#doctor-agentic-readiness) |
| How tasks work (mental model) | [Mental model](README.md#mental-model) |
| Bun, Ollama, models | [Prerequisites](README.md#prerequisites) |
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
4. If stuck: [Troubleshooting](README.md#troubleshooting) + `cd gzmo-daemon && bun run doctor` (or from repo root: `./scripts/doctor-agentic.sh`).
5. Inspect artifacts under `$VAULT_PATH/GZMO/` per [Operational outputs](README.md#operational-outputs-what-the-daemon-writes).

### D. Change behavior without code edits

1. [Configure](README.md#configure-environment-variables) — feature toggles, retrieval knobs, `GZMO_PROFILE`.
2. [Profiles / safe modes](README.md#profiles--safe-modes) — reduced subsystems.

### E. Pi or shell helpers for the inbox

1. [Pi skill (optional)](README.md#pi-skill-optional) — with the repo extension active, the GZMO skill loads from `.pi/extensions/skills/`; otherwise install `contrib/pi-gzmo-skill` into `~/.pi/skills/gzmo-daemon` for shell helpers, set `GZMO_ENV_FILE`, run `submit_task.sh` / `watch_task.sh`.

---

## Minimal execution checklist (copy)

Use this as a **order-of-operations** reminder; details and commands live in README links above.

- [ ] `curl -sf "${OLLAMA_URL:-http://localhost:11434}/api/tags"` succeeds (or fix Ollama).
- [ ] `ollama pull` for `OLLAMA_MODEL` and `nomic-embed-text` if RAG/embeddings matter.
- [ ] `cd gzmo-daemon && bun install`
- [ ] `gzmo-daemon/.env`: absolute `VAULT_PATH`, `OLLAMA_URL`, `OLLAMA_MODEL`
- [ ] Vault dirs: `GZMO/Inbox`, `Subtasks`, `Thought_Cabinet`, `Quarantine`, `Reasoning_Traces`, `wiki` (see scaffold section).
- [ ] Foreground **or** `./install_service.sh` + `systemctl --user enable --now gzmo-daemon`
- [ ] Golden minimal task → `status: completed` and expected line in file body

---

## Pitfalls (expanded)

- **Ollama after daemon:** internal retries can exhaust before Ollama is up. Prefer systemd `ExecStartPre` wait ([Configure — Clean boot](README.md#clean-boot-systemd-helper-env)) or `systemctl --user restart gzmo-daemon` after Ollama is ready.
- **Embedding 404 in logs:** usually missing **`nomic-embed-text`** — `ollama pull nomic-embed-text`.
- **ExecStartPre timeout:** raise `GZMO_OLLAMA_WAIT_MAX_SEC` or set `GZMO_SYSTEMD_WAIT_FOR_OLLAMA=0` (see README Configure).
- **`install_service` / `env` errors:** CRLF on scripts — see Non‑negotiables.

---

## Single source for prose detail

Everything long‑form (exact golden task text, example frontmatter blocks, full env list) stays in **[README.md](README.md)**. This file tells you **when** to open **which** section.
