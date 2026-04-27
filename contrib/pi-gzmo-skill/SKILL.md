---
name: gzmo-daemon
description: >-
  GZMO inbox tasks via filesystem. Install from tinyFolder contrib/pi-gzmo-skill
  into ~/.pi/skills/gzmo-daemon (see AGENTS.md).
---

# GZMO daemon (Pi)

**Install** (from a clone of tinyFolder):

```bash
mkdir -p ~/.pi/skills/gzmo-daemon/scripts
REPO=/path/to/tinyFolder
cp "$REPO/contrib/pi-gzmo-skill/SKILL.md" "$REPO/contrib/pi-gzmo-skill/README.md" ~/.pi/skills/gzmo-daemon/
cp "$REPO/contrib/pi-gzmo-skill/scripts/"*.sh ~/.pi/skills/gzmo-daemon/scripts/
chmod +x ~/.pi/skills/gzmo-daemon/scripts/*.sh
```

**Env (pick one):** `export GZMO_ENV_FILE="$REPO/gzmo-daemon/.env"` **or** run with `cwd` anywhere under `$REPO` so `gzmo-daemon/.env` is found.

**Run:**

```bash
f=$(~/.pi/skills/gzmo-daemon/scripts/submit_task.sh think "Your prompt")
~/.pi/skills/gzmo-daemon/scripts/watch_task.sh "$f"
```

**Chain:** `./scripts/submit_task.sh chain step2.md "body"`. Golden task wording: copy from [README golden minimal task](../../README.md#golden-minimal-task-end-to-end-verification).
