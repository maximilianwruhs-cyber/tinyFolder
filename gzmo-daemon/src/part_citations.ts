import type { EvidencePacket, EvidencePacketPart } from "./evidence_packet";

function isItemLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("- [ ]") || t.startsWith("- [x]") || t.startsWith("- [X]")) return true;
  if (t.startsWith("- ")) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

function stripItemPrefix(line: string): string {
  const t = line.trim();
  if (t.startsWith("- [ ]") || t.startsWith("- [x]") || t.startsWith("- [X]")) return t.replace(/^- \[[ xX]\]\s*/, "");
  if (t.startsWith("- ")) return t.replace(/^- \s*/, "");
  if (/^\d+\.\s+/.test(t)) return t.replace(/^\d+\.\s+/, "");
  return t;
}

function extractCitationIds(line: string): string[] {
  const out: string[] = [];
  for (const m of String(line ?? "").matchAll(/\[(E\d+)\]/g)) out.push(m[1] ?? "");
  return out.filter(Boolean);
}

function defaultCite(packet: EvidencePacket): string {
  const e1 = packet.snippets.find((s) => s.id === "E1")?.id;
  return e1 ?? packet.snippets[0]?.id ?? "E1";
}

function dropCitations(s: string): string {
  return String(s ?? "").replace(/\s*\[E\d+\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * For numbered prompts, enforce that bullet i cites evidence IDs intended for part i.
 * If a bullet cites only IDs from other parts, it is rewritten to cite the part’s default ID.
 * If a part has no snippet IDs, fail-closed for that part.
 */
export function enforcePerPartCitations(params: {
  answer: string;
  packet: EvidencePacket;
  parts: EvidencePacketPart[];
}): { out: string; changed: boolean } {
  const parts = (params.parts ?? []).slice().sort((a, b) => a.idx - b.idx);
  if (parts.length === 0) return { out: params.answer, changed: false };

  const citeFallback = defaultCite(params.packet);
  const lines = String(params.answer ?? "").split("\n");

  const itemIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) if (isItemLine(lines[i] ?? "")) itemIdxs.push(i);

  // If there are no items, we can't map parts; leave unchanged.
  if (itemIdxs.length === 0) return { out: params.answer, changed: false };

  let changed = false;
  const out = [...lines];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lineIndex = itemIdxs[i];
    if (lineIndex === undefined) break;

    const allowed = new Set(part.snippetIds);
    const line = out[lineIndex] ?? "";
    const base = stripItemPrefix(line);

    if (allowed.size === 0) {
      out[lineIndex] = `- insufficient evidence to answer part ${part.idx} deterministically: ${part.text} [${citeFallback}]`;
      changed = true;
      continue;
    }

    const cites = extractCitationIds(line);
    const ok = cites.some((c) => allowed.has(c));
    if (ok) continue;

    const replacement = part.snippetIds[0] ?? citeFallback;
    out[lineIndex] = `- ${dropCitations(base)} [${replacement}]`;
    changed = true;
  }

  return { out: out.join("\n"), changed };
}

