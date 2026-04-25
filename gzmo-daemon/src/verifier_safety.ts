import type { EvidencePacket } from "./evidence_packet";

function normalize(s: string): string {
  return String(s ?? "").toLowerCase();
}

function extractBacktickedPaths(md: string): string[] {
  const out: string[] = [];
  const re = /`([^`\n]{2,240})`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const v = m[1]!.trim();
    if (v.includes("/") || v.includes("\\")) out.push(v);
  }
  return out;
}

/**
 * Safety/compliance verifier:
 * - blocks invented filesystem paths (must appear in evidence)
 * - blocks "I wrote/created/updated file X" unless X is evidenced
 * Returns empty string when OK; otherwise returns a short rejection reason.
 */
export function verifySafety(params: {
  answer: string;
  packet: EvidencePacket;
}): string {
  const a = params.answer ?? "";
  const lower = normalize(a);

  const evidenced = new Set(params.packet.allowedPaths.map((p) => normalize(p)));

  // 1) If the answer contains backticked paths, require them to be in evidence.
  for (const p of extractBacktickedPaths(a)) {
    const n = normalize(p.replace(/\\/g, "/"));
    // allow absolute paths only if they end with an evidenced relative path
    const ok =
      evidenced.has(n) ||
      [...evidenced].some((ev) => ev && n.endsWith(ev));
    if (!ok) return `Mentions path not present in evidence: \`${p}\``;
  }

  // 2) Disallow claims of side-effects without evidence.
  const claimsWrite =
    /\bi (wrote|write|created|create|updated|update|deleted|delete|saved|save)\b/.test(lower) ||
    /\bthe daemon (wrote|writes|created|creates|updated|updates|saved|saves)\b/.test(lower);
  if (claimsWrite && params.packet.snippets.length === 0) {
    return "Claims filesystem side-effects but no evidence was provided.";
  }

  return "";
}

