#!/usr/bin/env bash
# Install the vendored Pi skill pack into ~/.pi/skills/gzmo-daemon
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/contrib/pi-gzmo-skill"
PI_SKILLS_DIR="${PI_SKILLS_DIR:-$HOME/.pi/skills}"
DST="${PI_SKILLS_DIR%/}/gzmo-daemon"

mkdir -p "$DST/scripts" 2>/dev/null || {
  echo "ERROR: cannot write to PI skills dir: $PI_SKILLS_DIR" >&2
  echo "Hint: set PI_SKILLS_DIR to a writable path (e.g. /home/you/.pi/skills)." >&2
  exit 1
}
cp "$SRC/SKILL.md" "$SRC/README.md" "$DST/"
cp "$SRC/scripts/"*.sh "$DST/scripts/"
chmod +x "$DST/scripts/"*.sh

echo "Installed: $DST" >&2
echo "Next: export GZMO_ENV_FILE=\"$REPO_ROOT/gzmo-daemon/.env\"  (recommended)" >&2

