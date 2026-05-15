/**
 * judge_score_parser.ts — Pure SCORE/trace parser for shadow judge output.
 *
 * Extracted from shadow_judge.ts to break the import chain
 * shadow_judge → inference_router → inference, which allows test files
 * to import parseJudgeScore without being affected by mock.module()
 * calls that replace the inference module in parallel tests.
 */

export function parseJudgeScore(raw: string): { score: number; trace: string; parseOk: boolean } {
  const text = String(raw ?? "");
  const traceMatch = text.match(/<step-by-step-trace>([\s\S]*?)<\/step-by-step-trace>/i);
  const trace = (traceMatch?.[1] ?? "").trim();

  // Take the LAST SCORE occurrence to avoid being tricked by "SCORE:" strings inside the trace.
  const matches = [...text.matchAll(/SCORE:\s*((?:0|1)(?:\.\d+)?)/gi)];
  const last = matches[matches.length - 1];
  if (!last) return { score: 0, trace, parseOk: false };
  const n = Number.parseFloat(last[1] ?? "");
  if (!Number.isFinite(n)) return { score: 0, trace, parseOk: false };
  const score = Math.max(0, Math.min(1, n));
  return { score, trace, parseOk: true };
}
