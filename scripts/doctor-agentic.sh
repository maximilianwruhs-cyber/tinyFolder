#!/usr/bin/env bash
# doctor-agentic.sh — single OK / fix-this report for fresh-machine agentic readiness.
# Local-only: Bun + Ollama + vault scaffold + optional systemd user unit visibility.
#
# Safe auto-fixes:
# - create missing vault scaffold directories
#
# Usage:
#   ./scripts/doctor-agentic.sh
#   ./scripts/doctor-agentic.sh --deep
#   ./scripts/doctor-agentic.sh --write            # passes through to bun run doctor --write (can mutate vault)
#   ./scripts/doctor-agentic.sh --no-bun-doctor    # bash checks only
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="$REPO_ROOT/gzmo-daemon"

deep=0
write_mode=0
skip_bun_doctor=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deep) deep=1 ;;
    --write) write_mode=1 ;;
    --no-bun-doctor) skip_bun_doctor=1 ;;
    -h|--help)
      sed -n '1,80p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown arg: $1" >&2
      exit 2
      ;;
  esac
  shift
done

ok=1
fixed_any=0
actions=()

say() { echo "$*"; }
warn() { echo "WARN: $*" >&2; }
fail() { echo "FAIL: $*" >&2; ok=0; }
add_action() { actions+=("$*"); }

have() { command -v "$1" >/dev/null 2>&1; }

normalize_ollama_base() {
  local url="$1"
  # mirror scripts/wait-for-ollama.sh behavior
  url="${url%/v1}"
  echo "${url%/}"
}

parse_env_file() {
  local f="$1"
  # shellcheck disable=SC1090
  set -a
  source "$f"
  set +a
}

walk_env() {
  local dir="$1"
  dir="$(cd "$dir" && pwd -P)"
  while :; do
    if [[ -f "$dir/.env" ]]; then
      echo "$dir/.env"
      return 0
    fi
    if [[ -f "$dir/gzmo-daemon/.env" ]]; then
      echo "$dir/gzmo-daemon/.env"
      return 0
    fi
    [[ "$dir" == "/" ]] && return 1
    dir="$(dirname "$dir")"
  done
}

say "════════════════════════════════════════════════════"
say "  Agentic Doctor (local) — tinyFolder / GZMO"
say "════════════════════════════════════════════════════"
say "Repo:  $REPO_ROOT"
say ""

if [[ ! -d "$DAEMON_DIR" ]]; then
  fail "missing gzmo-daemon/ directory: $DAEMON_DIR"
  add_action "You are not in a tinyFolder checkout. Clone the repo and rerun."
fi

if have bun || [[ -x "$HOME/.bun/bin/bun" ]]; then
  say "PASS: bun present"
else
  fail "bun not found"
  add_action "Install Bun: see README prerequisites, then rerun."
fi

if ! have curl; then
  fail "curl not found (needed to check Ollama)"
  add_action "Install curl: sudo apt-get update && sudo apt-get install -y curl"
fi

env_file=""
if [[ -n "${GZMO_ENV_FILE:-}" && -f "${GZMO_ENV_FILE:-}" ]]; then
  env_file="$GZMO_ENV_FILE"
elif [[ -n "${VAULT_PATH:-}" ]]; then
  env_file="" # env already set via process
else
  if ef="$(walk_env "$(pwd -P)" 2>/dev/null)"; then env_file="$ef"; fi
fi

if [[ -n "$env_file" ]]; then
  say "INFO: using env file: $env_file"
  parse_env_file "$env_file" || { fail "failed to source env file: $env_file"; }
else
  if [[ -n "${VAULT_PATH:-}" ]]; then
    say "INFO: using VAULT_PATH from environment"
  else
    fail "no env found (set GZMO_ENV_FILE or VAULT_PATH, or run from repo tree)"
    add_action "export GZMO_ENV_FILE=\"$REPO_ROOT/gzmo-daemon/.env\"  # recommended"
    add_action "or: export VAULT_PATH=\"/absolute/path/to/your/vault\""
  fi
fi

if [[ -n "${VAULT_PATH:-}" ]]; then
  if [[ "${VAULT_PATH}" != /* ]]; then
    fail "VAULT_PATH must be absolute (got: $VAULT_PATH)"
    add_action "Fix gzmo-daemon/.env: VAULT_PATH must start with /"
  else
    say "PASS: VAULT_PATH=$VAULT_PATH"
  fi
fi

if [[ -n "${VAULT_PATH:-}" ]]; then
  # Safe auto-fix: scaffold dirs
  required_dirs=(
    "$VAULT_PATH/GZMO/Inbox"
    "$VAULT_PATH/GZMO/Subtasks"
    "$VAULT_PATH/GZMO/Thought_Cabinet"
    "$VAULT_PATH/GZMO/Quarantine"
    "$VAULT_PATH/wiki"
  )
  for d in "${required_dirs[@]}"; do
    if [[ -d "$d" ]]; then
      :
    else
      mkdir -p "$d" && fixed_any=1
      warn "FIXED: created missing dir: $d"
    fi
  done
fi

ollama_url="${OLLAMA_URL:-http://localhost:11434}"
ollama_base="$(normalize_ollama_base "$ollama_url")"

if curl -sf --connect-timeout 2 "${ollama_base}/api/tags" >/dev/null 2>&1; then
  say "PASS: Ollama reachable at ${ollama_base}"
else
  fail "Ollama not reachable at ${ollama_base}"
  add_action "Start Ollama (foreground): ollama serve"
  add_action "Or enable service: sudo systemctl enable --now ollama"
fi

model="${OLLAMA_MODEL:-hermes3:8b}"
if have ollama; then
  have_model() { ollama list 2>/dev/null | awk '{print $1}' | grep -Fxq "$1"; }
  if have_model "$model"; then
    say "PASS: model present: $model"
  else
    fail "model missing: $model"
    add_action "Pull model: ollama pull \"$model\""
  fi
  if have_model "nomic-embed-text"; then
    say "PASS: embeddings model present: nomic-embed-text"
  else
    fail "embeddings model missing: nomic-embed-text"
    add_action "Pull embeddings model: ollama pull nomic-embed-text"
  fi
else
  warn "ollama CLI not found; cannot verify models via 'ollama list'"
  add_action "Install Ollama CLI or manually ensure models are pulled:"
  add_action "  ollama pull \"$model\""
  add_action "  ollama pull nomic-embed-text"
fi

if have systemctl; then
  if systemctl --user list-unit-files 2>/dev/null | awk '{print $1}' | grep -Fxq "gzmo-daemon.service"; then
    if systemctl --user is-active --quiet gzmo-daemon 2>/dev/null; then
      say "PASS: systemd user service active: gzmo-daemon"
    else
      warn "gzmo-daemon.service installed but not active"
      add_action "Start it: systemctl --user start gzmo-daemon"
      add_action "Enable at login: systemctl --user enable --now gzmo-daemon"
    fi
  else
    warn "gzmo-daemon.service not installed (optional)"
    add_action "Install unit: ./install_service.sh"
    add_action "Then: systemctl --user daemon-reload && systemctl --user enable --now gzmo-daemon"
  fi
else
  warn "systemctl not found; skipping systemd checks"
fi

if (( skip_bun_doctor == 0 )); then
  if have bun || [[ -x "$HOME/.bun/bin/bun" ]]; then
    profile="fast"
    (( deep == 1 )) && profile="deep"
    readonly_flag="--readonly"
    if (( write_mode == 1 )); then
      readonly_flag="--write"
      warn "write mode enabled: bun doctor may write to your vault"
    fi
    say ""
    say "Running: (cd gzmo-daemon && bun run doctor ${readonly_flag} --profile ${profile})"
    (
      cd "$DAEMON_DIR"
      # Ensure env is passed through (source already sets env vars in this shell).
      bun run doctor "$readonly_flag" --profile "$profile" || ok=0
    )
  else
    warn "Skipping bun run doctor (bun missing)"
  fi
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

