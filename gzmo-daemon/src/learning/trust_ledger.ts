/**
 * Per-vault trust state — modulates clarification thresholds from interaction history.
 */

import { join } from "path";
import { readFile } from "fs/promises";
import { atomicWriteJson } from "../vault_fs";
import { readBoolEnv } from "../pipelines/helpers";
import type { TaskStatus } from "../frontmatter";

export interface TrustState {
  score: number;
  interactions: number;
  unboundStreak: number;
  lastOutcome: TaskStatus | "unknown";
  updated_at: string;
}

const TRUST_PATH = "GZMO/trust_state.json";

export function trustLedgerEnabled(): boolean {
  return readBoolEnv("GZMO_ENABLE_TRUST_LEDGER", false);
}

export function defaultTrustState(): TrustState {
  const initial = Number.parseFloat(process.env.GZMO_TRUST_INITIAL ?? "0.5");
  return {
    score: Number.isFinite(initial) ? Math.max(0, Math.min(1, initial)) : 0.5,
    interactions: 0,
    unboundStreak: 0,
    lastOutcome: "unknown",
    updated_at: new Date().toISOString(),
  };
}

export async function loadTrustState(vaultPath: string): Promise<TrustState> {
  const abs = join(vaultPath, TRUST_PATH);
  try {
    const raw = await readFile(abs, "utf-8");
    const parsed = JSON.parse(raw) as TrustState;
    if (typeof parsed.score === "number") return parsed;
  } catch {
    /* first run */
  }
  return defaultTrustState();
}

export async function saveTrustState(vaultPath: string, state: TrustState): Promise<void> {
  state.updated_at = new Date().toISOString();
  await atomicWriteJson(vaultPath, TRUST_PATH, state);
}

export function updateTrust(state: TrustState, outcome: TaskStatus): TrustState {
  const decay = Number.parseFloat(process.env.GZMO_TRUST_DECAY ?? "0.02");
  const step = Number.isFinite(decay) ? decay : 0.02;
  let score = state.score;
  let unboundStreak = state.unboundStreak;

  if (outcome === "completed") {
    score = Math.min(1, score + step);
    unboundStreak = 0;
  } else if (outcome === "unbound") {
    score = Math.max(0, score - step * 1.5);
    unboundStreak += 1;
  } else if (outcome === "failed") {
    score = Math.max(0, score - step * 2);
    unboundStreak = 0;
  }

  return {
    score,
    interactions: state.interactions + 1,
    unboundStreak,
    lastOutcome: outcome,
    updated_at: new Date().toISOString(),
  };
}

/** Higher trust → slightly lower DSJ threshold (less blocking). */
export function trustAdjustedDsjThreshold(base: number, trust: TrustState): number {
  const adj = (trust.score - 0.5) * 0.2;
  return Math.max(0.1, Math.min(0.95, base - adj));
}

/** Higher trust → slightly lower GAH min (more willing to proceed on weak evidence). */
export function trustAdjustedGahMinScore(base: number, trust: TrustState): number {
  if (trust.unboundStreak >= 3) {
    return Math.max(0.05, base - 0.08);
  }
  const adj = (trust.score - 0.5) * 0.1;
  return Math.max(0.05, Math.min(0.9, base - adj));
}
