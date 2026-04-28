export interface TrialResult {
  passed: boolean;
  executionTimeMs: number;
  outputSimilarity: number; // 0..1
}

export interface ScoringConfig {
  baselineTimeMs: number;
  baselineEnergyJoules: number;

  minTrialsForVariance?: number;
  varianceFallback?: number;

  minQuality?: number;
  minEfficiency?: number;
  minZScore?: number;
}

export interface FitnessResult {
  zScore: number;
  approved: boolean;
  reason?: string;

  quality: number;
  efficiency: number;
  variancePenalty: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function computeQuality(trials: TrialResult[], config: ScoringConfig): number {
  if (!trials.length) return 0;
  const passRate = trials.filter((t) => t.passed).length / trials.length;
  const successful = trials.filter((t) => t.passed);
  if (!successful.length) return 0;

  const avgTime = mean(successful.map((t) => Math.max(0.001, t.executionTimeMs)));
  const avgSim = mean(successful.map((t) => clamp01(t.outputSimilarity)));

  const timeScore = Math.min(1, config.baselineTimeMs / avgTime);
  const Q = 0.5 * passRate + 0.3 * timeScore + 0.2 * avgSim;
  return Math.round(Q * 10000) / 10000;
}

export function computeEfficiency(energyJoules: number, config: ScoringConfig): number {
  if (!Number.isFinite(energyJoules) || energyJoules <= 0) return 0;
  const E = config.baselineEnergyJoules / energyJoules;
  return Math.round(E * 10000) / 10000;
}

export function computeVariancePenalty(trials: TrialResult[], config: ScoringConfig): number {
  const minTrials = config.minTrialsForVariance ?? 2;
  const fallback = config.varianceFallback ?? 0.3;
  const successful = trials.filter((t) => t.passed).map((t) => clamp01(t.outputSimilarity));
  if (successful.length < minTrials) return fallback;
  const m = mean(successful);
  if (m === 0) return 1;
  const cv = stdev(successful) / m;
  return Math.round(Math.min(1, cv) * 10000) / 10000;
}

export function computeZScore(Q: number, E: number, V: number): number {
  const z = (Q * E) * (1 - V);
  return Math.round(z * 10000) / 10000;
}

export function approveFitness(z: number, Q: number, E: number, config: ScoringConfig): { approved: boolean; reason?: string } {
  const minQ = config.minQuality ?? 0.75;
  const minE = config.minEfficiency ?? 1.01;
  const minZ = config.minZScore ?? 0.7;

  if (Q < minQ) return { approved: false, reason: `low_quality:${Q.toFixed(3)}` };
  if (E < minE) return { approved: false, reason: `no_efficiency_gain:${E.toFixed(3)}` };
  if (z < minZ) return { approved: false, reason: `low_score:${z.toFixed(3)}` };
  return { approved: true };
}

export function evaluateFitness(params: { trials: TrialResult[]; energyJoules: number; config: ScoringConfig }): FitnessResult {
  const Q = computeQuality(params.trials, params.config);
  const E = computeEfficiency(params.energyJoules, params.config);
  const V = computeVariancePenalty(params.trials, params.config);
  const z = computeZScore(Q, E, V);
  const verdict = approveFitness(z, Q, E, params.config);
  return {
    zScore: z,
    approved: verdict.approved,
    reason: verdict.reason,
    quality: Q,
    efficiency: E,
    variancePenalty: V,
  };
}

