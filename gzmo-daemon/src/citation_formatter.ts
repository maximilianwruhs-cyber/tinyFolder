import type { EvidencePacket } from "./evidence_packet";

export type CitationFormatWarning =
  | "no_snippets"
  | "no_default_citation"
  | "no_changes";

export interface FormatCitationsResult {
  formatted: string;
  changed: boolean;
  warnings: CitationFormatWarning[];
}

function hasAnyCitation(s: string): boolean {
  return /\[E\d+\]/.test(s);
}

function isItemLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("- [ ]") || t.startsWith("- [x]") || t.startsWith("- [X]")) return true;
  if (t.startsWith("- ")) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

function firstDefaultCitationId(packet: EvidencePacket): string | null {
  if (!packet?.snippets?.length) return null;
  // Prefer E1 (local facts) if present.
  const e1 = packet.snippets.find((s) => s.id === "E1");
  return (e1?.id ?? packet.snippets[0]?.id) || null;
}

function addCitationIfMissing(line: string, cite: string): { line: string; changed: boolean } {
  if (/\[E\d+\]/.test(line)) return { line, changed: false };
  // Preserve trailing whitespace minimally (don’t add citations inside code fences etc).
  const trimmedRight = line.replace(/\s+$/, "");
  return { line: `${trimmedRight} [${cite}]`, changed: true };
}

/**
 * Deterministically enforce citation discipline for action: search outputs.
 * - Adds citations to bullet/checklist/numbered item lines.
 * - If no citations exist anywhere, adds one to the first substantive line.
 */
export function formatSearchCitations(answer: string, packet: EvidencePacket): FormatCitationsResult {
  const input = String(answer ?? "");
  const warnings: CitationFormatWarning[] = [];

  const cite = firstDefaultCitationId(packet);
  if (!packet?.snippets?.length) warnings.push("no_snippets");
  if (!cite) {
    warnings.push("no_default_citation");
    return { formatted: input, changed: false, warnings };
  }

  const lines = input.split("\n");
  let changed = false;
  let touchedAnyItem = false;

  const out = lines.map((line) => {
    if (!isItemLine(line)) return line;
    touchedAnyItem = true;
    const res = addCitationIfMissing(line, cite);
    if (res.changed) changed = true;
    return res.line;
  });

  // If there are no citations anywhere, add one to the first substantive line.
  const joined = out.join("\n");
  if (!hasAnyCitation(joined)) {
    for (let i = 0; i < out.length; i++) {
      const cur = out[i] ?? "";
      const t = cur.trim();
      if (!t) continue;
      // Avoid tagging markdown headings; use the first non-heading line.
      if (t.startsWith("#")) continue;
      const res = addCitationIfMissing(cur, cite);
      out[i] = res.line;
      changed = changed || res.changed;
      break;
    }
  }

  if (!changed) warnings.push("no_changes");
  // If there were item lines, we consider that the main target; otherwise only the
  // global "at least one [E#]" rule is enforced.
  // (No extra warning needed; we keep it deterministic and minimal.)
  void touchedAnyItem;

  return { formatted: out.join("\n"), changed, warnings };
}

