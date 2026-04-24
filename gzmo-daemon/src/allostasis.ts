/**
 * allostasis.ts — Computational Allostatic Stress System
 *
 * Prevents the "dark room problem" where the chaos engine sedates
 * itself into permanent dormancy through unchecked crystallization.
 *
 * Based on the Cognitive Drive Architecture (CDA):
 *   Drive = (Primode^CAP × Flexion) / (Anchory + Grain) + Slip
 *
 * When tension_bias saturates and no tasks arrive, cortisol rises.
 * Cortisol upregulates Anchory (feedback stabilization) to prevent
 * complete drive collapse. It does NOT generate fake tension —
 * it ensures the system can RESPOND when real signals arrive.
 *
 * Source: Sedation Paradox notebook (NotebookLM)
 */

export interface CortisolState {
  level: number;          // 0.0–1.0 simulated cortisol concentration
  setPoint: number;       // dynamic energy target (0.5–0.9)
  lastTaskTime: number;   // Unix ms of last real task event
  anchoryBoost: number;   // current boost to feedback stabilization
}

export function defaultCortisolState(): CortisolState {
  return {
    level: 0.0,
    setPoint: 0.7,
    lastTaskTime: Date.now(),
    anchoryBoost: 0.0,
  };
}

/**
 * Allostatic regulator — called every PulseLoop tick.
 *
 * Rules (anti-inbreeding):
 * - Cortisol ONLY rises when: bias saturated AND idle for 30+ min
 * - Cortisol does NOT inject fake tension or fake thoughts
 * - Cortisol DOES soften bias impact so real tasks can wake the engine
 * - When a real task arrives, cortisol resets immediately
 */
export function tickCortisol(
  state: CortisolState,
  tensionBias: number,
  hasRecentTask: boolean,
  tickInterval: number, // ms between ticks
): CortisolState {
  const now = Date.now();
  const idleMinutes = (now - state.lastTaskTime) / 60_000;
  const biasSaturated = tensionBias <= -20;

  // Reset on real task
  if (hasRecentTask) {
    return {
      level: Math.max(0, state.level - 0.3), // rapid decay on task
      setPoint: 0.7,
      lastTaskTime: now,
      anchoryBoost: 0.0,
    };
  }

  // Cortisol rises when: bias saturated + idle > 30 min
  if (biasSaturated && idleMinutes > 30) {
    const riseRate = 0.001 * (tickInterval / 345); // normalized to 174 BPM
    const newLevel = Math.min(1.0, state.level + riseRate);

    // Anchory boost: counteracts bias, scales with cortisol
    // At max cortisol (1.0), boost = +15 (offsets half of -30 bias)
    const anchoryBoost = newLevel * 15.0;

    // Raise energy set point — agent "needs" to find work
    const setPoint = 0.7 + newLevel * 0.2; // 0.7 → 0.9

    return {
      level: newLevel,
      setPoint,
      lastTaskTime: state.lastTaskTime,
      anchoryBoost,
    };
  }

  // Natural decay when not triggered
  const decayRate = 0.0005 * (tickInterval / 345);
  return {
    level: Math.max(0, state.level - decayRate),
    setPoint: 0.7,
    lastTaskTime: state.lastTaskTime,
    anchoryBoost: Math.max(0, state.anchoryBoost - decayRate * 5),
  };
}

/**
 * Apply allostatic correction to tension calculation.
 * Called in PulseLoop.heartbeat() when computing effective tension.
 *
 * This is the key anti-sedation mechanism:
 * tension = rawTension + tensionBias + anchoryBoost
 *
 * Without allostasis: 50 + (-30) = 20 (permanently idle)
 * With allostasis:    50 + (-30) + 15 = 35 (responsive but calm)
 */
export function allostateAdjustedTension(
  rawTension: number,
  tensionBias: number,
  cortisol: CortisolState,
): number {
  return Math.max(0, Math.min(100,
    rawTension + tensionBias + cortisol.anchoryBoost
  ));
}
