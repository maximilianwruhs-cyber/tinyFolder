/**
 * GZMO Chaos Engine — Shared Type Definitions
 *
 * Direct port of Rust structs from gzmo-chaos crate.
 * All numeric types are IEEE 754 double (identical to Rust f64).
 */

// ── Phase (from chaos.rs) ──────────────────────────────────────────

export enum Phase {
  Idle = "idle",
  Build = "build",
  Drop = "drop",
}

export function phaseFromTension(tension: number): Phase {
  if (tension < 33.0) return Phase.Idle;
  if (tension < 66.0) return Phase.Build;
  return Phase.Drop;
}

export function phaseDrainMultiplier(phase: Phase): number {
  switch (phase) {
    case Phase.Idle: return 0.5;
    case Phase.Build: return 1.0;
    case Phase.Drop: return 2.0;
  }
}

// ── Mutations (from thoughts.rs) ───────────────────────────────────

export interface Mutations {
  gravityMod: number;       // [-5.0, +5.0]
  frictionMod: number;      // [-0.5, +0.5]
  lorenzRhoMod: number;     // [-10.0, +10.0]
  tensionBias: number;      // [-30.0, +30.0]
  totalCrystallized: number;
}

export function defaultMutations(): Mutations {
  return {
    gravityMod: 0,
    frictionMod: 0,
    lorenzRhoMod: 0,
    tensionBias: 0,
    totalCrystallized: 0,
  };
}

// ── Crystallization Event (from thoughts.rs) ───────────────────────

export interface MutationEffect {
  target: string;
  delta: number;
  description: string;
}

export interface CrystallizationEvent {
  category: string;
  text: string;
  tickAbsorbed: number;
  tickCrystallized: number;
  mutation: MutationEffect;
}

// ── ChaosSnapshot (from pulse.rs) ──────────────────────────────────

export interface ChaosSnapshot {
  tick: number;
  x: number;
  y: number;
  z: number;
  tension: number;
  energy: number;
  phase: Phase;
  alive: boolean;
  deaths: number;
  chaosVal: number;

  // Thought Cabinet state
  thoughtsIncubating: number;
  thoughtsCrystallized: number;
  mutations: Mutations;

  // Derived LLM parameters
  llmTemperature: number;   // [0.3, 1.2]
  llmMaxTokens: number;     // [400, 800]
  llmValence: number;       // [-1.0, 1.0]

  // Last crystallization (if any on this tick)
  lastCrystallization: CrystallizationEvent | null;

  // Allostatic state
  cortisol: number;         // 0.0–1.0 simulated stress level
  anchoryBoost: number;     // current feedback stabilization boost

  // Timestamp
  timestamp: string;
}

export function defaultSnapshot(): ChaosSnapshot {
  return {
    tick: 0,
    x: 0.506, y: 0.507, z: 0.508,
    tension: 0, energy: 100,
    phase: Phase.Idle,
    alive: true, deaths: 0,
    chaosVal: 0.5,
    thoughtsIncubating: 0,
    thoughtsCrystallized: 0,
    mutations: defaultMutations(),
    llmTemperature: 0.6,
    llmMaxTokens: 256,
    llmValence: 0.0,
    lastCrystallization: null,
    cortisol: 0.0,
    anchoryBoost: 0.0,
    timestamp: "",
  };
}

// ── ChaosConfig ────────────────────────────────────────────────────

export interface ChaosConfig {
  gravity: number;          // default: 9.8
  friction: number;         // default: 0.5
  seed: number;             // default: 0.506
  initialTension: number;   // default: 0.0
  bpm: number;              // default: 174
}

export function defaultConfig(): ChaosConfig {
  return {
    gravity: 9.8,
    friction: 0.5,
    seed: 0.506,
    initialTension: 0.0,
    bpm: 174,
  };
}

// ── Shared Utility ─────────────────────────────────────────────────

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
