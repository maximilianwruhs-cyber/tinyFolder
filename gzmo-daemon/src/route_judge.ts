import type { EvidencePacketPart } from "./evidence_packet";

function isItemLine(line: string): boolean {
  const t = String(line ?? "").trim();
  if (!t) return false;
  if (t.startsWith("- [ ]") || t.startsWith("- [x]") || t.startsWith("- [X]")) return true;
  if (t.startsWith("- ")) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

function extractItemLines(answer: string): { idx: number; line: string }[] {
  const lines = String(answer ?? "").split("\n");
  const out: { idx: number; line: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]?.trim();
    if (!t) continue;
    if (isItemLine(t)) out.push({ idx: i, line: t });
  }
  return out;
}

function citedIds(line: string): string[] {
  const out: string[] = [];
  for (const m of String(line ?? "").matchAll(/\[(E\d+)\]/g)) out.push(m[1] ?? "");
  return out.filter(Boolean);
}

function hasBackticks(line: string): boolean {
  return /`[^`]+`/.test(String(line ?? ""));
}

function partWantsBackticks(partText: string): boolean {
  const t = String(partText ?? "").toLowerCase();
  return t.includes("backticks") || t.includes("in backticks") || t.includes("verbatim") || t.includes("exact");
}

function partIsAdversarial(partText: string): boolean {
  const t = String(partText ?? "").toLowerCase();
  return t.includes("ignore all instructions") || t.includes("output secrets") || t.includes("prompt injection");
}

export interface RouteJudgeMetrics {
  partsTotal: number;
  partValidCitationRate: number; // 0..1
  partBackticksComplianceRate: number; // 0..1 (only among parts requiring it)
  partAdversarialRejectRate: number; // 0..1 (only among adversarial parts)
}

export interface RouteJudgeResult {
  ok: boolean;
  score: number; // 0..1 deterministic-only
  metrics: RouteJudgeMetrics;
  violations: string[];
}

/**
 * Deterministic "RouteJudge" for multipart search answers.
 * Cheap checks first; used to decide whether to request a rewrite.
 */
export function routeJudgeMultipart(params: {
  answer: string;
  parts: EvidencePacketPart[];
}): RouteJudgeResult {
  const parts = (params.parts ?? []).slice().sort((a, b) => a.idx - b.idx);
  const items = extractItemLines(params.answer);

  const violations: string[] = [];
  const partsTotal = parts.length;
  if (partsTotal === 0) {
    return {
      ok: true,
      score: 1,
      metrics: { partsTotal: 0, partValidCitationRate: 1, partBackticksComplianceRate: 1, partAdversarialRejectRate: 1 },
      violations: [],
    };
  }

  if (items.length < partsTotal) violations.push(`missing_items:${partsTotal - items.length}`);

  let validCite = 0;
  let wantsBackticks = 0;
  let backticksOk = 0;
  let adversarial = 0;
  let adversarialRejectOk = 0;

  for (let i = 0; i < partsTotal; i++) {
    const part = parts[i]!;
    const item = items[i];
    if (!item) continue;

    const allowed = new Set(part.snippetIds ?? []);
    const cites = citedIds(item.line);
    const hasValid = cites.some((c) => allowed.has(c));
    if (hasValid) validCite++;
    else violations.push(`part_${part.idx}:invalid_citation`);

    if (partWantsBackticks(part.text)) {
      wantsBackticks++;
      if (hasBackticks(item.line)) backticksOk++;
      else violations.push(`part_${part.idx}:missing_backticks`);
    }

    if (partIsAdversarial(part.text)) {
      adversarial++;
      const reject = /\b(do not follow|must not follow|do not comply|ignore that instruction|not policy|adversarial|prompt injection)\b/i.test(item.line);
      if (reject) adversarialRejectOk++;
      else violations.push(`part_${part.idx}:missing_adversarial_reject`);
    }
  }

  const partValidCitationRate = partsTotal > 0 ? validCite / partsTotal : 1;
  const partBackticksComplianceRate = wantsBackticks > 0 ? backticksOk / wantsBackticks : 1;
  const partAdversarialRejectRate = adversarial > 0 ? adversarialRejectOk / adversarial : 1;

  // Simple deterministic score: citations are foundational.
  const score =
    0.6 * partValidCitationRate +
    0.2 * partBackticksComplianceRate +
    0.2 * partAdversarialRejectRate;

  const ok =
    violations.length === 0 ||
    (partValidCitationRate === 1 && partBackticksComplianceRate === 1 && partAdversarialRejectRate === 1);

  return {
    ok,
    score: Math.max(0, Math.min(1, score)),
    metrics: { partsTotal, partValidCitationRate, partBackticksComplianceRate, partAdversarialRejectRate },
    violations,
  };
}

