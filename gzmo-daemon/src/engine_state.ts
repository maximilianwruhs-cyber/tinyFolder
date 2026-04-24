/**
 * GZMO Chaos Engine — Engine State Machine
 *
 * Direct port of engine.rs.
 * Manages: energy (0-100), phase (Idle/Build/Drop), death/rebirth lifecycle.
 *
 * Energy drain = gravity × friction × 0.02 × phase_multiplier × thought_drain_mod
 * Regen = 2.5 × (1 - energy/100) — inverse curve, stronger when depleted
 * Death at energy ≤ 0, rebirth at 30% chance per tick (chaos_roll > 0.7)
 */

import { Phase, phaseFromTension, phaseDrainMultiplier, clamp } from "./types";

const ENERGY_MIN = 0.0;
const ENERGY_MAX = 100.0;
const REGEN_BASE = 2.5;
const REBIRTH_ENERGY = 30.0;
const INBOX_ENERGY = 20.0;

export class EngineState {
  tick: number = 0;
  energy: number = ENERGY_MAX;
  phase: Phase = Phase.Idle;
  alive: boolean = true;
  deaths: number = 0;

  tickHeartbeat(
    tension: number,
    gravity: number,
    friction: number,
    chaosRoll: number,
    thoughtDrainMod: number,
  ): boolean {
    this.tick++;
    this.phase = phaseFromTension(tension);

    if (!this.alive) {
      if (chaosRoll > 0.7) {
        this.alive = true;
        this.energy = REBIRTH_ENERGY;
        return true;
      }
      return false;
    }

    const drain = gravity * friction * 0.02 * phaseDrainMultiplier(this.phase) * thoughtDrainMod;
    const regen = REGEN_BASE * (1.0 - (this.energy / ENERGY_MAX));

    let net: number;
    switch (this.phase) {
      case Phase.Idle:
        net = regen - drain;
        break;
      case Phase.Build:
        net = (regen * 0.3) - drain;
        break;
      case Phase.Drop:
        net = -drain;
        break;
    }

    this.energy = clamp(this.energy + net, ENERGY_MIN, ENERGY_MAX);

    if (this.energy <= ENERGY_MIN) {
      this.alive = false;
      this.deaths++;

      if (chaosRoll > 0.7) {
        this.alive = true;
        this.energy = REBIRTH_ENERGY;
        return true;
      }
    }

    return false;
  }

  applyInboxDrop(): boolean {
    this.tick++;
    this.energy = Math.min(this.energy + INBOX_ENERGY, ENERGY_MAX);
    const resurrected = !this.alive;
    if (resurrected) this.alive = true;
    return resurrected;
  }

  applyEnergyDelta(delta: number): void {
    this.energy = clamp(this.energy + delta, ENERGY_MIN, ENERGY_MAX);
    if (this.energy <= ENERGY_MIN && this.alive) {
      this.alive = false;
      this.deaths++;
    }
  }
}
