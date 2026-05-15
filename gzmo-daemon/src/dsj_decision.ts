/** Pure DSJ threshold helpers (mirrors engine.ts logic for tests). */

export interface DsjScore {
  parseOk: boolean;
  score: number;
}

export function dsjNeedsRewrite(result: DsjScore, threshold: number): boolean {
  return result.parseOk && result.score < threshold;
}

export function dsjRewriteAccepted(reJudge: DsjScore, threshold: number): boolean {
  return reJudge.parseOk && reJudge.score >= threshold;
}
