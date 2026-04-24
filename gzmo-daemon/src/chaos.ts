/**
 * GZMO Chaos Engine — Lorenz Attractor & Logistic Map
 *
 * Direct port of chaos.rs.
 * Uses 4th-order Runge-Kutta integration (dt=0.005) for numerical stability.
 * Lorenz system: σ=10, ρ=28, β=8/3 — the classic strange attractor.
 *
 * The Logistic Map (r=3.99) provides a fast secondary chaos source,
 * periodically reseeded from the Lorenz attractor's normalized output.
 */

import { Phase, clamp } from "./types";

// ── Lorenz Attractor ───────────────────────────────────────────────

const DEFAULT_SIGMA = 10.0;
const DEFAULT_RHO = 28.0;
const DEFAULT_BETA = 8.0 / 3.0;
const DT = 0.005;

export class LorenzAttractor {
  x: number;
  y: number;
  z: number;
  private sigma: number;
  private rho: number;
  private beta: number;
  private baseSigma: number;

  constructor(seed: number = 0.506) {
    this.x = seed;
    this.y = seed + 0.001;
    this.z = seed + 0.002;
    this.sigma = DEFAULT_SIGMA;
    this.rho = DEFAULT_RHO;
    this.beta = DEFAULT_BETA;
    this.baseSigma = DEFAULT_SIGMA;
  }

  step(): [number, number, number] {
    const { x, y, z, sigma, rho, beta } = this;

    const dx = (s: number, x: number, y: number, _z: number) => s * (y - x);
    const dy = (_s: number, x: number, y: number, z: number) => x * (rho - z) - y;
    const dz = (_s: number, x: number, y: number, z: number) => x * y - beta * z;

    const k1x = dx(sigma, x, y, z);
    const k1y = dy(sigma, x, y, z);
    const k1z = dz(sigma, x, y, z);

    const x2 = x + 0.5 * DT * k1x;
    const y2 = y + 0.5 * DT * k1y;
    const z2 = z + 0.5 * DT * k1z;
    const k2x = dx(sigma, x2, y2, z2);
    const k2y = dy(sigma, x2, y2, z2);
    const k2z = dz(sigma, x2, y2, z2);

    const x3 = x + 0.5 * DT * k2x;
    const y3 = y + 0.5 * DT * k2y;
    const z3 = z + 0.5 * DT * k2z;
    const k3x = dx(sigma, x3, y3, z3);
    const k3y = dy(sigma, x3, y3, z3);
    const k3z = dz(sigma, x3, y3, z3);

    const x4 = x + DT * k3x;
    const y4 = y + DT * k3y;
    const z4 = z + DT * k3z;
    const k4x = dx(sigma, x4, y4, z4);
    const k4y = dy(sigma, x4, y4, z4);
    const k4z = dz(sigma, x4, y4, z4);

    this.x = x + (DT / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
    this.y = y + (DT / 6.0) * (k1y + 2.0 * k2y + 2.0 * k3y + k4y);
    this.z = z + (DT / 6.0) * (k1z + 2.0 * k2z + 2.0 * k3z + k4z);

    return [this.x, this.y, this.z];
  }

  updatePhase(phase: Phase): void {
    switch (phase) {
      case Phase.Idle:  this.sigma = this.baseSigma * 0.8; break;
      case Phase.Build: this.sigma = this.baseSigma;       break;
      case Phase.Drop:  this.sigma = this.baseSigma * 1.4; break;
    }
  }

  normalizedOutput(): number {
    return clamp((this.x + 20.0) / 40.0, 0.0, 1.0);
  }

  applyCognitiveNoise(noise: number): void {
    this.sigma = this.baseSigma + noise;
  }

  applyRhoMutation(rhoMod: number): void {
    this.rho = DEFAULT_RHO + rhoMod;
  }
}

// ── Logistic Map ───────────────────────────────────────────────────

const LOGISTIC_R = 3.99;

export class LogisticMap {
  private val: number;

  constructor(seed: number = 0.506) {
    this.val = clamp(seed, 0.01, 0.99);
  }

  nextVal(): number {
    this.val = LOGISTIC_R * this.val * (1.0 - this.val);
    this.val = clamp(this.val, 0.001, 0.999);
    return this.val;
  }

  reseedFromLorenz(normalized: number): void {
    this.val = clamp((this.val + normalized) / 2.0, 0.01, 0.99);
  }
}
