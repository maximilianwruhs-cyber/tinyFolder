export interface ScoredResult<T> {
  item: T;
  score: number;
}

export interface AdaptiveTopKConfig {
  sensitivity?: number; // higher = more aggressive cutoff
  minResults?: number;
  maxResults?: number;
}

/**
 * Adaptive top-K filtering using elbow detection on a descending score list.
 * Ported from Stoneforge Quarry's search utils (deterministic, cheap).
 */
export function applyAdaptiveTopK<T>(
  results: ScoredResult<T>[],
  config: AdaptiveTopKConfig = {},
): ScoredResult<T>[] {
  const sensitivity = config.sensitivity ?? 1.5;
  const minResults = config.minResults ?? 1;
  const maxResults = config.maxResults ?? 50;

  if (results.length === 0) return [];
  const capped = results.slice(0, maxResults);
  if (capped.length <= 2) return capped;

  const gaps: number[] = [];
  for (let i = 0; i < capped.length - 1; i++) {
    gaps.push(capped[i]!.score - capped[i + 1]!.score);
  }

  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const stddev = Math.sqrt(variance);
  const threshold = mean + sensitivity * stddev;

  let cutoffIndex = capped.length;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i]! > threshold) {
      cutoffIndex = i + 1;
      break;
    }
  }

  cutoffIndex = Math.max(cutoffIndex, Math.min(minResults, capped.length));
  return capped.slice(0, cutoffIndex);
}

