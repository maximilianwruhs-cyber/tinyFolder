/**
 * CLI: bun run src/learning/analyze.ts
 *
 * Reads strategy_ledger.jsonl, aggregates z-scores per task type, prints JSON report.
 */

import { resolve, join } from "path";
import { readFile } from "fs/promises";
import type { StrategyEntry } from "./ledger";

interface LedgerReport {
  total: number;
  perTaskType: Record<string, { count: number; avgZ: number; bestStyle: string }>;
  tips: string[];
}

async function main() {
  const vault = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../../../vault");
  const ledgerPath = join(vault, "GZMO", "strategy_ledger.jsonl");
  const raw = await readFile(ledgerPath, "utf-8").catch(() => "");
  const entries: StrategyEntry[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      entries.push(JSON.parse(line) as StrategyEntry);
    } catch {
      /* skip */
    }
  }

  const perType: LedgerReport["perTaskType"] = {};
  for (const e of entries) {
    const p = perType[e.task_type] ?? { count: 0, avgZ: 0, bestStyle: "" };
    p.count++;
    if (Number.isFinite(e.z_score) && e.z_score > 0) p.avgZ += e.z_score;
    perType[e.task_type] = p;
  }

  for (const [type, p] of Object.entries(perType)) {
    if (p.count > 0) p.avgZ = Math.round((p.avgZ / p.count) * 100) / 100;
    const byStyle = new Map<string, number>();
    for (const e of entries.filter((x) => x.task_type === type)) {
      const cur = byStyle.get(e.decomposition_style) ?? 0;
      byStyle.set(e.decomposition_style, cur + (e.ok ? 1 : -1));
    }
    const best = [...byStyle.entries()].sort((a, b) => b[1] - a[1])[0];
    p.bestStyle = best?.[0] ?? "unknown";
  }

  const report: LedgerReport = {
    total: entries.length,
    perTaskType: perType,
    tips: [],
  };

  for (const [type, p] of Object.entries(perType)) {
    if (p.count < 3) continue;
    report.tips.push(`${type}: best style = "${p.bestStyle}" (avg z=${p.avgZ}, n=${p.count})`);
  }

  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) void main();
