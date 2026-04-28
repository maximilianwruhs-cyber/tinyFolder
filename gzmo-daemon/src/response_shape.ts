import type { EvidencePacket } from "./evidence_packet";

export type RequestedShape =
  | { kind: "bullets_exact"; count: number }
  | { kind: "unknown" };

export type RequiredParts =
  | { kind: "numbered_parts"; parts: { idx: number; text: string; keywords: string[] }[] }
  | { kind: "none" };

export function detectRequestedShape(userPrompt: string): RequestedShape {
  const q = String(userPrompt ?? "");

  // "Answer with exactly 3 bullet points" / "In exactly 5 bullet points"
  const m =
    q.match(/\banswer\s+with\s+exactly\s+(\d+)\s+bullet\s+points?\b/i) ??
    q.match(/\bin\s+exactly\s+(\d+)\s+bullet\s+points?\b/i);
  if (m) {
    const n = Number.parseInt(m[1] ?? "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= 12) return { kind: "bullets_exact", count: n };
  }

  return { kind: "unknown" };
}

function toKeywords(s: string): string[] {
  const t = String(s ?? "")
    .toLowerCase()
    .replace(/[`"'().,:;!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = t.split(" ").filter(Boolean);
  const stop = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "this", "that", "is", "it", "what", "why", "how", "each", "must", "include"]);
  return [...new Set(words.filter((w) => w.length >= 4 && !stop.has(w)).slice(0, 6))];
}

export function detectRequiredParts(userPrompt: string): RequiredParts {
  const lines = String(userPrompt ?? "").split("\n");
  const parts: { idx: number; text: string; keywords: string[] }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\)\s*(.+)\s*$/);
    if (!m) continue;
    const idx = Number.parseInt(m[1] ?? "", 10);
    const text = (m[2] ?? "").trim();
    if (!Number.isFinite(idx) || idx < 1 || idx > 12) continue;
    if (!text) continue;
    parts.push({ idx, text, keywords: toKeywords(text) });
  }
  if (parts.length >= 2) return { kind: "numbered_parts", parts };
  return { kind: "none" };
}

function defaultCite(packet: EvidencePacket | undefined): string {
  const id = packet?.snippets?.[0]?.id;
  return id && /^E\d+$/.test(id) ? id : "E1";
}

export function shapePreservingFailClosed(params: {
  userPrompt: string;
  packet?: EvidencePacket;
  lead: string;
  detailLines: string[];
}): string {
  const cite = defaultCite(params.packet);
  const shape = detectRequestedShape(params.userPrompt);

  if (shape.kind === "bullets_exact") {
    const bullets: string[] = [];
    const lines = [
      params.lead,
      ...params.detailLines,
    ].filter(Boolean);

    // Fill bullets deterministically, truncating or padding as needed.
    for (let i = 0; i < shape.count; i++) {
      const base = lines[i] ?? lines[lines.length - 1] ?? params.lead;
      bullets.push(`- ${base} [${cite}]`);
    }
    return bullets.join("\n");
  }

  // Default: preserve previous behavior, but ensure at least one citation exists.
  const body = [params.lead, "", ...params.detailLines].join("\n").trim();
  return /\[E\d+\]/.test(body) ? body : `${body}\n\n[${cite}]`;
}

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

export function enforceExactBulletCount(params: {
  userPrompt: string;
  packet?: EvidencePacket;
  answer: string;
}): string {
  const shape = detectRequestedShape(params.userPrompt);
  if (shape.kind !== "bullets_exact") return params.answer;
  const cite = defaultCite(params.packet);

  const lines = String(params.answer ?? "").split("\n");
  const items = lines.filter(isItemLine).map(stripItemPrefix).filter(Boolean);

  const out: string[] = [];
  for (let i = 0; i < shape.count; i++) {
    const base = items[i];
    if (base) out.push(`- ${base} [${cite}]`);
    else out.push(`- insufficient evidence to provide this item deterministically. [${cite}]`);
  }
  return out.join("\n");
}

export function enforceRequiredPartsCoverage(params: {
  userPrompt: string;
  packet?: EvidencePacket;
  answer: string;
}): { out: string; missing: number; applied: boolean } {
  const req = detectRequiredParts(params.userPrompt);
  if (req.kind !== "numbered_parts") return { out: params.answer, missing: 0, applied: false };
  const cite = defaultCite(params.packet);

  const rawLines = String(params.answer ?? "").split("\n");
  const itemLines = rawLines.filter(isItemLine).map((l) => l.trim()).filter(Boolean);

  const mapped: string[] = [];
  let missing = 0;

  // Positional mapping: one bullet line per numbered part, in order.
  // This avoids brittle keyword matching while still enforcing coverage + shape.
  for (let i = 0; i < req.parts.length; i++) {
    const part = req.parts[i]!;
    const line = itemLines[i];
    if (line) {
      const base = stripItemPrefix(line);
      const low = base.toLowerCase();
      const ok = part.keywords.length === 0 ? true : part.keywords.some((k) => low.includes(k));
      if (ok) {
        mapped.push(`- ${base} [${cite}]`);
      } else {
        missing++;
        mapped.push(`- insufficient evidence to answer part ${part.idx} deterministically: ${part.text} [${cite}]`);
      }
    } else {
      missing++;
      mapped.push(`- insufficient evidence to answer part ${part.idx} deterministically: ${part.text} [${cite}]`);
    }
  }

  return { out: mapped.join("\n"), missing, applied: true };
}

export function enforceOneSentencePerBullet(answer: string): string {
  const lines = String(answer ?? "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (!isItemLine(line)) {
      out.push(line);
      continue;
    }
    const t = stripItemPrefix(line);
    // Keep only first sentence boundary to enforce "one sentence per bullet".
    const m = t.match(/^(.+?[.!?])(\s|$)/);
    const one = (m?.[1] ?? t).trim();
    // Re-add as bullet (no citations here; think/chain doesn't require them).
    out.push(`- ${one}`);
  }
  return out.join("\n");
}

