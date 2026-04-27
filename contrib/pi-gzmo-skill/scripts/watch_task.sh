#!/usr/bin/env bash
# Poll task file until status is completed or failed; print file. Optional timeout.
# Usage: ./watch_task.sh <path-to-task.md> [max_seconds]

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <task-file> [max_seconds]" >&2
  exit 1
fi

task_file=$1
max_sec=${2:-600}
elapsed=0

if [[ ! -f "$task_file" ]]; then
  echo "Error: file not found: $task_file" >&2
  exit 1
fi

_read_status() {
  awk '
    /^---$/ { if (in_fm) { exit }; in_fm=1; next }
    in_fm && /^status:/ { sub(/^status:[[:space:]]*/, ""); gsub(/["'\'']/, ""); print; exit }
  ' "$task_file" 2>/dev/null | tr -d '\r'
}

while (( elapsed < max_sec )); do
  status=$(_read_status)
  if [[ "$status" == "completed" || "$status" == "failed" ]]; then
    cat "$task_file"
    exit 0
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

echo "Timeout after ${max_sec}s waiting for completed|failed (last status: ${status:-pending})" >&2
exit 1
