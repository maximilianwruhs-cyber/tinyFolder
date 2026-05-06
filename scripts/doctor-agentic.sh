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
heal=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deep) deep=1 ;;
    --write) write_mode=1 ;;
    --heal) heal=1 ;;
    --no-bun-doctor) skip_bun_doctor=1 ;;
    -h|--help)
      sed -n '1,80p' "$0"
      exit 0
      ;;
    heal) readonly_flag="--write" ;; # healing may need write mode
  esac

  if (( heal == 1 )); then
    readonly_flag="--write"
    warn "heal mode enabled: bun doctor may write to your vault"
  fi

  say ""
  say "Running: (cd gzmo-daemon && bun run doctor ${readonly_flag} --profile ${profile}${heal:+ --heal})"
  (
    cd "$DAEMON_DIR"
    bun run doctor "$readonly_flag" --profile "$profile"${heal:+ --heal} || ok=0
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

