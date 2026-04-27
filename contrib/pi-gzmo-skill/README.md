# Pi / shell helpers for GZMO inbox

Vendored scripts for the **Pi** coding agent (or plain shell). Fixes common mistakes: **sourcing** `.env` (not running it in a subshell), finding **`gzmo-daemon/.env`** when walking from the repo tree, **`chain_next`** for `action: chain`, and a **timeout** when watching a task file.

| Script | Role |
|--------|------|
| `scripts/resolve_env.sh` | **Source only** — sets `VAULT_PATH` via `GZMO_ENV_FILE`, `$PWD`, or skill dir walk |
| `scripts/submit_task.sh` | Writes `GZMO/Inbox/*.md` with valid frontmatter |
| `scripts/watch_task.sh` | Polls until `status` is `completed` or `failed` |

**Install:** see [SKILL.md](SKILL.md) or [AGENTS.md](../../AGENTS.md) (Pi skill section).

**Replace a broken `~/.pi/skills/gzmo-daemon`:** same install commands overwrite `scripts/` and `SKILL.md`.
