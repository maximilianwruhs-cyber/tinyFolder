/**
 * Intermediate verification gates — check quality at each pipeline stage.
 */

import type { SearchResult } from "../search";
import type { EvidencePacket } from "../evidence_packet";

export interface GateResult {
  passed: boolean;
  reason?: string;
  suggestion?: string;
}

export function retrieveGate(
  evidence: SearchResult[],
  minScore = 0.15,
  opts?: { hasToolFacts?: boolean },
): GateResult {
  if (opts?.hasToolFacts) return { passed: true };

  if (evidence.length === 0) {
    return {
      passed: false,
      reason: "No evidence retrieved.",
      suggestion: "Try tools (vault_read, fs_grep) or ask for insufficient evidence.",
    };
  }
  const topScore = evidence[0]?.score ?? 0;
  if (topScore < minScore) {
    return {
      passed: false,
      reason: `Best evidence score too low (${topScore.toFixed(2)} < ${minScore}).`,
      suggestion: "Query may be too specific or vault lacks content. Try broader terms.",
    };
  }
  return { passed: true };
}

export function analyzeGate(subTaskSummaries: string[], originalQuery: string): GateResult {
  if (subTaskSummaries.length === 0) {
    return { passed: false, reason: "No sub-tasks generated.", suggestion: "Re-analyze with broader scope." };
  }
  const queryWords = new Set(
    originalQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4 && !["what", "does", "each", "where", "how"].includes(w)),
  );
  const subTaskText = subTaskSummaries.join(" ").toLowerCase();
  let covered = 0;
  for (const qw of queryWords) {
    if (subTaskText.includes(qw)) covered++;
  }
  const coverage = queryWords.size > 0 ? covered / queryWords.size : 1;
  if (coverage < 0.3) {
    return {
      passed: false,
      reason: `Sub-tasks only cover ${(coverage * 100).toFixed(0)}% of query keywords.`,
      suggestion: "Decomposition may be too narrow or off-topic. Re-analyze.",
    };
  }
  return { passed: true };
}

export function reasonGate(
  claims: Array<{ text: string; sources?: string[] }>,
  packet: EvidencePacket,
): GateResult {
  if (claims.length === 0) return { passed: true };
  const ungrounded = claims.filter((c) => {
    if (!c.sources || c.sources.length === 0) return true;
    return c.sources.some((sid) => !packet.snippets.some((s) => s.id === sid));
  });
  if (ungrounded.length > 0) {
    return {
      passed: false,
      reason: `${ungrounded.length}/${claims.length} claims cite missing or invalid evidence.`,
      suggestion: "Claims must reference evidence IDs present in the Evidence Packet.",
    };
  }
  return { passed: true };
}
