import type { EvidencePacket } from "./evidence_packet";

export interface SelfAskQualityScore {
  score: number; // 0..100
  citations: { count: number; unique: number };
  noConnection: boolean;
  issues: string[];
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function extractCitations(text: string): string[] {
  const out: string[] = [];
  const re = /\[E(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(`E${m[1]}`);
  return out;
}

export function scoreSelfAskOutput(params: {
  output: string;
  packet?: EvidencePacket;
}): SelfAskQualityScore {
  const raw = String(params.output ?? "").trim();
  const issues: string[] = [];

  const noConnection = /^no connection found\.\s*$/i.test(raw) || /^no recent connections\.\s*$/i.test(raw);
  const cites = extractCitations(raw);
  const unique = uniq(cites);

  let score = 100;

  if (!raw) {
    return { score: 0, citations: { count: 0, unique: 0 }, noConnection: false, issues: ["empty output"] };
  }

  // Prefer explicit citations unless this is a valid "no connection" response.
  if (!noConnection && unique.length === 0) {
    score -= 45;
    issues.push("missing evidence citations [E#]");
  }

  // If citations exist, they should refer to something plausible.
  if (unique.length > 0 && params.packet?.snippets?.length) {
    const allowed = new Set(params.packet.snippets.map((s) => s.id));
    const bad = unique.filter((id) => !allowed.has(id));
    if (bad.length > 0) {
      score -= 25;
      issues.push(`unknown citation ids: ${bad.join(", ")}`);
    }
  }

  // Penalize external evidence hints (we want vault-grounded).
  if (/\b(user_interaction_logs|search_results\.csv|google|web|browser)\b/i.test(raw)) {
    score -= 35;
    issues.push("mentions unsupported external evidence");
  }

  // Reward boundedness: short, slot-like outputs.
  if (raw.length > 1200) {
    score -= 15;
    issues.push("too long (likely drift)");
  }

  // "No connection" is acceptable but lower value.
  if (noConnection) score = Math.min(score, 70);

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    citations: { count: cites.length, unique: unique.length },
    noConnection,
    issues,
  };
}

