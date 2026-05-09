#!/usr/bin/env bash
#
# setup.sh — Route to setup flows (human/agent/doctor).
#
#   human  → install-local-stack.sh, then onboard.sh (interactive TTY, else --auto)
#   agent  → agentic-setup.sh (pass-through args)
#   doctor → doctor-agentic.sh (pass-through args)
#
# Usage:
#   ./scripts/setup.sh human [VAULT_DIR] [PROFILE] [--no-wizard] [--auto-wizard]
#   ./scripts/setup.sh agent --vault /abs/path/to/vault [--force-env] [--with-systemd] [--with-pi] …
#   ./scripts/setup.sh doctor [--deep] [--write] [--heal] [--no-bun-doctor]
#   ./scripts/setup.sh help
#
# PROFILE (for human): minimal | core | standard | full   (default: core)
# VAULT_DIR default: $HOME/vault
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$REPO_ROOT/scripts"

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
setup.sh — routes to existing installers (see README: Which installer?)

Commands:
  human   Full local stack, then hardware wizard (onboard).
          ./scripts/setup.sh human [VAULT_DIR] [PROFILE] [--no-wizard] [--auto-wizard]
            VAULT_DIR   default: $HOME/vault
            PROFILE     minimal | core | standard | full   (default: core)
            --no-wizard  run install-local-stack only; run ./scripts/onboard.sh yourself
            --auto-wizard  force onboard --auto (also default when stdin is not a TTY)

  agent   Minimal deterministic bootstrap (coding agents, CI-style).
          ./scripts/setup.sh agent --vault /absolute/path/to/vault [options]
            Passes all arguments to scripts/agentic-setup.sh (--force-env, --with-systemd, …)

  doctor  Host checks + bun run doctor.
          ./scripts/setup.sh doctor [options passed to scripts/doctor-agentic.sh]

  help    Show this text

Examples:
  ./scripts/setup.sh human
  ./scripts/setup.sh human /srv/vault standard
  ./scripts/setup.sh agent --vault /srv/vault --force-env --with-systemd
  ./scripts/setup.sh doctor --deep
EOF
}

cmd="${1:-help}"
if [[ "$cmd" == -h || "$cmd" == --help ]]; then
  usage
  exit 0
fi
shift || true # ok when no args (cmd defaults to help)

case "$cmd" in
  human)
    no_wizard=0
    auto_wizard=0
    vault=""
    profile=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --no-wizard)
          no_wizard=1
          shift
          ;;
        --auto-wizard)
          auto_wizard=1
          shift
          ;;
        -h|--help)
          usage
          exit 0
          ;;
        -*)
          die "unknown option for human: $1"
          ;;
        *)
          if [[ -z "$vault" ]]; then
            vault=$1
          elif [[ -z "$profile" ]]; then
            profile=$1
          else
            die "unexpected argument: $1"
          fi
          shift
          ;;
      esac
    done
    v="${vault:-$HOME/vault}"
    p="${profile:-core}"
    echo "[setup] human: install-local-stack → vault=$v profile=$p" >&2
    "$S/install-local-stack.sh" "$v" "$p"
    if (( no_wizard )); then
      echo "[setup] human: --no-wizard — run when ready: ./scripts/onboard.sh   (or: ./scripts/onboard.sh --auto)" >&2
      exit 0
    fi
    if (( auto_wizard )) || ! [ -t 0 ]; then
      echo "[setup] human: onboard (auto)…" >&2
      exec "$S/onboard.sh" --auto
    fi
    echo "[setup] human: onboard (interactive)…" >&2
    exec "$S/onboard.sh"
    ;;

  agent)
    exec "$S/agentic-setup.sh" "$@"
    ;;

  doctor)
    exec "$S/doctor-agentic.sh" "$@"
    ;;

  help)
    usage
    ;;

  *)
    die "unknown command: $cmd — try: $0 help"
    ;;
esac
