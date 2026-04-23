#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR" && pwd)"
DAEMON_DIR="$REPO_ROOT/gzmo-daemon"
TEMPLATE="$DAEMON_DIR/gzmo-daemon.service.template"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: missing template: $TEMPLATE" >&2
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
elif [[ -x "$HOME/.bun/bin/bun" ]]; then
  BUN_BIN="$HOME/.bun/bin/bun"
else
  echo "ERROR: bun not found. Install Bun first." >&2
  exit 1
fi

OUT_DIR="$HOME/.config/systemd/user"
OUT_FILE="$OUT_DIR/gzmo-daemon.service"
mkdir -p "$OUT_DIR"

sed \
  -e "s|__GZMO_DAEMON_DIR__|$DAEMON_DIR|g" \
  -e "s|__BUN_BIN__|$BUN_BIN|g" \
  "$TEMPLATE" > "$OUT_FILE"

echo "Wrote: $OUT_FILE"
echo ""
echo "Enable + start:"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user enable --now gzmo-daemon"
echo ""
echo "Logs:"
echo "  journalctl --user -u gzmo-daemon -f"

