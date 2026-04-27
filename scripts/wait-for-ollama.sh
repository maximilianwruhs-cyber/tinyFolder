#!/usr/bin/env bash
# Used by systemd ExecStartPre and by boot-stack.sh. Loads no .env itself;
# systemd sets OLLAMA_URL from EnvironmentFile before running this.
set -euo pipefail

case "${GZMO_SYSTEMD_WAIT_FOR_OLLAMA:-1}" in
  0|false|FALSE|no|NO|off|OFF) exit 0 ;;
esac

URL="${OLLAMA_URL:-http://localhost:11434}"
URL="${URL%/v1}"
MAX_SEC="${GZMO_OLLAMA_WAIT_MAX_SEC:-180}"
interval=2
elapsed=0

while (( elapsed < MAX_SEC )); do
  if curl -sf --connect-timeout 2 "${URL}/api/tags" >/dev/null 2>&1; then
    echo "gzmo-wait-ollama: ready at ${URL}" >&2
    exit 0
  fi
  sleep "$interval"
  elapsed=$((elapsed + interval))
done

echo "gzmo-wait-ollama: timed out after ${MAX_SEC}s (${URL})" >&2
exit 1
