#!/usr/bin/env bash
# One-shot: bring up Ollama (if packaged as systemd service), wait for API, then user gzmo-daemon.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WAIT_SCRIPT="$REPO_ROOT/scripts/wait-for-ollama.sh"

if [[ ! -x "$WAIT_SCRIPT" ]]; then
  chmod +x "$WAIT_SCRIPT" || true
fi

start_ollama() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "gzmo-boot: systemctl not found; start Ollama yourself (e.g. ollama serve)" >&2
    return 0
  fi
  local load
  load="$(systemctl show ollama.service --property=LoadState --value 2>/dev/null || true)"
  if [[ "$load" != "loaded" ]]; then
    echo "gzmo-boot: no ollama.service (install Ollama package or start \`ollama serve\`)" >&2
    return 0
  fi
  if systemctl is-active --quiet ollama 2>/dev/null; then
    echo "gzmo-boot: ollama.service already active" >&2
    return 0
  fi
  echo "gzmo-boot: starting ollama.service…" >&2
  if systemctl start ollama 2>/dev/null; then
    return 0
  fi
  echo "gzmo-boot: systemctl start ollama failed; trying sudo…" >&2
  sudo systemctl start ollama
}

start_ollama

# shellcheck source=/dev/null
if [[ -f "$REPO_ROOT/gzmo-daemon/.env" ]]; then
  set -a
  source "$REPO_ROOT/gzmo-daemon/.env"
  set +a
fi

GZMO_SYSTEMD_WAIT_FOR_OLLAMA=1 "$WAIT_SCRIPT"

if ! systemctl --user is-active gzmo-daemon &>/dev/null; then
  systemctl --user start gzmo-daemon
  echo "gzmo-boot: gzmo-daemon started" >&2
else
  systemctl --user restart gzmo-daemon
  echo "gzmo-boot: gzmo-daemon restarted" >&2
fi

systemctl --user --no-pager status gzmo-daemon || true
