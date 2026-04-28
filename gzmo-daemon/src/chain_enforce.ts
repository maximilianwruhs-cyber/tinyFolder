export interface EnforceChainResult {
  out: string;
  changed: boolean;
  violations: string[];
}

export function checkChainChecklist(params: { userPrompt: string; answer: string }): { violations: string[] } {
  const violations: string[] = [];
  const wantN = detectChecklistCount(params.userPrompt);
  const requiredAnchors = detectRequiredAnchors(params.userPrompt);

  const lines = String(params.answer ?? "").split("\n");
  const items = lines.filter(isChecklistLine).map(stripChecklistPrefix).filter(Boolean);

  if (wantN !== null && items.length !== wantN) {
    violations.push(`checklist_count_expected_${wantN}_got_${items.length}`);
  }
  const allText = items.join("\n").toLowerCase();
  for (const a of requiredAnchors) {
    if (!allText.includes(a)) violations.push(`missing_anchor:${a}`);
  }

  return { violations };
}

function isChecklistLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("- [ ]") || t.startsWith("- [x]") || t.startsWith("- [X]");
}

function stripChecklistPrefix(line: string): string {
  return line.trim().replace(/^- \[[ xX]\]\s*/, "");
}

function detectChecklistCount(prompt: string): number | null {
  const m = String(prompt ?? "").match(/\bexactly\s+(\d+)\s+checklist\b/i);
  if (!m) return null;
  const n = Number.parseInt(m[1] ?? "", 10);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return n;
}

function detectRequiredAnchors(prompt: string): string[] {
  const p = String(prompt ?? "").toLowerCase();
  // Heuristic: if user explicitly lists expected anchors, enforce them.
  const anchors: string[] = [];
  for (const a of ["raw/", "wiki/sources/", "wiki/log.md", "wiki/index.md", "gzmo/embeddings.json"]) {
    if (p.includes(a)) anchors.push(a);
  }
  return anchors;
}

export function enforceChainChecklist(params: {
  userPrompt: string;
  answer: string;
}): EnforceChainResult {
  const violations: string[] = [];
  const wantN = detectChecklistCount(params.userPrompt);
  const requiredAnchors = detectRequiredAnchors(params.userPrompt);

  const lines = String(params.answer ?? "").split("\n");
  const items = lines.filter(isChecklistLine).map(stripChecklistPrefix).filter(Boolean);

  if (wantN !== null && items.length !== wantN) {
    violations.push(`checklist_count_expected_${wantN}_got_${items.length}`);
  }

  // Enforce anchors across the whole checklist: each anchor must appear in at least one line.
  const allText = items.join("\n").toLowerCase();
  for (const a of requiredAnchors) {
    if (!allText.includes(a)) violations.push(`missing_anchor:${a}`);
  }

  // Normalize output deterministically if a count was requested.
  let out = params.answer;
  let changed = false;
  if (wantN !== null) {
    const normalized: string[] = [];
    for (let i = 0; i < wantN; i++) {
      const base = items[i];
      if (base) normalized.push(`- [ ] ${base}`);
      else normalized.push(`- [ ] insufficient evidence to provide this checklist item deterministically.`);
    }
    out = normalized.join("\n");
    changed = out.trim() !== String(params.answer ?? "").trim();
  }

  return { out, changed, violations };
}

