#!/usr/bin/env bash
#
# start-ollama-optimized.sh — Launch Ollama with KV-cache q8_0 + flash attention.
#
# Halves the KV-cache footprint and reduces memory pressure further with flash
# attention. Keep models loaded indefinitely with KEEP_ALIVE=-1 so the daemon
# never pays a cold-start cost.
#
# Usage:
#   ./scripts/start-ollama-optimized.sh                # default: ollama serve
#   ./scripts/start-ollama-optimized.sh --port 11500   # extra args forwarded
#
# To make this the default systemd unit:
#   ExecStart=/abs/path/to/scripts/start-ollama-optimized.sh
#
set -euo pipefail

export OLLAMA_KV_CACHE_TYPE="${OLLAMA_KV_CACHE_TYPE:-q8_0}"
export OLLAMA_FLASH_ATTENTION="${OLLAMA_FLASH_ATTENTION:-1}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:--1}"

# Optional: speculative draft (only when Ollama supports it natively).
# export OLLAMA_DRAFT_MODEL="qwen2.5:0.5b"
# export OLLAMA_DRAFT_NUM_PREDICTIONS=16

# Optional: FP8 toggle for RTX 50-series (Ollama build dependent).
# export OLLAMA_CUDA_FP16=0

if ! command -v ollama >/dev/null 2>&1; then
  echo "[OLLAMA] ollama binary not found in PATH" >&2
  exit 127
fi

echo "[OLLAMA] Starting with:"
echo "[OLLAMA]   OLLAMA_KV_CACHE_TYPE=${OLLAMA_KV_CACHE_TYPE}"
echo "[OLLAMA]   OLLAMA_FLASH_ATTENTION=${OLLAMA_FLASH_ATTENTION}"
echo "[OLLAMA]   OLLAMA_KEEP_ALIVE=${OLLAMA_KEEP_ALIVE}"

exec ollama serve "$@"
