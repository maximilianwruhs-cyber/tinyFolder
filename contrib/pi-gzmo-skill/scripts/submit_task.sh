#!/usr/bin/env bash
# Submit a task to GZMO Inbox. Usage:
#   ./submit_task.sh think "task body"
#   ./submit_task.sh search "task body"
#   ./submit_task.sh chain step2.md "task body"   # chain_next filename in GZMO/Subtasks/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/resolve_env.sh"

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 think|search \"body\"" >&2
  echo "       $0 chain <chain_next.md> \"body\"" >&2
  exit 1
fi

action=$1
shift

if [[ "$action" != "think" && "$action" != "search" && "$action" != "chain" ]]; then
  echo "action must be think, search, or chain (got: $action)" >&2
  exit 1
fi

chain_next=""
if [[ "$action" == "chain" ]]; then
  if [[ $# -lt 2 ]]; then
    echo "Usage: $0 chain <chain_next.md> \"body\"" >&2
    exit 1
  fi
  chain_next=$1
  shift
fi

description=$1
if [[ $# -gt 1 ]]; then
  echo "Extra arguments; wrap the body in quotes." >&2
  exit 1
fi

inbox_dir="$VAULT_PATH/GZMO/Inbox"
mkdir -p "$inbox_dir"

timestamp=$(date +%s)
rand=$(head -c 16 /dev/urandom | tr -dc a-z0-9 | head -c 6)
file="$inbox_dir/${timestamp}_${rand}.md"

if [[ "$action" == "chain" ]]; then
  cat > "$file" <<EOF
---
status: pending
action: chain
chain_next: $chain_next
---
$description
EOF
else
  cat > "$file" <<EOF
---
status: pending
action: $action
---
$description
EOF
fi

echo "$file"
