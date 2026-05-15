#!/usr/bin/env bash
#
# start-ollama-optimized.sh — Start Ollama with a smaller KV cache.
#
# Uses `q8_0` KV cache and enables flash attention by default. Keeps models
# loaded with `OLLAMA_KEEP_ALIVE=-1` to avoid cold starts.
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

# DGX Spark / >=48 GiB: Ollama defaults to 256k; agents/RAG need at least 64k (see docs.ollama.com/context-length).
# Override down if `ollama ps` shows CPU offload or OOM; override up only when memory headroom is confirmed.
if [[ -z "${OLLAMA_CONTEXT_LENGTH:-}" ]] && command -v nvidia-smi >/dev/null 2>&1; then
  mib="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' MiBGB' || true)"
  if [[ -n "${mib:-}" ]] && [[ "${mib:-0}" -gt 100000 ]] 2>/dev/null; then
    # 128 GB unified (DGX Spark): qwen3.6 nvfp4 ~22 GB weights → ~80+ GB headroom for KV at 256k (see README).
    export OLLAMA_CONTEXT_LENGTH="${OLLAMA_CONTEXT_LENGTH:-262144}"
  fi
fi

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
if [[ -n "${OLLAMA_CONTEXT_LENGTH:-}" ]]; then
  echo "[OLLAMA]   OLLAMA_CONTEXT_LENGTH=${OLLAMA_CONTEXT_LENGTH}"
fi

exec ollama serve "$@"
