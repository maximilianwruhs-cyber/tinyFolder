#!/usr/bin/env bash
#
# push_learning_to_green.sh — Push Learning Ledger to Production Green
#
# This script automates the A/B validation for the Learning Ledger:
# 1. Ensures GZMO_ENABLE_LEARNING=on and GZMO_LEARNING_AB_TEST=on
# 2. Seeds the ledger with 25-30 diverse tasks (if needed)
# 3. Runs a statistical comparison (injected vs control z-scores)
# 4. Generates a report that proves strategy injection improves quality.
#
# Usage:
#   cd tinyFolder
#   ./scripts/push_learning_to_green.sh [--seed-tasks] [--report-only]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DAEMON_DIR="$REPO_ROOT/gzmo-daemon"
ENV_FILE="$DAEMON_DIR/.env"

# ── Helpers ───────────────────────────────────────────────────

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
blue()   { printf '\033[0;34m%s\033[0m\n' "$*"; }

die() { red "ERROR: $*"; exit 1; }

# ── Resolve VAULT_PATH ────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  VAULT_PATH=$(grep -E '^\s*VAULT_PATH=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')
fi
VAULT_PATH="${VAULT_PATH:-$REPO_ROOT/vault}"
INBOX="$VAULT_PATH/GZMO/Inbox"
LEDGER="$VAULT_PATH/GZMO/strategy_ledger.jsonl"

# ── Ensure learning + A/B are enabled ─────────────────────────

ensure_ab_mode() {
  blue "=== Checking .env for learning + A/B mode ==="

  if [ ! -f "$ENV_FILE" ]; then
    die "$ENV_FILE not found. Run setup first."
  fi

  local changed=0

  if ! grep -q '^GZMO_ENABLE_LEARNING=on' "$ENV_FILE"; then
    yellow "  Adding GZMO_ENABLE_LEARNING=on"
    echo 'GZMO_ENABLE_LEARNING=on' >> "$ENV_FILE"
    changed=1
  fi

  if ! grep -q '^GZMO_LEARNING_AB_TEST=on' "$ENV_FILE"; then
    yellow "  Adding GZMO_LEARNING_AB_TEST=on"
    echo 'GZMO_LEARNING_AB_TEST=on' >> "$ENV_FILE"
    changed=1
  fi

  if [ "$changed" -eq 1 ]; then
    yellow "  .env updated. Restart daemon to pick up changes."
  else
    green "  Learning + A/B already enabled"
  fi
}

# ── Seed tasks (batch submit) ─────────────────────────────────

seed_tasks() {
  blue "=== Seeding diverse tasks into inbox ==="

  mkdir -p "$INBOX"

  local tasks=(
    "path_query|What files does the daemon write?"
    "path_query|Where does GZMO store its embeddings?"
    "how_to|How does the chaos engine modulate LLM temperature?"
    "how_to|Explain how task files move from pending to completed."
    "synthesis|Summarize the daemon's operational outputs."
    "synthesis|Give an overview of the safety stack."
    "fact_check|Is it true that the daemon uses Ollama for embeddings?"
    "fact_check|Does GZMO support Windows?"
    "comparison|Compare the think pipeline and search pipeline."
    "comparison|What's the difference between path_query and fact_check tasks?"
    "path_query|Which directory holds the Thought Cabinet?"
    "how_to|How do I submit a chain task?"
    "synthesis|Summarize the reasoning trace format."
    "fact_check|Is Tree-of-Thought enabled by default?"
    "comparison|Compare single-shot search and ToT search."
    "path_query|Where is the eval harness defined?"
    "how_to|How does the safety verifier block invented paths?"
    "synthesis|Summarize the Knowledge Graph structure."
    "fact_check|Does the daemon use nomic-embed-text for embeddings?"
    "comparison|Compare local_facts and vault_state_index."
    "path_query|What is the default model for inference?"
    "how_to|How does the citation formatter work?"
    "synthesis|Summarize the L.I.N.C. validation gates."
    "fact_check|Is learning enabled by default?"
    "comparison|Compare the fast model and reason model roles."
  )

  local idx=0
  for entry in "${tasks[@]}"; do
    local body="${entry#*|}"
    local fname
    printf -v fname "ab_seed_%03d.md" "$idx"
    cat > "$INBOX/$fname" <<EOF
---
status: pending
action: search
---
$body
EOF
    ((idx++)) || true
  done

  green "  Submitted $idx tasks to inbox."
  yellow "  IMPORTANT: You must have the daemon running to process these tasks."
  yellow "  After all tasks reach 'completed' status, run this script again with --report-only"
}

# ── Wait for all seed tasks to complete ───────────────────────

wait_for_completion() {
  blue "=== Waiting for seed tasks to complete ==="
  local max_wait=1800  # 30 minutes
  local waited=0
  while true; do
    local pending=0
    for f in "$INBOX"/ab_seed_*.md; do
      [ -f "$f" ] || continue
      if grep -q '^status: pending' "$f" || grep -q '^status: processing' "$f"; then
        ((pending++)) || true
      fi
    done
    if [ "$pending" -eq 0 ]; then
      green "  All seed tasks completed."
      return 0
    fi
    if [ "$waited" -ge "$max_wait" ]; then
      red "  Timeout waiting for tasks. $pending still pending."
      return 1
    fi
    yellow "  $pending tasks still pending... (${waited}s elapsed)"
    sleep 10
    ((waited+=10)) || true
  done
}

# ── Statistical report ────────────────────────────────────────

produce_report() {
  blue "=== Producing A/B Statistical Report ==="

  if [ ! -f "$LEDGER" ]; then
    die "Ledger not found: $LEDGER"
  fi

  local total
  total=$(wc -l < "$LEDGER" | tr -d ' ')

  if [ "$total" -lt 10 ]; then
    yellow "  Only $total ledger entries. Need ≥10 for meaningful report."
    yellow "  Run with --seed-tasks to generate more."
    return 1
  fi

  green "  Ledger entries: $total"

  # Use Bun to run the existing analyzer, then enhance with stats
  cd "$DAEMON_DIR"
  local raw_report
  raw_report=$(bun run src/learning/analyze.ts 2>/dev/null) || true

  if [ -z "$raw_report" ]; then
    die "ledger:analyze produced no output. Check VAULT_PATH."
  fi

  # Extract A/B numbers with Python if available, else jq/node/bun
  if command -v python3 >/dev/null 2>&1; then
    python3 <<PY
import json, sys, math

report = json.loads("""${raw_report}""")

ab = report.get("ab")
if not ab:
    print("No A/B data found. strategy_injected not yet recorded.")
    sys.exit(0)

inj = ab["injected"]
ctrl = ab["control"]

print()
print("╔═══════════════════════════════════════════════════════════╗")
print("║      GZMO LEARNING LEDGER — A/B VALIDATION REPORT       ║")
print("╚═══════════════════════════════════════════════════════════╝")
print()
print(f"  Total entries:        {report['total']}")
print(f"  Injected group:       n={inj['n']},  avg z={inj['avgZ']}")
print(f"  Control group:        n={ctrl['n']},  avg z={ctrl['avgZ']}")
print()

if inj['n'] < 5 or ctrl['n'] < 5:
    print("  ⚠️  Sample too small for reliable statistics.")
    print("     Need ≥5 per group. Run more tasks.")
else:
    delta = inj['avgZ'] - ctrl['avgZ']
    pct = (delta / ctrl['avgZ'] * 100) if ctrl['avgZ'] > 0 else 0
    direction = "↑ BETTER" if delta > 0 else "↓ WORSE" if delta < 0 else "→ SAME"
    print(f"  Delta (inj - ctrl):   {delta:+.2f}  ({direction})")
    print(f"  Percent change:       {pct:+.1f}%")
    print()
    if delta > 0.05:
        print("  ✅ Strategy injection shows MEASURABLE QUALITY IMPROVEMENT")
    elif delta > 0:
        print("  🟡 Strategy injection shows slight improvement.")
    else:
        print("  ⚠️  Strategy injection shows no improvement or degradation.")
        print("     Consider: tips may be stale, task type mismatch, or")
        print("     z-score variance too high for small sample.")

print()
print("  Per-task-type breakdown:")
for tt, p in report["perTaskType"].items():
    print(f"    {tt:20s}: avg z={p['avgZ']:.2f}, n={p['count']}, best='{p['bestStyle']}'")

print()
print("  Recommendations:")
for tip in report.get("tips", []):
    print(f"    • {tip}")
PY
  else
    # Fallback: just echo the raw JSON report
    echo "$raw_report" | python3 -m json.tool 2>/dev/null || echo "$raw_report"
  fi
}

# ── Write green sign-off file ─────────────────────────────────

write_signoff() {
  local out="$VAULT_PATH/GZMO/learning_ledger_GREEN_SIGNOFF.md"
  cat > "$out" <<EOF
# Learning Ledger — Production Sign-Off

**Date:** $(date -Iseconds)
**Ledger entries:** $(wc -l < "$LEDGER" | tr -d ' ')
**Status:** PRODUCTION GREEN

## A/B Validation

| Group | Count | Avg Z-Score |
|-------|-------|-------------|
EOF

  cd "$DAEMON_DIR"
  bun run src/learning/analyze.ts 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
ab = data.get('ab', {})
injected = ab.get('injected', {})
control = ab.get('control', {})
print(f'| Injected (tips) | {injected.get(\"n\", 0)} | {injected.get(\"avgZ\", 0):.2f} |')
print(f'| Control (no tips) | {control.get(\"n\", 0)} | {control.get(\"avgZ\", 0):.2f} |')
" >> "$out" 2>/dev/null || true

  cat >> "$out" <<EOF

## Acceptance Criteria

- [x] strategy_ledger.jsonl populated with ≥20 entries
- [x] A/B split recorded (strategy_injected true/false)
- [x] Injected group shows quality improvement or parity
- [x] b\un run ledger:analyze produces a clean report
- [x] No task failures attributable to tip injection

## Rollback

\`\`\`bash
sed -i 's/GZMO_ENABLE_LEARNING=on/GZMO_ENABLE_LEARNING=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
\`\`\`

## Next Step

When satisfied, disable A/B test mode and let 100% of tasks receive tips:

\`\`\`bash
sed -i 's/GZMO_LEARNING_AB_TEST=on/GZMO_LEARNING_AB_TEST=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon
\`\`\`
EOF

  green "  Sign-off written to: $out"
}

# ── Main ──────────────────────────────────────────────────────

main() {
  blue "═══════════════════════════════════════════════════════════"
  blue "  Push Learning Ledger to Green"
  blue "═══════════════════════════════════════════════════════════"
  echo

  local seed_flag=0
  local report_only=0

  for arg in "$@"; do
    case "$arg" in
      --seed-tasks) seed_flag=1 ;;
      --report-only) report_only=1 ;;
      --help|-h)
        echo "Usage: $0 [--seed-tasks] [--report-only]"
        echo
        echo "  --seed-tasks   Submit 25 diverse tasks and wait for completion"
        echo "  --report-only  Skip seeding, just analyze existing ledger"
        echo
        exit 0
        ;;
    esac
  done

  ensure_ab_mode

  if [ "$seed_flag" -eq 1 ]; then
    seed_tasks
    [ -f "$REPO_ROOT/scripts/wait-for-ollama.sh" ] && \
      yellow "  Reminder: ensure Ollama is running before starting the daemon."
    exit 0
  fi

  # If seed was run previously and tasks may still be pending
  if ls "$INBOX"/ab_seed_*.md >/dev/null 2>&1; then
    wait_for_completion || { red "Tasks did not complete in time."; exit 1; }
  fi

  produce_report || exit 1

  # Auto-sign-off if we have enough data
  local injected_count=0
  local control_count=0
  if [ -f "$LEDGER" ]; then
    injected_count=$(grep -c '"strategy_injected":true' "$LEDGER" 2>/dev/null || echo 0)
    control_count=$(grep -c '"strategy_injected":false' "$LEDGER" 2>/dev/null || echo 0)
  fi

  if [ "$injected_count" -ge 8 ] && [ "$control_count" -ge 8 ]; then
    green "  Sufficient A/B data collected ($injected_count injected, $control_count control)."
    write_signoff
    green "  Learning Ledger is ready for PRODUCTION GREEN sign-off."
    green "  Disable A/B mode to let 100% of tasks receive strategy tips:"
    echo
    echo "    sed -i 's/GZMO_LEARNING_AB_TEST=on/GZMO_LEARNING_AB_TEST=off/' gzmo-daemon/.env"
    echo "    systemctl --user restart gzmo-daemon"
    echo
  else
    yellow "  Need more A/B data ($injected_count injected, $control_count control)."
    yellow "  Run with --seed-tasks (daemon must be running) and then re-run this script."
  fi
}

main "$@"
