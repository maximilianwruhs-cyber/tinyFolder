/**
 * Claim Store — append-only belief records across tasks.
 */

import { join } from "path";
import { readFile } from "fs/promises";
import { safeAppendJsonl } from "../vault_fs";

export interface ClaimRecord {
  claim_id: string;
  trace_id: string;
  node_id: string;
  text: string;
  confidence: number;
  sources: string[];
  created_at: string;
  contradicted_by?: string[];
  retracted?: boolean;
  retraction_reason?: string;
}

const CLAIMS_JSONL = "GZMO/Reasoning_Traces/claims.jsonl";

export function beliefsEnabled(): boolean {
  return String(process.env.GZMO_ENABLE_BELIEFS ?? "off").toLowerCase() === "on";
}

export async function recordClaim(
  vaultPath: string,
  claim: Omit<ClaimRecord, "claim_id" | "created_at">,
): Promise<ClaimRecord> {
  const full: ClaimRecord = {
    ...claim,
    claim_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  await safeAppendJsonl(vaultPath, CLAIMS_JSONL, full);
  return full;
}

/** Lightweight contradiction heuristic for telemetry / future UI. */
export function detectContradiction(a: string, b: string): { contradiction: boolean; strength: number } {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const overlapRatio = overlap / Math.max(wordsA.size, wordsB.size);

  const negA = /\b(not|never|no|none|cannot|doesn't|isn't)\b/i.test(a);
  const negB = /\b(not|never|no|none|cannot|doesn't|isn't)\b/i.test(b);
  const oppositePolarity = negA !== negB;

  if (overlapRatio > 0.3 && oppositePolarity) {
    return { contradiction: true, strength: overlapRatio };
  }
  return { contradiction: false, strength: 0 };
}

/** Last N claims from JSONL (best-effort). */
export async function loadRecentClaimTexts(vaultPath: string, maxLines = 40): Promise<string[]> {
  const abs = join(vaultPath, CLAIMS_JSONL);
  const raw = await readFile(abs, "utf-8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean).slice(-maxLines);
  const texts: string[] = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line) as ClaimRecord;
      if (r.text) texts.push(r.text);
    } catch {
      continue;
    }
  }
  return texts;
}
