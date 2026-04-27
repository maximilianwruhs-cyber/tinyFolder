#!/bin/bash
#
# Ubuntu Linux only: rsync layout assumes a typical /media/$USER mount and
# Ollama model paths under /usr/share/ollama. Adjust if your distro differs.
#
# Usage: ./deploy_to_stick.sh [/path/to/mountpoint]
# Deploys this repo + sibling vault snapshot to a USB stick for offline use on Linux hosts.

# Default stick path (updates automatically to current user)
STICK="${1:-/media/$USER/GZMO1}"

# Resolve paths dynamically to protect privacy and enable portability
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
EDGE_NODE_DIR="$(dirname "$SCRIPT_DIR")"
VAULT_DIR="$(dirname "$EDGE_NODE_DIR")/Obsidian_Vault"

echo "==========================================="
echo " 👻 Deploying tinyFolder to USB Stick"
echo "==========================================="

if [ ! -d "$STICK" ]; then
    echo "ERROR: USB stick not found at $STICK"
    echo "Usage: ./deploy_to_stick.sh /path/to/usb/drive"
    exit 1
fi

echo "1. Syncing tinyFolder OS Core (excluding node_modules)..."
rsync -av --delete --exclude "node_modules" \
      --exclude ".git" \
      "$EDGE_NODE_DIR/" \
      "$STICK/edge-node/"

echo ""
echo "2. Syncing Obsidian Vault (Memory)..."
rsync -av --delete "$VAULT_DIR/" \
      "$STICK/Obsidian_Vault/"

echo ""
echo "3. Syncing Ollama Models (Hermes3 & Nomic)..."
# Offline bundle: run with OLLAMA_MODELS pointing at this directory on the target Linux host.
rsync -av --delete /usr/share/ollama/.ollama/models/ \
      "$STICK/ollama_models/"

echo ""
echo "==========================================="
echo " DEPLOYMENT COMPLETE! 🚀"
echo "==========================================="
echo "To run from the stick on a new machine:"
echo "1. cd /path/to/stick"
echo "2. export OLLAMA_MODELS=\"\$PWD/ollama_models\""
echo "3. ollama serve &"
echo "4. cd edge-node/gzmo-daemon"
echo "5. bun run summon"
