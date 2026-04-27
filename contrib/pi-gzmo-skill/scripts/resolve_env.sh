#!/usr/bin/env bash
# Source this file only (do not execute). Loads VAULT_PATH from .env.
# Order: $GZMO_ENV_FILE → existing $VAULT_PATH → walk from $PWD → walk from skill root.
# When walking, prefers ./.env then ./gzmo-daemon/.env at each level.
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "source this file:  source ${BASH_SOURCE[0]}" >&2
  exit 1
fi

if [[ -n "${VAULT_PATH:-}" ]]; then
  return 0
fi

if [[ -n "${GZMO_ENV_FILE:-}" && -f "$GZMO_ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$GZMO_ENV_FILE"
  set +a
  [[ -n "${VAULT_PATH:-}" ]] || { echo "GZMO_ENV_FILE set but VAULT_PATH missing: $GZMO_ENV_FILE" >&2; return 1; }
  return 0
fi

_walk_env() {
  local dir="$1"
  while :; do
    if [[ -f "$dir/.env" ]]; then
      echo "$dir/.env"
      return 0
    fi
    if [[ -f "$dir/gzmo-daemon/.env" ]]; then
      echo "$dir/gzmo-daemon/.env"
      return 0
    fi
    if [[ "$dir" == "/" ]]; then
      return 1
    fi
    dir=$(dirname "$dir")
  done
}

_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_env=""
if _e=$(_walk_env "$(pwd -P)"); then _env="$_e"; fi
if [[ -z "$_env" ]] && _e=$(_walk_env "$_script_dir"); then _env="$_e"; fi

if [[ -z "$_env" ]]; then
  echo "No .env found. Set GZMO_ENV_FILE=/path/to/gzmo-daemon/.env or run from the tinyFolder repo tree." >&2
  return 1
fi

set -a
# shellcheck source=/dev/null
source "$_env"
set +a

if [[ -z "${VAULT_PATH:-}" ]]; then
  echo "VAULT_PATH not set after sourcing: $_env" >&2
  return 1
fi
