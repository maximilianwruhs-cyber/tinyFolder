#!/usr/bin/env bash
#
# install-local-stack.sh — One-shot installer for the tinyFolder + pi local stack.
#
# Performs:
#   - Installs Bun + Ollama if missing.
#   - Pulls models for the requested profile (minimal / core / standard / full).
#   - Scaffolds the vault under $VAULT (default: $HOME/vault).
#   - Writes gzmo-daemon/.env with absolute VAULT_PATH and API/local-only knobs.
#   - Installs daemon dependencies via `bun install`.
#   - Symlinks the pi extension globally for auto-discovery.
#   - Best-effort installs the systemd user service and reloads daemon.
#
# Usage:
#   ./scripts/install-local-stack.sh [VAULT_DIR] [PROFILE]
#     VAULT_DIR  default: $HOME/vault
#     PROFILE    minimal | core | standard | full   (default: core)
#
# This script is idempotent: re-running it overwrites .env and refreshes
# the symlink, but does not re-pull already-present Ollama models.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/dgx-spark.sh
source "$REPO_ROOT/scripts/lib/dgx-spark.sh"
VAULT="${1:-$HOME/vault}"
PROFILE="${2:-core}"

# Force absolute vault path.
case "$VAULT" in
  /*) ;;
  *) VAULT="$(pwd)/$VAULT" ;;
esac

cat <<EOF
═══════════════════════════════════════════════════
  tinyFolder + pi — Local Stack Installer
═══════════════════════════════════════════════════
  Repo:    $REPO_ROOT
  Vault:   $VAULT
  Profile: $PROFILE
═══════════════════════════════════════════════════
EOF

# 1. Bun
if ! command -v bun >/dev/null 2>&1; then
  echo "[1/9] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "[1/9] Bun already installed: $(bun --version)"
fi

# 2. Ollama
if ! command -v ollama >/dev/null 2>&1; then
  echo "[2/9] Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "[2/9] Ollama already installed."
fi

# Ensure Ollama daemon is reachable before we try to pull.
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
echo "[3/9] Probing Ollama at $OLLAMA_URL ..."
if ! curl -sf "${OLLAMA_URL}/api/tags" >/dev/null; then
  echo "       Ollama not reachable. Starting in background..."
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^ollama'; then
    sudo systemctl enable --now ollama || true
  else
    nohup ollama serve >/tmp/ollama.log 2>&1 &
    sleep 3
  fi
fi
if ! curl -sf "${OLLAMA_URL}/api/tags" >/dev/null; then
  echo "       WARNING: Ollama still unreachable. Model pulls will fail." >&2
fi

# 4. Pull models
echo "[4/9] Pulling models for profile=$PROFILE ..."
case "$PROFILE" in
  minimal)
    ollama pull phi3:mini || true
    MODEL="phi3:mini"
    FAST_MODEL=""
    REASON_MODEL=""
    JUDGE_MODEL=""
    ROUTING="off"
    ;;
  core)
    ollama pull hermes3:8b || true
    ollama pull nomic-embed-text || true
    MODEL="hermes3:8b"
    FAST_MODEL=""
    REASON_MODEL=""
    JUDGE_MODEL=""
    ROUTING="off"
    ;;
  standard)
    ollama pull qwen3:32b || true
    ollama pull nomic-embed-text || true
    ollama pull qwen2.5:0.5b || true
    MODEL="qwen3:32b"
    FAST_MODEL="qwen2.5:0.5b"
    REASON_MODEL="qwen3:32b"
    JUDGE_MODEL="qwen3:32b"
    ROUTING="on"
    ;;
  full)
    ollama pull qwen3:32b || true
    ollama pull nomic-embed-text || true
    ollama pull qwen2.5:0.5b || true
    MODEL="qwen3:32b"
    FAST_MODEL="qwen2.5:0.5b"
    REASON_MODEL="qwen3:32b"
    JUDGE_MODEL="qwen3:32b"
    ROUTING="on"
    ;;
  *)
    echo "Unknown profile: $PROFILE" >&2
    echo "Valid profiles: minimal | core | standard | full" >&2
    exit 1
    ;;
esac

SPARK_MODE=0
SPARK_DROPZONE=""
if detect_dgx_spark && [[ "$PROFILE" != "minimal" ]]; then
  SPARK_MODE=1
  echo "       DGX Spark detected — using NVIDIA playbook default (Qwen 3.6 MoE)"
  SPARK_MODEL="$(pull_spark_default_model)"
  MODEL="$SPARK_MODEL"
  REASON_MODEL="$SPARK_MODEL"
  JUDGE_MODEL="${JUDGE_MODEL:-qwen3:32b}"
  if [[ "$PROFILE" == "core" ]]; then
    FAST_MODEL=""
    ROUTING="off"
  else
    ollama pull qwen2.5:0.5b || true
    FAST_MODEL="qwen2.5:0.5b"
    ROUTING="on"
  fi
  ollama pull nomic-embed-text || true
  SPARK_DROPZONE="$(default_desktop_dropzone_dir)"
  mkdir -p "$SPARK_DROPZONE"/{_processed,_failed,files,_tmp}
fi

# 5. Vault scaffold
echo "[5/9] Scaffolding vault at $VAULT ..."
mkdir -p \
  "$VAULT/GZMO/Inbox" \
  "$VAULT/GZMO/Dropzone" \
  "$VAULT/GZMO/Subtasks" \
  "$VAULT/GZMO/Thought_Cabinet" \
  "$VAULT/GZMO/Quarantine" \
  "$VAULT/GZMO/Reasoning_Traces" \
  "$VAULT/wiki" \
  "$VAULT/wiki/incoming"

# 6. .env
echo "[6/9] Writing $REPO_ROOT/gzmo-daemon/.env ..."
cat > "$REPO_ROOT/gzmo-daemon/.env" <<EOF
GZMO_PROFILE=$PROFILE
VAULT_PATH="$VAULT"

OLLAMA_URL="$OLLAMA_URL"
OLLAMA_MODEL="$MODEL"

GZMO_API_ENABLED=1
GZMO_API_HOST="127.0.0.1"
GZMO_API_PORT="12700"
# GZMO_API_SOCKET="/tmp/gzmo.sock"

GZMO_LOCAL_ONLY=1
GZMO_MULTIQUERY=on
GZMO_RERANK_LLM=on
GZMO_ANCHOR_PRIOR=on
GZMO_MIN_RETRIEVAL_SCORE=0.32

GZMO_ENABLE_MODEL_ROUTING=$ROUTING
GZMO_FAST_MODEL="$FAST_MODEL"
GZMO_REASON_MODEL="$REASON_MODEL"
GZMO_JUDGE_MODEL="$JUDGE_MODEL"
EOF

if (( SPARK_MODE == 1 )); then
  {
    echo ""
    echo "# DGX Spark — document / Dropzone RAG (see README)"
    printf 'GZMO_DROPZONE_DIR="%s"\n' "$SPARK_DROPZONE"
    spark_gzmo_env_lines
  } >> "$REPO_ROOT/gzmo-daemon/.env"
fi

# 7. Daemon deps
echo "[7/9] Installing daemon deps ..."
( cd "$REPO_ROOT/gzmo-daemon" && bun install )

# 8. Pi extension symlink (global discovery)
echo "[8/9] Symlinking pi extension ..."
mkdir -p "$HOME/.pi/agent/extensions"
ln -sfn "$REPO_ROOT/.pi/extensions/gzmo-tinyfolder.ts" "$HOME/.pi/agent/extensions/gzmo-tinyfolder.ts"

# 9. systemd user unit (best-effort)
echo "[9/9] Installing systemd user unit (best-effort) ..."
if command -v systemctl >/dev/null 2>&1 && [ -f "$REPO_ROOT/gzmo-daemon/gzmo-daemon.service.template" ]; then
  mkdir -p "$HOME/.config/systemd/user"
  if [ -x "$REPO_ROOT/install_service.sh" ]; then
    ( cd "$REPO_ROOT" && ./install_service.sh ) || true
  else
    cp "$REPO_ROOT/gzmo-daemon/gzmo-daemon.service.template" \
       "$HOME/.config/systemd/user/gzmo-daemon.service" || true
  fi
  systemctl --user daemon-reload 2>/dev/null || true
  echo "       Enable on boot:  systemctl --user enable --now gzmo-daemon"
else
  echo "       Skipped (no systemctl or no service template)."
fi

cat <<EOF

═══════════════════════════════════════════════════
✅ Installation complete!

  Vault:    $VAULT
  Profile:  $PROFILE
  Model:    $MODEL
  API:      http://127.0.0.1:12700  (loopback only)

Start the daemon (foreground):
  cd $REPO_ROOT/gzmo-daemon && bun run summon

Or via systemd (if installed):
  systemctl --user enable --now gzmo-daemon
  journalctl --user -u gzmo-daemon -f

Verify the API is up:
  curl -s http://127.0.0.1:12700/api/v1/health | jq .
═══════════════════════════════════════════════════
EOF
