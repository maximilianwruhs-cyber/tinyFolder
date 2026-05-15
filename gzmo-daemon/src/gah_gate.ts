/**
 * Gate-as-Halt (GAH) decision — pure logic for tests and search_pipeline.
 */

export interface GahGateInput {
  gahEnabled: boolean;
  hasToolEvidence: boolean;
  evidenceEmpty: boolean;
  bestTop: number;
  gahMinScore: number;
}

export interface GahGateResult {
  halt: boolean;
  reason?: string;
}

export function shouldEvidenceGateHalt(input: GahGateInput): GahGateResult {
  const { gahEnabled, hasToolEvidence, evidenceEmpty, bestTop, gahMinScore } = input;
  if (!gahEnabled || hasToolEvidence) return { halt: false };

  const evidenceWeak = Number.isFinite(gahMinScore) && bestTop < gahMinScore && bestTop > 0;
  if (!evidenceEmpty && !evidenceWeak) return { halt: false };

  const reason = evidenceEmpty
    ? "No relevant evidence found in the vault for this query."
    : `Best evidence score (${bestTop.toFixed(2)}) is below threshold (${gahMinScore}).`;

  return { halt: true, reason };
}

export function buildGahClarification(reason: string): string {
  return [
    reason,
    "",
    "**Suggestions:**",
    "- Rephrase the query with more specific terms",
    "- Add relevant documents to the vault first",
    "- Use `action: think` if vault evidence is not needed",
  ].join("\n");
}
