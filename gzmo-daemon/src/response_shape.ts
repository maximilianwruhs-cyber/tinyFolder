import type { EvidencePacket } from "./evidence_packet";

export type RequestedShape =
  | { kind: "bullets_exact"; count: number }
  | { kind: "unknown" };

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

