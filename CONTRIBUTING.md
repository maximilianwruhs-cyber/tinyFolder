# Contributing to tinyFolder / GZMO

Thank you for improving GZMO. This project targets **Ubuntu Linux** with **Bun**, **Ollama**, and optional **user systemd**.

## Development setup

1. Install [Bun](https://bun.sh) and [Ollama](https://ollama.com).
2. `cd gzmo-daemon && bun install`
3. Copy `gzmo-daemon/.env.example` → `.env` and set an **absolute** `VAULT_PATH`.
4. Run the daemon: `bun run summon` (foreground) or use `./install_service.sh` for systemd.

See [README.md](README.md) and [AGENTS.md](AGENTS.md) for full playbooks.

## Before you open a PR

```bash
cd gzmo-daemon
bun run smoke          # tsc --noEmit + bun test
```

With Ollama and a configured vault:

```bash
bun run smoke:full     # adds proof:local-vault
bun run doctor
```

## Code conventions

- **TypeScript** in `gzmo-daemon/src/` — match existing naming and import style.
- **Vault I/O** — use `vault_fs.ts` (`resolveVaultPath`, `safeWriteText`, `atomicWriteText`); never write under `raw/`.
- **Inbox contract** — tasks are Markdown + YAML frontmatter; do not introduce a separate task queue.
- **Tests** — Bun built-in test runner (`bun:test`); add cases under `src/__tests__/`.
- **Shell scripts** — LF line endings only (CRLF breaks `install_service.sh` on Linux).

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module map and data flow.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities and the threat model.

## License

MIT — see [LICENSE](LICENSE).
