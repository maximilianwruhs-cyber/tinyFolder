/**
 * L.I.N.C. Filter — Logical Inference for Neurosymbolic Knowledge Channeling
 *
 * A post-inference validation layer that applies neurosymbolic principles
 * to decide what information is *worthy* of honeypot promotion. Validates
 * edge candidates against four gates:
 *
 *  1. Claim Well-Formedness — is the claim a proper proposition? (SVO structure)
 *  2. Evidence Grounding    — do cited quotes actually support the claim?
 *  3. Logical Consistency   — does the claim contradict existing invariants?
 *  4. Confidence Calibration — does stated confidence match evidence strength?
 *
 * This is a HYBRID gate:
 *   - Hard gate: score < 0.3 → reject entirely (noise)
 *   - Soft signal: score 0.3–1.0 → linc_score flows into promotion engine
 *
 * This approach maximizes overall output quality by:
 *   - Blocking noise at the source (hard gate for obviously bad edges)
 *   - Providing nuanced signal for borderline cases (soft scoring)
 *   - Letting the promotion engine use L.I.N.C. as one factor among many
 *
 * Sources:
 *   - LINC (EMNLP 2023): semantic parsing → formal verification → majority vote
 *   - Cascading Honeypot Blueprint: multi-pass compilation gates
 *   - CFD: Anchor-Constrained Extraction, Missing Anchor detection
 *   - Reflexion: Forced premise of failure, structured self-critique
 *
 * Env gate: GZMO_LINC_FILTER (default: on), GZMO_HONEYPOT_LINC_MIN (default: 0.5)
 */

import type { HoneypotEdgeCandidate } from "./honeypot_edges";

// ── Types ──────────────────────────────────────────────────────

export interface LincValidation {
  valid: boolean;            // composite pass (score >= 0.3)
  score: number;             // 0..1 composite
  claimWellFormed: boolean;
  evidenceGrounded: boolean;
  logicallyConsistent: boolean;
  confidenceCalibrated: boolean;
  violations: string[];
  adjustedConfidence?: number;  // recalibrated if miscalibrated
}

export interface LincFilterOpts {
  existingInvariants?: string[];  // claims from promoted honeypot nodes
  strictMode?: boolean;           // higher thresholds
}

// ── Gate Weights ──────────────────────────────────────────────
// These weights determine the composite L.I.N.C. score.
// Tuned for maximum output quality: evidence grounding is most
// important (prevents hallucination), followed by well-formedness
// (prevents noise), then logical consistency and calibration.

const GATE_WEIGHTS = {
  claimWellFormed: 0.25,
  evidenceGrounded: 0.35,
  logicallyConsistent: 0.25,
  confidenceCalibrated: 0.15,
} as const;

// ── Gate 1: Claim Well-Formedness ─────────────────────────────

/**
 * Validate that a claim is a proper proposition (Subject-Predicate-Object).
 *
 * From Universal Syntax research: X-bar theory provides a universal
 * template (Specifier-Head-Complement) for phrase structure. A valid
 * claim must follow this pattern to be meaningful.
 *
 * Rejects:
 *   - Fragments (too short, no verb)
 *   - Lists-as-claims (bullet points, numbered items)
 *   - Tautologies ("X is X")
 *   - Pure questions (not assertions)
 *   - Template/placeholder text
 */
export function checkClaimWellFormedness(claim: string): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const trimmed = claim.trim();

  // Length gate: too short = fragment
  if (trimmed.length < 15) {
    reasons.push("claim too short (<15 chars)");
  }

  // Too long = not a single proposition
  if (trimmed.length > 500) {
    reasons.push("claim too long (>500 chars) — not an atomic proposition");
  }

  // Must contain a verb (Subject-Verb-Object structure)
  if (!/\b(?:is|are|was|were|has|have|had|does|do|did|can|could|will|would|shall|should|may|might|must|uses?|enables?|provides?|implements?|creates?|builds?|supports?|connects?|relates?|shares?|shows?|demonstrates?|indicates?|suggests?|involves?|requires?|affects?|influences?|depends?|operates?|functions?|consists?)\b/i.test(trimmed)) {
    reasons.push("no recognizable verb — missing predicate");
  }

  // Reject lists-as-claims
  if (/^[\-\*\d]\s/.test(trimmed) || /^\s*[\-\*]\s/m.test(trimmed)) {
    reasons.push("list format — not a proposition");
  }

  // Reject pure questions
  if (/\?\s*$/.test(trimmed)) {
    reasons.push("question — not an assertion");
  }

  // Reject tautologies: "X is X" patterns
  const tautologyMatch = trimmed.match(/^(.{5,30})\b(?:is|are)\b\s+\1/i);
  if (tautologyMatch) {
    reasons.push("tautology detected");
  }

  // Reject template/placeholder text
  if (/\b(?:lorem ipsum|example|placeholder|TODO|TBD|N\/A)\b/i.test(trimmed)) {
    reasons.push("placeholder text detected");
  }

  // Reject "No connection found" type outputs
  if (/^no (?:connection|information|recent connections?) found\.?$/i.test(trimmed)) {
    reasons.push("null-signal output");
  }

  return { pass: reasons.length === 0, reasons };
}

// ── Gate 2: Evidence Grounding ────────────────────────────────

/**
 * Validate that cited evidence quotes actually support the claim.
 *
 * From CFD research (Anchor-Constrained Extraction):
 * Every claim must correspond to an anchor in the source material.
 * If a concept cannot be mapped to an exact span, it's a "Missing Anchor"
 * and the claim must be rejected.
 *
 * Checks:
 *   - Evidence quotes must exist (non-empty)
 *   - Evidence IDs must be present
 *   - Quotes must share significant vocabulary with the claim
 *   - Claim terms should appear in at least one quote
 */
export function checkEvidenceGrounding(
  claim: string,
  evidenceQuotes: string[],
  evidenceIds: string[],
): { pass: boolean; reasons: string[]; groundingScore: number } {
  const reasons: string[] = [];
  let groundingScore = 0;

  // Must have at least one evidence quote
  if (evidenceQuotes.length === 0) {
    reasons.push("no evidence quotes provided");
    return { pass: false, reasons, groundingScore: 0 };
  }

  // Must have evidence IDs
  if (evidenceIds.length === 0) {
    reasons.push("no evidence IDs provided");
  }

  // Check vocabulary overlap between claim and evidence
  const claimWords = extractContentWords(claim);
  if (claimWords.size === 0) {
    reasons.push("claim has no content words");
    return { pass: false, reasons, groundingScore: 0 };
  }

  let totalOverlap = 0;
  let bestOverlap = 0;

  for (const quote of evidenceQuotes) {
    if (quote.length < 6) {
      reasons.push(`evidence quote too short: "${quote.slice(0, 20)}"`);
      continue;
    }

    const quoteWords = extractContentWords(quote);
    let overlap = 0;
    for (const w of claimWords) {
      if (quoteWords.has(w)) overlap++;
    }

    const ratio = claimWords.size > 0 ? overlap / claimWords.size : 0;
    totalOverlap += ratio;
    if (ratio > bestOverlap) bestOverlap = ratio;
  }

  // Best quote should cover at least 20% of claim content words
  if (bestOverlap < 0.2) {
    reasons.push(`weak evidence grounding: best quote covers ${(bestOverlap * 100).toFixed(0)}% of claim terms`);
  }

  // Compute grounding score: average overlap weighted by quote count
  groundingScore = Math.min(1, (totalOverlap / evidenceQuotes.length) * 2);
  if (evidenceQuotes.length >= 2) groundingScore = Math.min(1, groundingScore * 1.2);

  return { pass: reasons.length === 0, reasons, groundingScore };
}

function extractContentWords(text: string): Set<string> {
  const STOP = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all",
    "can", "had", "her", "was", "one", "our", "out", "has",
    "its", "let", "say", "she", "too", "use", "that", "this",
    "with", "from", "have", "been", "will", "then", "than",
    "also", "does", "into", "they", "each", "which", "their",
    "what", "when", "where", "some", "any", "these", "those",
    "both", "such", "very", "just", "more", "most", "other",
    "only", "same", "being", "about", "over", "after", "before",
  ]);

  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
  );
}

// ── Gate 3: Logical Consistency ───────────────────────────────

/**
 * Check if the claim contradicts any existing honeypot invariants.
 *
 * From Cascading Honeypot Blueprint: the "Gap and Contradiction Pass"
 * is the most critical epistemological gate. If a new fact contradicts
 * an established one, it must be flagged, not blindly integrated.
 *
 * Uses lightweight contradiction detection:
 *   - Same subject + negation detection
 *   - Antonym/opposition pattern matching
 *   - Conflicting quantifiers (all vs. none, always vs. never)
 */
export function checkLogicalConsistency(
  claim: string,
  existingInvariants: string[],
): { pass: boolean; reasons: string[]; conflictingInvariant?: string } {
  const reasons: string[] = [];

  if (existingInvariants.length === 0) {
    return { pass: true, reasons };
  }

  const claimWords = extractContentWords(claim);
  const claimNegated = isNegated(claim);

  for (const invariant of existingInvariants) {
    const invWords = extractContentWords(invariant);
    const invNegated = isNegated(invariant);

    // Check for subject overlap (significant shared vocabulary)
    let overlap = 0;
    for (const w of claimWords) {
      if (invWords.has(w)) overlap++;
    }
    const overlapRatio = Math.min(claimWords.size, invWords.size) > 0
      ? overlap / Math.min(claimWords.size, invWords.size)
      : 0;

    // High subject overlap + opposite polarity = contradiction
    if (overlapRatio >= 0.4) {
      if (claimNegated !== invNegated) {
        reasons.push(`contradicts invariant: "${invariant.slice(0, 80)}..."`);
        return { pass: false, reasons, conflictingInvariant: invariant };
      }

      // Check for conflicting quantifiers
      if (hasConflictingQuantifiers(claim, invariant)) {
        reasons.push(`conflicting quantifiers with: "${invariant.slice(0, 80)}..."`);
        return { pass: false, reasons, conflictingInvariant: invariant };
      }
    }
  }

  return { pass: true, reasons };
}

function isNegated(text: string): boolean {
  return /\b(?:not|never|no|none|neither|nor|cannot|can't|doesn't|don't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|won't|wouldn't|shouldn't|couldn't|mustn't)\b/i.test(text);
}

function hasConflictingQuantifiers(a: string, b: string): boolean {
  const OPPOSING_PAIRS = [
    [/\b(?:all|every|always)\b/i, /\b(?:none|no|never)\b/i],
    [/\b(?:increase|rising|grows?|higher)\b/i, /\b(?:decrease|falling|shrinks?|lower)\b/i],
    [/\b(?:enable|support|allow)\b/i, /\b(?:disable|block|prevent)\b/i],
    [/\b(?:required|mandatory|must)\b/i, /\b(?:optional|unnecessary)\b/i],
  ];

  for (const [patA, patB] of OPPOSING_PAIRS) {
    if ((patA!.test(a) && patB!.test(b)) || (patB!.test(a) && patA!.test(b))) {
      return true;
    }
  }

  return false;
}

// ── Gate 4: Confidence Calibration ────────────────────────────

/**
 * Check if the self-reported confidence matches evidence strength.
 *
 * From Reflexion research: models exhibit pathological overconfidence.
 * Calibration checks ensure confidence scores aren't hallucinated.
 *
 * Expected calibration:
 *   - 2+ evidence quotes with high grounding → high confidence OK
 *   - 1 quote with weak grounding → medium at best
 *   - 0 quotes → low or unknown only
 *   - Miscalibrated confidence → adjusted and flagged
 */
export function checkConfidenceCalibration(
  confidence: number,
  evidenceQuoteCount: number,
  groundingScore: number,
  confidenceBand: string,
): { pass: boolean; reasons: string[]; adjustedConfidence?: number } {
  const reasons: string[] = [];
  let adjusted: number | undefined;

  // Compute expected confidence band based on evidence strength
  const evidenceStrength = (evidenceQuoteCount * 0.3 + groundingScore * 0.7);
  const expectedMax = Math.min(1, evidenceStrength + 0.2);
  const expectedMin = Math.max(0, evidenceStrength - 0.3);

  if (confidence > expectedMax + 0.15) {
    // Overconfident: claiming high confidence with weak evidence
    adjusted = expectedMax;
    reasons.push(
      `overconfident: stated ${confidence.toFixed(2)} but evidence supports max ${expectedMax.toFixed(2)}`
    );
  }

  if (confidence < expectedMin - 0.2 && evidenceQuoteCount >= 2) {
    // Underconfident: good evidence but low confidence (less harmful, just flag)
    reasons.push(
      `underconfident: stated ${confidence.toFixed(2)} but evidence supports min ${expectedMin.toFixed(2)}`
    );
  }

  // Specific band mismatches
  if (confidenceBand === "high" && evidenceQuoteCount === 0) {
    adjusted = 0.35;
    reasons.push("high confidence with zero evidence quotes");
  }

  if (confidenceBand === "high" && groundingScore < 0.3) {
    adjusted = Math.min(confidence, 0.5);
    reasons.push("high confidence with weak evidence grounding");
  }

  return { pass: reasons.length === 0, reasons, adjustedConfidence: adjusted };
}

// ── Composite Validator ───────────────────────────────────────

/**
 * Validate an edge candidate against all four L.I.N.C. gates.
 * Returns a composite score and per-gate results.
 *
 * Hard gate: score < 0.3 → reject (noise, not worth storing)
 * Soft signal: score 0.3+ → linc_score flows into promotion engine
 */
export function validateEdgeCandidate(
  edge: HoneypotEdgeCandidate,
  opts?: LincFilterOpts,
): LincValidation {
  const violations: string[] = [];

  // Gate 1: Claim well-formedness
  const wf = checkClaimWellFormedness(edge.claim);
  if (!wf.pass) violations.push(...wf.reasons);

  // Gate 2: Evidence grounding
  const eg = checkEvidenceGrounding(edge.claim, edge.evidence_quotes, edge.evidence_ids);
  if (!eg.pass) violations.push(...eg.reasons);

  // Gate 3: Logical consistency
  const lc = checkLogicalConsistency(edge.claim, opts?.existingInvariants ?? []);
  if (!lc.pass) violations.push(...lc.reasons);

  // Gate 4: Confidence calibration
  const cc = checkConfidenceCalibration(
    edge.confidence,
    edge.evidence_quotes.length,
    eg.groundingScore,
    edge.confidence_band,
  );
  if (!cc.pass) violations.push(...cc.reasons);

  // Compute composite score
  const score = (
    (wf.pass ? GATE_WEIGHTS.claimWellFormed : 0) +
    (eg.pass ? GATE_WEIGHTS.evidenceGrounded * Math.min(1, eg.groundingScore + 0.3) : 0) +
    (lc.pass ? GATE_WEIGHTS.logicallyConsistent : 0) +
    (cc.pass ? GATE_WEIGHTS.confidenceCalibrated : 0)
  );

  return {
    valid: score >= 0.3,
    score: Math.round(score * 100) / 100,
    claimWellFormed: wf.pass,
    evidenceGrounded: eg.pass,
    logicallyConsistent: lc.pass,
    confidenceCalibrated: cc.pass,
    violations,
    adjustedConfidence: cc.adjustedConfidence,
  };
}

/**
 * Batch validate and rank edge candidates for promotion decisions.
 * Returns sorted by L.I.N.C. score (highest first).
 */
export function rankEdgeCandidates(
  edges: HoneypotEdgeCandidate[],
  invariants: string[],
): Array<{ edge: HoneypotEdgeCandidate; validation: LincValidation }> {
  return edges
    .map(edge => ({
      edge,
      validation: validateEdgeCandidate(edge, { existingInvariants: invariants }),
    }))
    .sort((a, b) => b.validation.score - a.validation.score);
}
