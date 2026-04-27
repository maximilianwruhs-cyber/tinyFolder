# AGENTS — tinyFolder / GZMO

This file is the **control tower** for coding agents. It states non‑negotiables, the **order in which to use [README.md](README.md)**, and deep links into that playbook. **Do not skip README** for examples, full env var lists, or task YAML—open the linked section.

---

## Non‑negotiables

| Topic | Rule |
|--------|------|
| **Platform** | **Ubuntu Linux** (or similar with `systemctl --user`). Unsupported: Windows, macOS. |
| **Integration** | **No HTTP task API.** Tasks are Markdown files under `$VAULT_PATH/GZMO/Inbox/` with YAML frontmatter (`status`, `action`, …). |
| **`VAULT_PATH`** | Must be an **absolute** path in `gzmo-daemon/.env`. |
| **Line endings** | Repo shell scripts are **LF**. If `install_service.sh` fails with `bash\r`, run: `sed -i 's/\r$//' install_service.sh scripts/*.sh gzmo-daemon/deploy_to_stick.sh`. |
| **User systemd unit** | Must **not** contain `User=%u` (causes **216/GROUP**). Regenerate with `./install_service.sh`. |

---

## README map (open these sections)

Use [README.md — Table of contents](README.md#table-of-contents) as the canonical outline. Quick index:

| Goal | README section |
|------|----------------|
| Fastest path from zero | [First 5 minutes](README.md#first-5-minutes-copypaste-checklist) |
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
| Pi / shell inbox scripts | [contrib/pi-gzmo-skill](contrib/pi-gzmo-skill/README.md) |

---

## Pi skill (optional)

Use the **vendored** pack [`contrib/pi-gzmo-skill/`](contrib/pi-gzmo-skill/README.md) instead of ad‑hoc `~/.pi/skills/...` copies that **execute** `.env` in a subshell (those never export `VAULT_PATH` to `submit_task.sh`).

**Apply (agent or human):**

1. `REPO=/absolute/path/to/tinyFolder`
2. `mkdir -p ~/.pi/skills/gzmo-daemon/scripts`
3. `cp "$REPO/contrib/pi-gzmo-skill/SKILL.md" "$REPO/contrib/pi-gzmo-skill/README.md" ~/.pi/skills/gzmo-daemon/`
4. `cp "$REPO/contrib/pi-gzmo-skill/scripts/"*.sh ~/.pi/skills/gzmo-daemon/scripts/`
5. `chmod +x ~/.pi/skills/gzmo-daemon/scripts/*.sh`
6. `export GZMO_ENV_FILE="$REPO/gzmo-daemon/.env"` (recommended), **or** run scripts with `cwd` under `$REPO` so `gzmo-daemon/.env` is discovered.

**Usage:** `submit_task.sh think|search "body"` · `submit_task.sh chain next.md "body"` · `watch_task.sh /path/to/task.md`. Contract matches [Submit tasks](README.md#submit-tasks-inbox-contract).

---

## Playbooks (which README sections, in order)

### A. Cold start (local dev, foreground)

1. [Prerequisites](README.md#prerequisites) — Bun, Ollama, pull models.
2. [Install](README.md#install) — `cd gzmo-daemon && bun install`.
3. [Create a vault scaffold](README.md#create-a-vault-scaffold) + [Configure](README.md#configure-environment-variables) — `.env` with absolute `VAULT_PATH`.
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
4. If stuck: [Troubleshooting](README.md#troubleshooting) + `cd gzmo-daemon && bun run doctor`.
5. Inspect artifacts under `$VAULT_PATH/GZMO/` per [Operational outputs](README.md#operational-outputs-what-the-daemon-writes).

### D. Change behavior without code edits

1. [Configure](README.md#configure-environment-variables) — feature toggles, retrieval knobs, `GZMO_PROFILE`.
2. [Profiles / safe modes](README.md#profiles--safe-modes) — reduced subsystems.

### E. Pi or shell helpers for the inbox

1. [Pi skill (optional)](README.md#pi-skill-optional) — install `contrib/pi-gzmo-skill` into `~/.pi/skills/gzmo-daemon`, set `GZMO_ENV_FILE`, run `submit_task.sh` / `watch_task.sh`.

---

## Minimal execution checklist (copy)

Use this as a **order-of-operations** reminder; details and commands live in README links above.

- [ ] `curl -sf "${OLLAMA_URL:-http://localhost:11434}/api/tags"` succeeds (or fix Ollama).
- [ ] `ollama pull` for `OLLAMA_MODEL` and `nomic-embed-text` if RAG/embeddings matter.
- [ ] `cd gzmo-daemon && bun install`
- [ ] `gzmo-daemon/.env`: absolute `VAULT_PATH`, `OLLAMA_URL`, `OLLAMA_MODEL`
- [ ] Vault dirs: `GZMO/Inbox`, `Subtasks`, `Thought_Cabinet`, `Quarantine`, `wiki` (see scaffold section).
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
