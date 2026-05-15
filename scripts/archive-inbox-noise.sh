#!/usr/bin/env bash
# archive-inbox-noise.sh — Move stale auto-generated maintenance inbox files to GZMO/Inbox/_archive/
#
# Usage:
#   ./scripts/archive-inbox-noise.sh [--apply] [--vault /abs/path] [--older-than-days N]
#
# Default: dry-run (prints what would move). Use --apply to move files.
#
set -euo pipefail

apply=0
vault="${VAULT_PATH:-}"
older_days="${OLDER_THAN_DAYS:-30}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) apply=1 ;;
    --vault) vault="${2:?}"; shift ;;
    --older-than-days) older_days="${2:?}"; shift ;;
    -h|--help)
      sed -n '1,14p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GZMO_ENV_FILE:-$REPO_ROOT/gzmo-daemon/.env}"

if [[ -z "$vault" ]] && [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" 2>/dev/null && set +a || true
  vault="${VAULT_PATH:-}"
fi

if [[ -z "${vault:?Set VAULT_PATH or pass --vault /abs/path}" ]] || [[ ! -d "$vault/GZMO/Inbox" ]]; then
  echo "ERROR: Inbox missing at $vault/GZMO/Inbox" >&2
  exit 1
fi

INBOX="$vault/GZMO/Inbox"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARCH="$INBOX/_archive/inbox_noise_$STAMP"

pattern='*__maintenance__repair_wiki_consolidation_*'

echo "[archive-inbox-noise] vault=$vault"
echo "[archive-inbox-noise] match=$pattern status=completed|failed mtime>${older_days}d"
[[ "$apply" -eq 1 ]] || echo "[archive-inbox-noise] DRY RUN (pass --apply to move files)"

threshold_sec=$((older_days * 86400))
now=$(date +%s)
count=0

shopt -s nullglob
for f in "$INBOX"/$pattern.md; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f")
  if ! grep -qE '^status: (completed|failed)' "$f" 2>/dev/null; then
    continue
  fi
  mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
  age=$((now - mtime))
  if (( age < threshold_sec )); then
    continue
  fi
  ((count++)) || true
  rel="${base}"
  if [[ "$apply" -eq 1 ]]; then
    mkdir -p "$ARCH"
    mv -v "$f" "$ARCH/$rel"
  else
    echo "  would move: $rel (age $((age / 86400))d)"
  fi
done

echo "[archive-inbox-noise] matched: $count"
if [[ "$apply" -eq 1 ]] && [[ "$count" -gt 0 ]]; then
  echo "[archive-inbox-noise] archive: $ARCH"
fi
