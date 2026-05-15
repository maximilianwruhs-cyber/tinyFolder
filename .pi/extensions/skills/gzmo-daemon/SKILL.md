---
name: gzmo-daemon
description: >-
  Orchestrate tinyFolder GZMO daemon tasks: vault search, Inbox tasks, health.
  Use when working with GZMO Inbox, vault RAG search, or daemon status.
---

# GZMO (tinyFolder) — Pi workflows

This skill is bundled with the `gzmo-tinyfolder` Pi extension when the extension is loaded from the repo. Prefer **extension tools** below; use shell scripts under `contrib/pi-gzmo-skill/` only outside Pi (CI, terminal).

## Tools (primary)

| Goal | Tool |
|------|------|
| Vault search (RAG, evidence packet) | `gzmo_query_context` with `query` |
| Submit a task | `gzmo_submit_task` with `action` + `body` |
| Wait until a task finishes | `gzmo_watch_task` with `task_path` |
| Read full task output | `gzmo_read_task` with `task_path` |
| Recent tasks / filter | `gzmo_list_tasks`, `gzmo_last_tasks` |
| Daemon health | `gzmo_health` |

## Vault search

1. Call `gzmo_query_context({ query: "..." })`. This creates a `search` Inbox task, waits for completion, and returns grounded text (`## Evidence Packet` or `## GZMO Response` when present on disk).
2. If `final_status` is `failed`, summarize the excerpt and ask the user before retrying.

## Submit and follow

1. `gzmo_submit_task({ action: "think" | "search" | "chain", body: "...", chain_next?: "..." })` — returns `task_path`.
2. `gzmo_watch_task({ task_path })` — blocks until `completed`, `failed`, or `unbound`, or timeout.
3. If `unbound`, read the clarification block; use `gzmo_resume_task({ task_path, note })` then watch again.

Optional env (default off): `GZMO_ENABLE_THINK_CLARIFY` halts think tasks that cite missing vault files.
3. On success: summarize the excerpt from the tool result. On failure: use `gzmo_read_task` for the full file.

When a task reaches a terminal state, the extension may also post a short **custom message** in chat (no extra tool call).

## Health

- `gzmo_health()` — tail of `GZMO/health.md` for the resolved vault.
- If the vault cannot be resolved or the daemon looks wrong, see the main **README** in the tinyFolder repo (troubleshooting, `bun run doctor` in `gzmo-daemon`).

## UI

- Status line and widget: pending/processing counts + `Live_Stream` tail.
- Slash: `/gzmo` — dashboard overlay; `/gzmo-last [N]` — last N tasks.

## Environment

Resolution order: `GZMO_ENV_FILE` → `VAULT_PATH` → walking up from cwd for `.env` / `gzmo-daemon/.env`. `VAULT_PATH` in `.env` must be **absolute**.
