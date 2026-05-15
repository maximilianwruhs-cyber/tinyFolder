import { join } from "path";
import { readFile } from "fs/promises";
import { atomicWriteJson } from "./vault_fs";
import { readIntEnv } from "./pipelines/helpers";

export const AUTONOMY_BUDGET_REL = "GZMO/.gzmo_autonomy_budget.json";

export type AutonomyBudgetSubsystem = "self_ask" | "dream" | "wiki";

interface BudgetDigest {
  hour_bucket: string;
  counts: Partial<Record<AutonomyBudgetSubsystem, number>>;
}

function hourBucket(d = new Date()): string {
  return d.toISOString().slice(0, 13);
}

export async function readBudgetDigest(vaultPath: string): Promise<BudgetDigest> {
  try {
    const abs = join(vaultPath, AUTONOMY_BUDGET_REL);
    const raw = await readFile(abs, "utf8");
    const parsed = JSON.parse(raw) as Partial<BudgetDigest>;
    const hb = typeof parsed.hour_bucket === "string" ? parsed.hour_bucket : hourBucket();
    const counts =
      parsed.counts && typeof parsed.counts === "object" ? { ...parsed.counts } : {};
    return {
      hour_bucket: hb,
      counts,
    };
  } catch {
    return { hour_bucket: hourBucket(), counts: {} };
  }
}

function budgetLimit(): number {
  return readIntEnv("GZMO_AUTONOMY_OPS_BUDGET_HOUR", 0, 0, 1_000_000);
}

export async function autonomyBudgetAllows(vaultPath: string): Promise<boolean> {
  const cap = budgetLimit();
  if (cap <= 0) return true;
  const d = await readBudgetDigest(vaultPath);
  const hb = hourBucket();
  let total = 0;
  if (d.hour_bucket === hb) {
    for (const n of Object.values(d.counts)) {
      total += typeof n === "number" && Number.isFinite(n) ? n : 0;
    }
  }
  return total < cap;
}

/**
 * Bump subsystem counter after a successful autonomy op for the current UTC hour bucket.
 */
export async function autonomyBudgetConsume(
  vaultPath: string,
  subsystem: AutonomyBudgetSubsystem,
): Promise<void> {
  const cap = budgetLimit();
  if (cap <= 0) return;
  let d = await readBudgetDigest(vaultPath);
  const hb = hourBucket();
  if (d.hour_bucket !== hb) {
    d = { hour_bucket: hb, counts: {} };
  }
  const prev = d.counts[subsystem] ?? 0;
  d.counts[subsystem] = prev + 1;
  await atomicWriteJson(vaultPath, AUTONOMY_BUDGET_REL, d, 2);
}
