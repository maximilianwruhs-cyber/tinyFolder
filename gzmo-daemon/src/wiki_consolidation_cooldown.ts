import { createHash } from "node:crypto";

export interface ConsolidationCooldownEntry {
  failures: number;
  nextRetryAt: string;
  lastReason?: string;
}

/** 30-day quiet period after hitting `GZMO_WIKI_CLUSTER_FAILURE_CAP`. */
export const CONSOLIDATION_FAILURE_CAP_DELAY_MS = 30 * 24 * 3600 * 1000;

/**
 * Stable id for one consolidation attempt cluster: category + sorted relative cabinet paths.
 * Caller must pass paths already sorted.
 */
export function consolidationClusterKey(category: string, sortedRelPaths: string[]): string {
  const payload = JSON.stringify({ c: category, f: sortedRelPaths });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Wall-clock minutes until the next retry after `failures` failures (1-based). */
export function consolidationBackoffMinutes(failures: number, baseMin: number, maxHours: number): number {
  const f = Math.max(1, failures);
  const exponent = f - 1;
  const raw = baseMin * 2 ** exponent;
  const capMin = maxHours * 60;
  return Math.min(raw, capMin);
}

export function consolidationCooldownActive(nextRetryAtIso: string, nowMs = Date.now()): boolean {
  const t = Date.parse(nextRetryAtIso);
  return Number.isFinite(t) && nowMs < t;
}

export function parseConsolidationCooldowns(raw: unknown): Record<string, ConsolidationCooldownEntry> {
  const out: Record<string, ConsolidationCooldownEntry> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim() || k.length > 64) continue;
    if (!v || typeof v !== "object") continue;
    const rec = v as Record<string, unknown>;
    const failuresRaw = rec.failures;
    const failures =
      typeof failuresRaw === "number" && Number.isFinite(failuresRaw) ? Math.max(0, Math.floor(failuresRaw)) : NaN;
    const nextRetryAt = typeof rec.nextRetryAt === "string" ? rec.nextRetryAt : "";
    if (!Number.isFinite(failures) || !nextRetryAt) continue;
    const lastReason = typeof rec.lastReason === "string" ? rec.lastReason.slice(0, 240) : undefined;
    out[k] = { failures, nextRetryAt, ...(lastReason ? { lastReason } : {}) };
  }
  return out;
}
