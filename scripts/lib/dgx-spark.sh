# dgx-spark.sh — Shared DGX Spark / 128 GB unified-memory helpers for installers.
# Source from repo scripts: source "$(dirname "$0")/lib/dgx-spark.sh" (adjust path).

detect_dgx_spark() {
  if command -v nvidia-smi >/dev/null 2>&1; then
    local mib
    mib="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' MiBGB' || true)"
    if [[ -n "${mib:-}" ]] && [[ "${mib:-0}" -gt 100000 ]] 2>/dev/null; then
      return 0
    fi
  fi
  grep -qi grace /proc/cpuinfo 2>/dev/null && return 0
  command -v lspci >/dev/null 2>&1 && lspci 2>/dev/null | grep -qiE 'gb10|blackwell' && return 0
  return 1
}

default_desktop_dropzone_dir() {
  local home="${HOME:-}"
  [[ -n "$home" ]] || { echo "/tmp/GZMO-Dropzone"; return; }
  for desk in "$home/Schreibtisch" "$home/Desktop"; do
    if [[ -d "$desk" || -d "$(dirname "$desk")" ]]; then
      echo "$desk/GZMO-Dropzone"
      return
    fi
  done
  echo "$home/GZMO-Dropzone"
}

pull_spark_default_model() {
  local tag="qwen3.6:35b-a3b-nvfp4"
  if ollama pull "$tag" 2>/dev/null; then
    echo "$tag"
    return 0
  fi
  tag="qwen3.6:35b-a3b"
  ollama pull "$tag" || true
  echo "$tag"
}

# Append document/RAG tuning for Dropzone → search with [E#] citations (see README).
spark_gzmo_env_lines() {
  cat <<'EOF'
GZMO_TOPK=12
GZMO_EVIDENCE_MAX_SNIPPETS=16
GZMO_EVIDENCE_MAX_CHARS=2400
GZMO_LLM_MAX_TOKENS=2048
# Optional stronger embeddings on Spark (pull first): GZMO_EMBED_MODEL="qwen3-embedding:4b"
EOF
}
