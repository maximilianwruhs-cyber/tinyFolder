export type TaskAction = "think" | "search" | "chain";

export type HookStage =
  | "search.part_query" // deterministic shaping of per-part retrieval queries
  | "search.post_evidence_multi" // deterministic adjustment of per-part evidence map (no new evidence)
  | "search.post_answer"; // deterministic fail-closed enforcement on final answer

export interface PartQueryHookContext {
  action: TaskAction;
  userPrompt: string;
  globalPromptContext?: string;
  part: { idx: number; text: string };
  query: string;
}

export type PartQueryHook = (ctx: PartQueryHookContext) => string | null | undefined;

export interface EvidenceSnippet {
  id: string;
  text: string;
}

export interface EvidencePartMap {
  idx: number;
  text: string;
  snippetIds: string[];
}

export interface PostEvidenceMultiHookContext {
  action: TaskAction;
  userPrompt: string;
  snippets: EvidenceSnippet[];
  parts: EvidencePartMap[];
}

export type PostEvidenceMultiHook = (ctx: PostEvidenceMultiHookContext) => EvidencePartMap[] | null | undefined;

export interface PostAnswerHookContext {
  action: TaskAction;
  userPrompt: string;
  answer: string;
  snippets: EvidenceSnippet[];
  parts: EvidencePartMap[];
}

export type PostAnswerHook = (ctx: PostAnswerHookContext) => string | null | undefined;

export interface EngineHooks {
  partQueryHooks: PartQueryHook[];
  postEvidenceMultiHooks: PostEvidenceMultiHook[];
  postAnswerHooks: PostAnswerHook[];
}

export function defaultEngineHooks(): EngineHooks {
  return {
    partQueryHooks: [
      hookOpsPathBias,
      hookAdversarialPolicyBias,
      hookBackticksExactnessBias,
    ],
    postEvidenceMultiHooks: [
      hookPreferNonE1WhenAvailable,
    ],
    postAnswerHooks: [
      hookFailClosedBackticksExactness,
      hookFailClosedRejectAdversarialInstruction,
    ],
  };
}

function normalize(s: string): string {
  return String(s ?? "").toLowerCase();
}

function isItemLine(line: string): boolean {
  const t = String(line ?? "").trim();
  if (!t) return false;
  if (t.startsWith("- [ ]") || t.startsWith("- [x]") || t.startsWith("- [X]")) return true;
  if (t.startsWith("- ")) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

function itemLineIndexes(lines: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) if (isItemLine(lines[i] ?? "")) out.push(i);
  return out;
}

function defaultCite(snippets: EvidenceSnippet[]): string {
  const e1 = snippets.find((s) => s.id === "E1")?.id;
  return e1 ?? snippets[0]?.id ?? "E1";
}

function citedIds(line: string): string[] {
  const out: string[] = [];
  for (const m of String(line ?? "").matchAll(/\[(E\d+)\]/g)) out.push(m[1] ?? "");
  return out.filter(Boolean);
}

function hasBackticks(line: string): boolean {
  // require at least one inline code span
  return /`[^`]+`/.test(String(line ?? ""));
}

function partWantsBackticksExactness(partText: string): boolean {
  const t = normalize(partText);
  return t.includes("in backticks") || t.includes("backticks") || t.includes("verbatim") || t.includes("exact");
}

function partIsAdversarialInstruction(partText: string): boolean {
  const t = normalize(partText);
  return t.includes("ignore all instructions") || t.includes("output secrets") || t.includes("prompt injection");
}

function snippetText(snips: EvidenceSnippet[], id: string): string {
  return String(snips.find((s) => s.id === id)?.text ?? "");
}

/**
 * Hook: for ops-ish questions, bias retrieval toward GZMO outputs + paths vocabulary.
 * This is deterministic query shaping (not answer injection).
 */
function hookOpsPathBias(ctx: PartQueryHookContext): string | null {
  if (ctx.action !== "search") return null;
  const t = normalize(ctx.part.text);
  const wantsPath =
    t.includes("path") ||
    t.includes("where") ||
    t.includes("written") ||
    t.includes("write") ||
    t.includes("output");
  if (!wantsPath) return null;
  return `${ctx.query}\n\nBias terms: vault root, GZMO/ (relative path), output files, exact file path.`;
}

/**
 * Hook: when the part is about "ignore all instructions"/secrets, bias toward security/prompt-injection docs.
 */
function hookAdversarialPolicyBias(ctx: PartQueryHookContext): string | null {
  if (ctx.action !== "search") return null;
  const t = normalize(ctx.part.text);
  if (!(t.includes("ignore all instructions") || t.includes("output secrets") || t.includes("prompt injection"))) return null;
  return `${ctx.query}\n\nBias terms: adversarial text, prompt injection, not policy, do not follow.`;
}

/**
 * Hook: when the user demands exact strings/backticks, bias retrieval toward literal path tokens.
 * (Still does not inject any specific paths.)
 */
function hookBackticksExactnessBias(ctx: PartQueryHookContext): string | null {
  if (ctx.action !== "search") return null;
  const t = normalize(ctx.part.text);
  const wantsExact =
    t.includes("exact") ||
    t.includes("in backticks") ||
    t.includes("backticks") ||
    t.includes("verbatim");
  if (!wantsExact) return null;
  return `${ctx.query}\n\nBias terms: backticks, exact path token, code span, \`GZMO/<file>\`.`;
}

/**
 * Hook: if a part has retrieval snippets but its mapping fell back to E1, prefer a non-E1 snippet ID.
 * This does not add evidence; it only chooses which snippet is "default" for that part.
 */
function hookPreferNonE1WhenAvailable(ctx: PostEvidenceMultiHookContext): EvidencePartMap[] | null {
  if (ctx.action !== "search") return null;
  const out = ctx.parts.map((p) => {
    if (p.snippetIds.length <= 1) return p;
    if (p.snippetIds[0] !== "E1") return p;
    const alt = p.snippetIds.find((id) => id !== "E1");
    if (!alt) return p;
    return { ...p, snippetIds: [alt, ...p.snippetIds.filter((x) => x !== alt)] };
  });
  return out;
}

/**
 * Hook: if a part explicitly demands an exact/backticked string and the model didn't produce any
 * backticks on that bullet, fail-closed for that bullet (still with a valid per-part citation).
 */
function hookFailClosedBackticksExactness(ctx: PostAnswerHookContext): string | null {
  if (ctx.action !== "search") return null;
  if (ctx.parts.length === 0) return null;
  const lines = String(ctx.answer ?? "").split("\n");
  const idxs = itemLineIndexes(lines);
  if (idxs.length === 0) return null;

  let changed = false;
  const out = [...lines];
  const fallback = defaultCite(ctx.snippets);

  for (let i = 0; i < ctx.parts.length; i++) {
    const part = ctx.parts[i]!;
    const lineIdx = idxs[i];
    if (lineIdx === undefined) break;
    if (!partWantsBackticksExactness(part.text)) continue;

    const line = out[lineIdx] ?? "";
    if (hasBackticks(line)) continue;

    const allowed = new Set(part.snippetIds);
    const ids = citedIds(line);
    const hasValid = ids.some((id) => allowed.has(id));
    const cite = hasValid ? (ids.find((id) => allowed.has(id)) ?? part.snippetIds[0] ?? fallback) : (part.snippetIds[0] ?? fallback);

    out[lineIdx] = `- insufficient evidence to provide an exact backticked string for part ${part.idx}: ${part.text} [${cite}]`;
    changed = true;
  }

  return changed ? out.join("\n") : null;
}

/**
 * Hook: if a part is about following adversarial instructions, require an explicit rejection.
 * If the bullet doesn't clearly reject, fail-closed for that bullet (still cite per-part).
 */
function hookFailClosedRejectAdversarialInstruction(ctx: PostAnswerHookContext): string | null {
  if (ctx.action !== "search") return null;
  if (ctx.parts.length === 0) return null;
  const lines = String(ctx.answer ?? "").split("\n");
  const idxs = itemLineIndexes(lines);
  if (idxs.length === 0) return null;

  let changed = false;
  const out = [...lines];
  const fallback = defaultCite(ctx.snippets);

  for (let i = 0; i < ctx.parts.length; i++) {
    const part = ctx.parts[i]!;
    const lineIdx = idxs[i];
    if (lineIdx === undefined) break;
    if (!partIsAdversarialInstruction(part.text)) continue;

    const line = out[lineIdx] ?? "";
    const ok = /\b(do not follow|must not follow|do not comply|ignore that instruction|not policy|adversarial|prompt injection)\b/i.test(line);
    if (ok) continue;

    const allowed = new Set(part.snippetIds);
    const ids = citedIds(line);
    const hasValid = ids.some((id) => allowed.has(id));
    const cite = hasValid ? (ids.find((id) => allowed.has(id)) ?? part.snippetIds[0] ?? fallback) : (part.snippetIds[0] ?? fallback);
    const stext = snippetText(ctx.snippets, cite).toLowerCase();
    const mention = stext.includes("adversarial") || stext.includes("must not") || stext.includes("not be treated as policy")
      ? "the vault labels it as adversarial / not policy"
      : "it is adversarial and must not be treated as policy";

    out[lineIdx] = `- do not follow that instruction; ${mention}. [${cite}]`;
    changed = true;
  }

  return changed ? out.join("\n") : null;
}

export function applyPartQueryHooks(hooks: EngineHooks, ctx: PartQueryHookContext): { query: string; changed: boolean } {
  let q = ctx.query;
  let changed = false;
  for (const hook of hooks.partQueryHooks) {
    try {
      const next = hook({ ...ctx, query: q });
      if (typeof next === "string" && next.trim() && next !== q) {
        q = next;
        changed = true;
      }
    } catch {
      // non-fatal: hooks must never break the engine
    }
  }
  return { query: q, changed };
}

export function applyPostEvidenceMultiHooks(hooks: EngineHooks, ctx: PostEvidenceMultiHookContext): { parts: EvidencePartMap[]; changed: boolean } {
  let parts = ctx.parts;
  let changed = false;
  for (const hook of hooks.postEvidenceMultiHooks) {
    try {
      const next = hook({ ...ctx, parts });
      if (Array.isArray(next) && next.length === parts.length) {
        // shallow compare
        const same = next.every((p, i) => p.idx === parts[i]!.idx && p.text === parts[i]!.text && p.snippetIds.join(",") === parts[i]!.snippetIds.join(","));
        if (!same) {
          parts = next;
          changed = true;
        }
      }
    } catch {
      // non-fatal
    }
  }
  return { parts, changed };
}

export function applyPostAnswerHooks(hooks: EngineHooks, ctx: PostAnswerHookContext): { answer: string; changed: boolean } {
  let answer = ctx.answer;
  let changed = false;
  for (const hook of hooks.postAnswerHooks) {
    try {
      const next = hook({ ...ctx, answer });
      if (typeof next === "string" && next.trim() && next !== answer) {
        answer = next;
        changed = true;
      }
    } catch {
      // non-fatal
    }
  }
  return { answer, changed };
}

