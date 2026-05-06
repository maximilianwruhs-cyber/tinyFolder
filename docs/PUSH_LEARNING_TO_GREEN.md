# Push Learning Ledger to Production Green

**Date:** 2026-05-06  
**Component:** Learning Ledger (`strategy_ledger.jsonl`)  
**Goal:** Prove strategy tip injection measurably improves z-score / citation rate vs. control group  
**Duration:** ~2 hours active work + 1–2 days passive task completion  
**Prerequisites:** Daemon runs, Ollama available, ≥1 task completed (any)

---

## Phase 0 — One-Time Setup (10 min)

```bash
cd ~/tinyFolder

# 1. Verify pre-flight
cd gzmo-daemon
bun test && npx tsc --noEmit && bun run eval:quality

# 2. Add A/B test flags to .env
cat >> .env <<'EOF'
GZMO_ENABLE_LEARNING=on
GZMO_LEARNING_AB_TEST=on
EOF

# 3. Confirm flags
grep -E "LEARNING|AB_TEST" .env
# Expected: GZMO_ENABLE_LEARNING=on and GZMO_LEARNING_AB_TEST=on

# 4. Restart daemon
systemctl --user restart gzmo-daemon
# OR foreground:
#   bun run summon
```

---

## Phase 1 — Seed Tasks (10 min setup + wait)

Use the automation script to submit 25 diverse tasks. These cover all 5 task types so the ledger has cross-type data.

```bash
cd ~/tinyFolder
./scripts/push_learning_to_green.sh --seed-tasks
```

This writes 25 files to `GZMO/Inbox/ab_seed_000.md` through `ab_seed_024.md`.

### Required: daemon must be running

If daemon is not running, start it now:

```bash
cd gzmo-daemon && bun run summon
# OR if using systemd:
# systemctl --user start gzmo-daemon
```

### Wait for completion

```bash
# Check how many are still pending
ls ~/tinyFolder/vault/GZMO/Inbox/ab_seed_*.md 2>/dev/null | while read f; do
  grep -q "^status: completed" "$f" || echo "PENDING: $(basename "$f")"
done
```

When all show `status: completed`, you're ready for Phase 2.

**Typical wait time:** 5–15 minutes for 25 simple search tasks (depends on model speed).

---

## Phase 2 — Verify Ledger Population (5 min)

```bash
# Count entries
cat ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl | wc -l
# Expected: ≥ 25 (may include pre-existing entries)

# Verify A/B split
cat ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl | \
  python3 -c "
import json, sys
entries = [json.loads(l) for l in sys.stdin if l.strip()]
inj = sum(1 for e in entries if e.get('strategy_injected') is True)
ctrl = sum(1 for e in entries if e.get('strategy_injected') is False)
print(f'Injected: {inj}  |  Control: {ctrl}  |  Total: {len(entries)}')
print('A/B ratio: {:.1f}% injected'.format(100*inj/len(entries)) if entries else 'No entries')
"
```

**Success criteria:**
- Total ≥ 25 entries
- Injected ≈ 70% (the `Math.random() > 0.3` split)
- Control ≈ 30%

If control count is 0 or 1, the A/B split is not statistically useful. Continue with additional tasks or verify `GZMO_LEARNING_AB_TEST=on` is active.

---

## Phase 3 — Run Statistical Report (5 min)

```bash
cd ~/tinyFolder/gzmo-daemon
bun run ledger:analyze
```

Expected output shape:
```json
{
  "total": 42,
  "perTaskType": {
    "path_query": { "count": 12, "avgZ": 0.78, "bestStyle": "direct_read" },
    "how_to": { "count": 8, "avgZ": 0.65, "bestStyle": "broad_scope" }
  },
  "ab": {
    "injected": { "n": 28, "avgZ": 0.74 },
    "control": { "n": 14, "avgZ": 0.61 }
  },
  "tips": [
    "path_query: best style = \"direct_read\" ..."
  ]
}
```

### Decision Gate 1: Sample Size

| Condition | Action |
|-----------|--------|
| `injected.n < 8` OR `control.n < 8` | **Need more data.** Run more tasks and re-run report. |
| `injected.n ≥ 8` AND `control.n ≥ 8` | Proceed to Gate 2. |

### Decision Gate 2: Quality Delta

| Delta (inj.avgZ − ctrl.avgZ) | Interpretation | Next Step |
|------------------------------|----------------|-----------|
| **≥ +0.10** | Strong improvement ✅ | Proceed to Phase 4 (sign-off) |
| **+0.03 to +0.09** | Modest improvement 🟡 | Accept with note; disable A/B, keep learning on |
| **−0.02 to +0.02** | No effect ⚠️ | Investigate: tips may be stale or task types mismatched |
| **< −0.02** | Degradation 🔴 | **Stop.** Tips are harmful. File a bug. Do NOT sign off. |

---

## Phase 4 — Automated Sign-Off (if gates pass)

```bash
cd ~/tinyFolder
./scripts/push_learning_to_green.sh --report-only
```

This produces:
- Terminal report with delta, percent change, and recommendations
- A sign-off file at `vault/GZMO/learning_ledger_GREEN_SIGNOFF.md`

Example terminal output when successful:
```
╔═══════════════════════════════════════════════════════════╗
║      GZMO LEARNING LEDGER — A/B VALIDATION REPORT       ║
╚═══════════════════════════════════════════════════════════╝

  Total entries:        35
  Injected group:       n=24,  avg z=0.76
  Control group:        n=11,  avg z=0.62

  Delta (inj - ctrl):   +0.14  (↑ BETTER)
  Percent change:       +22.6%

  ✅ Strategy injection shows MEASURABLE QUALITY IMPROVEMENT
```

---

## Phase 5 — Promote to 100% Injection

After sign-off, disable A/B test mode so ALL tasks receive strategy tips:

```bash
# 1. Disable A/B test in .env
sed -i 's/GZMO_LEARNING_AB_TEST=on/GZMO_LEARNING_AB_TEST=off/' ~/tinyFolder/gzmo-daemon/.env

# 2. Verify
head ~/tinyFolder/gzmo-daemon/.env

# 3. Restart daemon
systemctl --user restart gzmo-daemon
```

From now on, every task gets the best available strategy tips for its type. No more 30% control group.

---

## Troubleshooting

### Ledger is empty (0 entries)

```bash
# Check 1: Is learning enabled?
grep GZMO_ENABLE_LEARNING ~/tinyFolder/gzmo-daemon/.env
# Expected: GZMO_ENABLE_LEARNING=on

# Check 2: Is `learningEnabled()` returning true?
# Look at daemon logs for "[ENGINE] Completed:" — learning append happens after output.

# Check 3: Permissions on vault/GZMO/
ls -la ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl
```

### No control group (all entries have `strategy_injected: true`)

The A/B flag may not be active, or `Math.random()` by chance produced all heads. The random split is:
```typescript
const inject = !abTest || Math.random() > 0.3;
// When abTest=true: 70% injected, 30% control
```

Check: `grep GZMO_LEARNING_AB_TEST ~/tinyFolder/gzmo-daemon/.env`

If it is `on` and you still have no controls after 20 tasks, this is statistically unlikely (~0.1%). Restart the daemon to re-read `.env`.

### Delta is negative (tips hurt quality)

Possible causes:
1. **Stale tips**: Old decomposition styles don't match current vault. Tips expire after 200 entries but may still be misleading.
2. **Wrong task type**: `classifyTaskType()` misclassified the query, so tips from unrelated tasks were injected.
3. **Overfitting**: Tips from a small sample (3–5 tasks) may not generalize.

Mitigation:
```bash
# Temporarily disable learning
sed -i 's/GZMO_ENABLE_LEARNING=on/GZMO_ENABLE_LEARNING=off/' gzmo-daemon/.env
systemctl --user restart gzmo-daemon

# File a bug with the ledger content:
head -20 ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl
```

### `bun run ledger:analyze` shows no `ab` field

`ab` is only populated when entries have `strategy_injected` as a boolean (`true` or `false`). If all entries were created before the A/B flag was added, they'll lack this field. 

Fix: The `analyze.ts` only counts entries where `strategy_injected` is explicitly set. Run new tasks with A/B enabled.

---

## Appendix: Manual Verification Commands

```bash
# View last 5 ledger entries
tail -5 ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl | python3 -m json.tool

# Count entries per task type
cat ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl | python3 -c "
import json, sys, collections
c = collections.Counter()
for l in sys.stdin:
    if l.strip(): c[json.loads(l)['task_type']] += 1
for t, n in c.most_common():
    print(f'{t:15s}: {n}')
"

# Check z-score trend over time
cat ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl | python3 -c "
import json, sys
entries = [json.loads(l) for l in sys.stdin if l.strip()]
for e in entries[-10:]:
    inj = 'INJ' if e.get('strategy_injected') else 'CTL'
    print(f'{e[\"timestamp\"][:19]}  {inj}  z={e[\"z_score\"]:.2f}  {e[\"task_type\"]}')
"

# Find best-performing decomposition style per task type
cat ~/tinyFolder/vault/GZMO/strategy_ledger.jsonl | python3 -c "
import json, sys, collections
by_type = collections.defaultdict(lambda: collections.defaultdict(list))
for l in sys.stdin:
    if not l.strip(): continue
    e = json.loads(l)
    by_type[e['task_type']][e['decomposition_style']].append(e['z_score'])
for tt, styles in by_type.items():
    print(f'{tt}:')
    for s, zs in sorted(styles.items(), key=lambda x: -sum(x[1])/len(x[1])):
        avg = sum(zs)/len(zs)
        print(f'  {s:20s}: avg z={avg:.2f}  (n={len(zs)})')
"
```

---

## Sign-Off Checklist

Before declaring Learning Ledger "Production Green":

- [ ] `GZMO_ENABLE_LEARNING=on` in `.env`
- [ ] `GZMO_LEARNING_AB_TEST=on` during validation
- [ ] ≥ 25 tasks completed (seeded or organic)
- [ ] `bun run ledger:analyze` reports `ab.injected.n ≥ 8` and `ab.control.n ≥ 8`
- [ ] Injected avg z-score ≥ control avg z-score (or within 0.02)
- [ ] No task failures caused by tip injection (check daemon logs)
- [ ] `./scripts/push_learning_to_green.sh --report-only` succeeds
- [ ] `learning_ledger_GREEN_SIGNOFF.md` file created in vault
- [ ] A/B test disabled: `GZMO_LEARNING_AB_TEST=off`
- [ ] Daemon restarted with new config

---

*All code changes for this path are already in the repo. No additional implementation needed — only running tasks and reading the report.*
