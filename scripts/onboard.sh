#!/usr/bin/env bash
# GZMO Onboard — hardware-aware setup wizard wrapper
# Delegates to the TypeScript wizard inside gzmo-daemon/tools/
# Model tiers: README.md → Recommended models (nvfp4 / qwen3.6:35b-a3b / hermes3:8b).
#
# Usage:
#   ./scripts/onboard.sh              # interactive
#   ./scripts/onboard.sh --auto       # non-interactive, best-fit model
#   ./scripts/onboard.sh --model hermes3:8b --auto
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIZARD="$REPO_ROOT/gzmo-daemon/tools/setup-wizard.ts"

if [[ ! -f "$WIZARD" ]]; then
  echo "ERROR: wizard not found: $WIZARD" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1 && [[ ! -x "$HOME/.bun/bin/bun" ]]; then
  echo "ERROR: bun not found. Install Bun first: https://bun.sh" >&2
  exit 1
fi

cd "$REPO_ROOT/gzmo-daemon"
exec bun run "$WIZARD" "$@"
