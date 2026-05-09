#!/usr/bin/env bash
# doctor-agentic.sh — single OK / fix-this report for fresh-machine agentic readiness.
# Local-only: Bun + Ollama + vault scaffold + optional systemd user unit visibility.
#
# Safe auto-fixes:
# - create missing vault scaffold directories (when VAULT_PATH is set)
#
# Usage:
#   export GZMO_ENV_FILE="$(pwd)/gzmo-daemon/.env"   # optional; defaults to repo gzmo-daemon/.env
#   ./scripts/doctor-agentic.sh
#   ./scripts/doctor-agentic.sh --deep
#   ./scripts/doctor-agentic.sh --write            # passes through to bun run doctor --write
#   ./scripts/doctor-agentic.sh --heal             # passes through to bun run doctor --heal
#   ./scripts/doctor-agentic.sh --no-bun-doctor    # bash checks only
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="$REPO_ROOT/gzmo-daemon"
ENV_FILE="${GZMO_ENV_FILE:-$DAEMON_DIR/.env}"

deep=0
write_mode=0
skip_bun_doctor=0
heal=0

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deep) deep=1 ;;
    --write) write_mode=1 ;;
    --heal) heal=1 ;;
    --no-bun-doctor) skip_bun_doctor=1 ;;
    -h|--help)
      sed -n '1,25p' "$0"
      exit 0
      ;;
    *)
      warn "unknown argument: $1 (try --help)"
      exit 2
      ;;
  esac
  shift
done

export GZMO_ENV_FILE="$ENV_FILE"

ok=1
fixed_any=0
actions=()

extract_vault_path() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  local line raw
  line="$(grep -E '^[[:space:]]*VAULT_PATH=' "$f" | head -n1 || true)"
  [[ -n "$line" ]] || return 1
  raw="${line#*=}"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

# Fast checks before Bun doctor
if ! command -v curl >/dev/null 2>&1; then
  warn "curl not found in PATH"
  ok=0
  actions+=("Install curl (needed for Ollama checks).")
fi

vault_path=""
if [[ -f "$ENV_FILE" ]]; then
  vault_path="$(extract_vault_path "$ENV_FILE" || true)"
  if [[ -z "${vault_path:-}" ]]; then
    warn "VAULT_PATH missing or empty in $ENV_FILE"
    ok=0
    actions+=("Set VAULT_PATH to an absolute vault directory in $ENV_FILE")
  elif [[ ! -d "$vault_path" ]]; then
    warn "VAULT_PATH is not a directory: $vault_path"
    ok=0
    actions+=("Create the vault directory or fix VAULT_PATH in $ENV_FILE")
  else
    for sub in GZMO/Inbox GZMO/Subtasks GZMO/Thought_Cabinet GZMO/Quarantine GZMO/Reasoning_Traces wiki; do
      d="$vault_path/$sub"
      if [[ ! -d "$d" ]]; then
        mkdir -p "$d"
        fixed_any=1
      fi
    done
  fi
fi

ollama_url="${OLLAMA_URL:-http://localhost:11434}"
if command -v curl >/dev/null 2>&1; then
  if ! curl -sf "${ollama_url}/api/tags" >/dev/null 2>&1; then
    warn "Ollama not reachable at $ollama_url (start ollama or set OLLAMA_URL)"
    ok=0
    actions+=("Start Ollama and ensure curl -sf \"\$OLLAMA_URL/api/tags\" succeeds")
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  warn "Missing env file: $ENV_FILE"
  ok=0
  actions+=("Create gzmo-daemon/.env with absolute VAULT_PATH (see README Configure).")
fi

if (( skip_bun_doctor == 1 )); then
  say ""
  if (( ok == 1 )) && (( fixed_any == 0 )); then
    say "OK (bash checks only)"
    exit 0
  fi
  if (( ok == 1 )) && (( fixed_any == 1 )); then
    say "OK (bash checks only, scaffold dirs created)"
    exit 0
  fi
  say "FIX-THIS"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1 && [[ -x "${HOME:-}/.bun/bin/bun" ]]; then
  export PATH="${HOME}/.bun/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  warn "bun not found; skipping daemon doctor."
  ok=0
  actions+=("Install Bun and run: cd gzmo-daemon && bun install && bun run doctor …")
else
  doc=(run doctor)
  if (( deep == 1 )); then
    doc+=(--profile deep)
  else
    doc+=(--profile fast)
  fi
  if (( write_mode == 1 )); then
    doc+=(--write)
  fi
  if (( heal == 1 )); then
    doc+=(--heal)
  fi
  say "Running: (cd gzmo-daemon && bun ${doc[*]})"
  (cd "$DAEMON_DIR" && bun "${doc[@]}") || ok=0
fi

say ""
if (( ok == 1 )) && (( fixed_any == 0 )); then
  say "OK"
  exit 0
fi

if (( ok == 1 )) && (( fixed_any == 1 )); then
  say "OK (with safe fixes applied)"
  exit 0
fi

say "FIX-THIS"
if ((${#actions[@]})); then
  say ""
  say "Suggested actions:"
  i=1
  for a in "${actions[@]}"; do
    say "  ${i}) ${a}"
    i=$((i + 1))
  done
fi
exit 1
