#!/usr/bin/env bash
# agentic-setup.sh — Idempotent bootstrap for automation/CI.
#
# Performs:
# - Create the vault scaffold.
# - Write `gzmo-daemon/.env` (or overwrite with `--force-env`).
# - Run `bun install` in `gzmo-daemon/` when Bun is available.
# - Optional: install the systemd user unit (`./install_service.sh`).
# - Optional: install the Pi skill pack into `~/.pi/skills/gzmo-daemon`.
#
# Usage:
#   ./scripts/agentic-setup.sh --vault /abs/path/to/vault
#   ./scripts/agentic-setup.sh --vault /abs/path/to/vault --with-systemd
#   ./scripts/agentic-setup.sh --vault /abs/path/to/vault --with-pi
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="$REPO_ROOT/gzmo-daemon"
ENV_FILE="$DAEMON_DIR/.env"

vault_path=""
ollama_url="http://localhost:11434"
ollama_model="hermes3:8b"
with_systemd=0
with_pi=0
force_env=0

die() { echo "ERROR: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)
      shift
      vault_path="${1:-}"
      ;;
    --ollama-url)
      shift
      ollama_url="${1:-}"
      ;;
    --ollama-model)
      shift
      ollama_model="${1:-}"
      ;;
    --with-systemd)
      with_systemd=1
      ;;
    --with-pi)
      with_pi=1
      ;;
    --force-env)
      force_env=1
      ;;
    -h|--help)
      sed -n '1,60p' "$0"
      exit 0
      ;;
    *)
      die "unknown arg: $1"
      ;;
  esac
  shift || true
done

[[ -n "$vault_path" ]] || die "--vault is required"
[[ "$vault_path" == /* ]] || die "VAULT_PATH must be absolute (got: $vault_path)"

echo "agentic-setup: repo=$REPO_ROOT" >&2
echo "agentic-setup: vault=$vault_path" >&2

echo "agentic-setup: creating vault scaffold…" >&2
mkdir -p "$vault_path/GZMO/Inbox"
mkdir -p "$vault_path/GZMO/Subtasks"
mkdir -p "$vault_path/GZMO/Thought_Cabinet"
mkdir -p "$vault_path/GZMO/Quarantine"
mkdir -p "$vault_path/GZMO/Reasoning_Traces"
mkdir -p "$vault_path/wiki"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "agentic-setup: writing $ENV_FILE" >&2
  cat > "$ENV_FILE" <<EOF
VAULT_PATH="$vault_path"
OLLAMA_URL="$ollama_url"
OLLAMA_MODEL="$ollama_model"
EOF
else
  existing_vault="$(grep -E '^VAULT_PATH=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\"' || true)"
  if (( force_env == 1 )); then
    echo "agentic-setup: overwriting $ENV_FILE (--force-env)" >&2
    cat > "$ENV_FILE" <<EOF
VAULT_PATH="$vault_path"
OLLAMA_URL="$ollama_url"
OLLAMA_MODEL="$ollama_model"
EOF
  else
    echo "agentic-setup: keeping existing $ENV_FILE (edit manually if needed)" >&2
    if [[ -n "${existing_vault:-}" && "$existing_vault" != "$vault_path" ]]; then
      echo "agentic-setup: NOTE: existing VAULT_PATH differs. Re-run with --force-env to update it." >&2
    fi
  fi
fi

if command -v bun >/dev/null 2>&1 || [[ -x "$HOME/.bun/bin/bun" ]]; then
  echo "agentic-setup: bun install (gzmo-daemon)…" >&2
  (cd "$DAEMON_DIR" && bun install)
else
  echo "agentic-setup: bun not found; skipping bun install (see README prerequisites)" >&2
fi

if (( with_systemd == 1 )); then
  echo "agentic-setup: installing systemd user unit…" >&2
  (cd "$REPO_ROOT" && ./install_service.sh)
  echo "agentic-setup: next (manual): systemctl --user daemon-reload && systemctl --user enable --now gzmo-daemon" >&2
fi

if (( with_pi == 1 )); then
  echo "agentic-setup: installing Pi skill pack…" >&2
  if "$REPO_ROOT/scripts/install_pi_skill.sh"; then
    :
  else
    echo "agentic-setup: WARNING: Pi skill install failed (permissions?). You can rerun later or set PI_SKILLS_DIR." >&2
  fi
  echo "agentic-setup: set in your shell: export GZMO_ENV_FILE=\"$ENV_FILE\"" >&2
fi

echo "agentic-setup: done" >&2

