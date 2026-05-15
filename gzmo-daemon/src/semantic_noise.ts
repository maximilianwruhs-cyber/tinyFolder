/**
 * semantic_noise.ts — tracks drift between intended task framing and model output.
 * Feeds the allostatic cortisol model when semantic noise exceeds budget.
 */

export interface SemanticNoiseState {
  /** Cumulative noise units (0 = aligned). */
  budgetUsed: number;
  /** Max budget before recalibration/teachback is recommended. */
  budgetMax: number;
  lastQueryHash: string;
  lastDriftScore: number;
}

export function defaultSemanticNoiseState(maxBudget = 1.0): SemanticNoiseState {
  return {
    budgetUsed: 0,
    budgetMax: maxBudget,
    lastQueryHash: "",
    lastDriftScore: 0,
  };
}

/** Simple token-overlap drift heuristic (no embedding call). */
export function estimateSemanticDrift(intent: string, output: string): number {
  const a = new Set(intent.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const b = new Set(output.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (a.size === 0 || b.size === 0) return 0.5;
  let overlap = 0;
  for (const w of a) {
    if (b.has(w)) overlap++;
  }
  const jaccard = overlap / (a.size + b.size - overlap);
  return Math.max(0, Math.min(1, 1 - jaccard));
}

export function tickSemanticNoise(
  state: SemanticNoiseState,
  intent: string,
  output: string,
): SemanticNoiseState {
  const drift = estimateSemanticDrift(intent, output);
  const increment = drift * 0.25;
  return {
    ...state,
    budgetUsed: Math.min(state.budgetMax, state.budgetUsed + increment),
    lastDriftScore: drift,
    lastQueryHash: String(intent.length),
  };
}

export function semanticNoiseExceeded(state: SemanticNoiseState): boolean {
  return state.budgetUsed >= state.budgetMax;
}
