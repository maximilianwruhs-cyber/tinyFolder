import { safeAppendJsonl } from "./vault_fs";

export type HoneypotEdgeStrategy = "gap_detective" | "spaced_repetition";

export type HoneypotEdgeConfidenceBand = "high" | "medium" | "low" | "unknown";

export interface HoneypotEdgeCandidate {
  type: "honeypot_edge_candidate";
  created_at: string; // ISO 8601
  strategy: HoneypotEdgeStrategy;
  from: string; // canonical NodeId (Obsidian title / wikilink target)
  to: string;
  claim: string; // 1 sentence
  evidence_quotes: string[]; // up to 2 verbatim quotes
  evidence_ids: string[]; // e.g. ["E2","E4"]
  confidence: number; // 0..1
  confidence_band: HoneypotEdgeConfidenceBand;
  source_refs: {
    cabinet_file?: string;
    related_files?: string[]; // basenames
  };
}

export const HONEYPOT_EDGES_JSONL = "GZMO/Thought_Cabinet/honeypots/edges.jsonl";

function normNodeId(x: string): string {
  const raw = String(x ?? "").trim();
  if (!raw) return "";
  // Prefer Obsidian wikilink target form (no brackets stored).
  return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
}

function parseConfidenceBand(text: string): HoneypotEdgeConfidenceBand {
  const m = String(text ?? "").match(/\bconfidence\s*:\s*(high|medium|low)\b/i);
  if (!m) return "unknown";
  return m[1]!.toLowerCase() as HoneypotEdgeConfidenceBand;
}

function bandToScore(band: HoneypotEdgeConfidenceBand): number {
  switch (band) {
    case "high": return 0.9;
    case "medium": return 0.6;
    case "low": return 0.35;
    case "unknown": return 0.5;
  }
}

export function extractEdgeCandidate(params: {
  strategy: HoneypotEdgeStrategy;
  output: string;
  relatedFiles: string[];
  cabinetFile?: string;
}): HoneypotEdgeCandidate | null {
  const out = String(params.output ?? "").trim();
  if (!out) return null;
  if (/^no connection found\.?$/i.test(out)) return null;
  if (/^no recent connections\.?$/i.test(out)) return null;

  const from = normNodeId(params.relatedFiles?.[0] ?? "");
  const to = normNodeId(params.relatedFiles?.[1] ?? "");
  if (!from || !to) return null;

  let claim = "";
  const claimMatch = out.match(/^\s*-\s*connection claim\s*\(1 sentence\)\s*:\s*(.+)\s*$/im);
  if (claimMatch?.[1]) claim = claimMatch[1].trim();
  if (!claim) {
    // Fallback: first non-empty line that isn't a heading/bullet label.
    const line = out.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !/^-\s*(shared terms|evidence|confidence)\b/i.test(l));
    claim = (line ?? out).trim();
    if (claim.length > 240) claim = claim.slice(0, 240).trimEnd();
  }

  const quotes: string[] = [];
  const ids: string[] = [];
  const re = /\[E(\d+)\]\s*"([^"]{6,})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) && quotes.length < 2) {
    ids.push(`E${m[1]}`);
    quotes.push(m[2]!.trim());
  }

  const band = parseConfidenceBand(out);
  const confidence = bandToScore(band);

  return {
    type: "honeypot_edge_candidate",
    created_at: new Date().toISOString(),
    strategy: params.strategy,
    from,
    to,
    claim,
    evidence_quotes: quotes,
    evidence_ids: ids,
    confidence,
    confidence_band: band,
    source_refs: {
      cabinet_file: params.cabinetFile,
      related_files: params.relatedFiles,
    },
  };
}

export async function appendEdgeCandidate(vaultPath: string, edge: HoneypotEdgeCandidate): Promise<void> {
  await safeAppendJsonl(vaultPath, HONEYPOT_EDGES_JSONL, edge);
}

