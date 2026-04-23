/**
 * GZMO Chaos Engine — Trigger Engine (Daemon Edition)
 *
 * Direct port of triggers.rs, with the CRITICAL difference:
 * ALL trigger outputs go to the LiveStream (local file writes).
 * NOTHING goes to APIs, subagents, or network calls.
 *
 * This is the core lesson from the old build: 55 Telegram notifications
 * in 5 hours created a self-amplifying failure loop that burned the
 * entire Gemini API quota. Never again.
 *
 * Triggers fire → LiveStream.md gets a line. Cost: zero.
 */

import type { ChaosSnapshot } from "./types";
import { Phase, defaultSnapshot } from "./types";

// ── Trigger Condition ──────────────────────────────────────────────

export type ChaosMetric =
  | "tension" | "energy" | "valence" | "temperature"
  | "lorenzX" | "lorenzY" | "lorenzZ" | "chaosVal";

function extractMetric(snap: ChaosSnapshot, metric: ChaosMetric): number {
  switch (metric) {
    case "tension": return snap.tension;
    case "energy": return snap.energy;
    case "valence": return snap.llmValence;
    case "temperature": return snap.llmTemperature;
    case "lorenzX": return snap.x;
    case "lorenzY": return snap.y;
    case "lorenzZ": return snap.z;
    case "chaosVal": return snap.chaosVal;
  }
}

export type TriggerCondition =
  | { type: "above"; metric: ChaosMetric; threshold: number }
  | { type: "below"; metric: ChaosMetric; threshold: number }
  | { type: "phaseEnter"; phase: Phase }
  | { type: "crystallization" }
  | { type: "death" }
  | { type: "periodic"; intervalTicks: number };

// ── Trigger Action (Daemon Edition: all actions are local) ─────────

export type TriggerAction =
  | { type: "log"; message: string; level: "whisper" | "normal" | "urgent" | "critical" }
  | { type: "emitEvent"; tensionDelta: number; energyDelta: number };

// ── Trigger Definition ─────────────────────────────────────────────

export interface ChaosTrigger {
  name: string;
  condition: TriggerCondition;
  action: TriggerAction;
  cooldownTicks: number;
  enabled: boolean;
  lastFired: number;
}

export interface TriggerFired {
  triggerName: string;
  action: TriggerAction;
}

// ── Trigger Engine ─────────────────────────────────────────────────

export class TriggerEngine {
  private triggers: ChaosTrigger[] = [];
  private prevSnapshot: ChaosSnapshot = defaultSnapshot();

  static withDefaults(): TriggerEngine {
    const engine = new TriggerEngine();

    // ─── Critical Tension Alert ────────────────────────────
    engine.add({
      name: "tension_critical",
      condition: { type: "above", metric: "tension", threshold: 85.0 },
      action: { type: "log", message: "⚡ Tension critically high!", level: "critical" },
      cooldownTicks: 90,
      enabled: true, lastFired: 0,
    });

    // ─── Energy Warning ────────────────────────────────────
    engine.add({
      name: "energy_critical",
      condition: { type: "below", metric: "energy", threshold: 10.0 },
      action: { type: "log", message: "🔋 Energy critical — approaching death!", level: "critical" },
      cooldownTicks: 90,
      enabled: true, lastFired: 0,
    });

    // ─── Phase Transition: DROP ────────────────────────────
    engine.add({
      name: "phase_drop",
      condition: { type: "phaseEnter", phase: Phase.Drop },
      action: { type: "log", message: "📉 Phase DROP — maximum chaos.", level: "urgent" },
      cooldownTicks: 30,
      enabled: true, lastFired: 0,
    });

    // ─── Death & Rebirth ───────────────────────────────────
    engine.add({
      name: "death_event",
      condition: { type: "death" },
      action: { type: "log", message: "💀 Engine died and was reborn.", level: "urgent" },
      cooldownTicks: 1,
      enabled: true, lastFired: 0,
    });

    // ─── Crystallization ───────────────────────────────────
    engine.add({
      name: "crystallization",
      condition: { type: "crystallization" },
      action: { type: "log", message: "🔮 Thought crystallized — mutation applied.", level: "normal" },
      cooldownTicks: 1,
      enabled: true, lastFired: 0,
    });

    return engine;
  }

  add(trigger: ChaosTrigger): void {
    this.triggers.push(trigger);
  }

  evaluate(snap: ChaosSnapshot): TriggerFired[] {
    const fired: TriggerFired[] = [];

    for (const trigger of this.triggers) {
      if (this.shouldFire(trigger, snap)) {
        fired.push({ triggerName: trigger.name, action: trigger.action });
        trigger.lastFired = snap.tick;
      }
    }

    this.prevSnapshot = { ...snap };
    return fired;
  }

  private shouldFire(trigger: ChaosTrigger, snap: ChaosSnapshot): boolean {
    if (!trigger.enabled) return false;
    if (snap.tick - trigger.lastFired < trigger.cooldownTicks) return false;

    const prev = this.prevSnapshot;

    switch (trigger.condition.type) {
      case "above": {
        const val = extractMetric(snap, trigger.condition.metric);
        const prevVal = extractMetric(prev, trigger.condition.metric);
        return val > trigger.condition.threshold && prevVal <= trigger.condition.threshold;
      }
      case "below": {
        const val = extractMetric(snap, trigger.condition.metric);
        const prevVal = extractMetric(prev, trigger.condition.metric);
        return val < trigger.condition.threshold && prevVal >= trigger.condition.threshold;
      }
      case "phaseEnter":
        return snap.phase === trigger.condition.phase && prev.phase !== trigger.condition.phase;
      case "crystallization":
        return snap.lastCrystallization !== null;
      case "death":
        return snap.deaths > prev.deaths;
      case "periodic":
        return snap.tick > 0 && snap.tick % trigger.condition.intervalTicks === 0;
    }
  }
}
