import { describe, expect, test } from "bun:test";
import {
  checkClaimWellFormedness,
  checkEvidenceGrounding,
  checkLogicalConsistency,
  checkConfidenceCalibration,
  validateEdgeCandidate,
  rankEdgeCandidates,
} from "../linc_filter";
import type { HoneypotEdgeCandidate } from "../honeypot_edges";

function makeEdge(overrides: Partial<HoneypotEdgeCandidate> = {}): HoneypotEdgeCandidate {
  return {
    type: "honeypot_edge_candidate",
    created_at: new Date().toISOString(),
    strategy: "gap_detective",
    from: "NodeA",
    to: "NodeB",
    claim: "The embedding store uses cosine similarity to rank search results.",
    evidence_quotes: [
      "cosine similarity measures the angular distance between embedding vectors",
      "search results are ranked by similarity score from the embedding store",
    ],
    evidence_ids: ["E1", "E2"],
    confidence: 0.8,
    confidence_band: "high",
    source_refs: {
      cabinet_file: "test_output.md",
      related_files: ["NodeA", "NodeB"],
    },
    ...overrides,
  };
}

describe("L.I.N.C. Gate 1 — Claim Well-Formedness", () => {
  test("accepts valid claim with SVO structure", () => {
    const result = checkClaimWellFormedness(
      "The embedding store uses cosine similarity to rank search results."
    );
    expect(result.pass).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  test("rejects too-short fragment", () => {
    const result = checkClaimWellFormedness("Cosine sim");
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("claim too short (<15 chars)");
  });

  test("rejects claim without verb", () => {
    const result = checkClaimWellFormedness("The architecture of the system without clear parameters");
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("no recognizable verb"))).toBe(true);
  });

  test("rejects question as claim", () => {
    const result = checkClaimWellFormedness("Does the system use embeddings for search?");
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("question"))).toBe(true);
  });

  test("rejects list format", () => {
    const result = checkClaimWellFormedness("- embeddings are stored in the vault");
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("list format"))).toBe(true);
  });

  test("rejects placeholder text", () => {
    const result = checkClaimWellFormedness("This is a TODO placeholder for the claim.");
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("placeholder"))).toBe(true);
  });

  test("rejects null-signal output", () => {
    const result = checkClaimWellFormedness("No connection found.");
    expect(result.pass).toBe(false);
    expect(result.reasons.some(r => r.includes("null-signal"))).toBe(true);
  });
});

describe("L.I.N.C. Gate 2 — Evidence Grounding", () => {
  test("accepts well-grounded evidence", () => {
    const result = checkEvidenceGrounding(
      "The embedding store uses cosine similarity",
      ["cosine similarity measures the angular distance between embedding vectors"],
      ["E1"]
    );
    expect(result.pass).toBe(true);
    expect(result.groundingScore).toBeGreaterThan(0);
  });

  test("rejects empty evidence", () => {
    const result = checkEvidenceGrounding(
      "The embedding store uses cosine similarity",
      [],
      []
    );
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("no evidence quotes provided");
  });

  test("flags weak grounding", () => {
    const result = checkEvidenceGrounding(
      "The database uses sharding for performance",
      ["Weather patterns indicate climate change trends"],
      ["E1"]
    );
    expect(result.reasons.some(r => r.includes("weak evidence"))).toBe(true);
  });
});

describe("L.I.N.C. Gate 3 — Logical Consistency", () => {
  test("passes with no invariants", () => {
    const result = checkLogicalConsistency(
      "The system uses embeddings for search.",
      []
    );
    expect(result.pass).toBe(true);
  });

  test("detects contradiction with negation", () => {
    const result = checkLogicalConsistency(
      "The system does not use embeddings for search.",
      ["The system uses embeddings for search."]
    );
    expect(result.pass).toBe(false);
    expect(result.conflictingInvariant).toBeTruthy();
  });

  test("detects conflicting quantifiers", () => {
    const result = checkLogicalConsistency(
      "The system always disables the cache on startup.",
      ["The system never disables the cache on startup."]
    );
    expect(result.pass).toBe(false);
  });

  test("passes for unrelated claims", () => {
    const result = checkLogicalConsistency(
      "The UI uses a dark theme by default.",
      ["The database uses PostgreSQL."]
    );
    expect(result.pass).toBe(true);
  });
});

describe("L.I.N.C. Gate 4 — Confidence Calibration", () => {
  test("passes well-calibrated confidence", () => {
    const result = checkConfidenceCalibration(0.7, 2, 0.6, "high");
    expect(result.pass).toBe(true);
    expect(result.adjustedConfidence).toBeUndefined();
  });

  test("flags overconfidence with no evidence", () => {
    const result = checkConfidenceCalibration(0.9, 0, 0, "high");
    expect(result.pass).toBe(false);
    expect(result.adjustedConfidence).toBeDefined();
    expect(result.adjustedConfidence!).toBeLessThan(0.9);
  });

  test("flags overconfidence with weak grounding", () => {
    const result = checkConfidenceCalibration(0.9, 1, 0.1, "high");
    expect(result.pass).toBe(false);
  });
});

describe("L.I.N.C. Composite Validator", () => {
  test("validates well-formed edge", () => {
    const edge = makeEdge();
    const result = validateEdgeCandidate(edge);
    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.claimWellFormed).toBe(true);
  });

  test("rejects edge with no evidence", () => {
    const edge = makeEdge({
      evidence_quotes: [],
      evidence_ids: [],
      confidence: 0.9,
      confidence_band: "high",
    });
    const result = validateEdgeCandidate(edge);
    expect(result.evidenceGrounded).toBe(false);
    expect(result.score).toBeLessThan(1.0);
  });

  test("rejects malformed claim", () => {
    const edge = makeEdge({ claim: "nope" });
    const result = validateEdgeCandidate(edge);
    expect(result.claimWellFormed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  test("rankEdgeCandidates: sorts by score", () => {
    const good = makeEdge();
    const bad = makeEdge({ claim: "x", evidence_quotes: [], evidence_ids: [] });
    const ranked = rankEdgeCandidates([bad, good], []);
    expect(ranked[0]!.edge.claim).toContain("embedding store");
    expect(ranked[0]!.validation.score).toBeGreaterThan(ranked[1]!.validation.score);
  });
});
