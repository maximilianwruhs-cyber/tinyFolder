/**
 * GZMO Chaos Engine — PulseLoop (Daemon Edition)
 *
 * The sovereign heartbeat. Runs at 174 BPM (344ms interval).
 * Orchestrates all chaos subsystems on every tick:
 *   1. Hardware telemetry → tension
 *   2. Lorenz attractor RK4 step
 *   3. Logistic map coupling (every 10 ticks)
 *   4. Thought Cabinet tick → crystallization mutations
 *   5. Engine state tick → energy/phase/death
 *   6. Snapshot update
 *   7. Trigger evaluation → LiveStream.md (NEVER to APIs)
 *
 * Key difference from OpenClaw version:
 * - No OpenClaw service registration
 * - No Telegram/subagent dispatch
 * - Triggers write to a callback (LiveStream.log), not network
 * - Snapshot persists to VAULT_PATH/GZMO/CHAOS_STATE.json
 */

import * as os from "os";
import { atomicWriteJson, atomicWriteJsonSync } from "./vault_fs";
import { LorenzAttractor, LogisticMap } from "./chaos";
import { EngineState } from "./engine_state";
import { ThoughtCabinet } from "./thoughts";
import type {
  ChaosSnapshot, ChaosConfig,
  CrystallizationEvent,
} from "./types";
import {
  Phase,
  defaultMutations,
  phaseFromTension,
  clamp,
} from "./types";
import type { ChaosEvent } from "./feedback";
import {
  tensionDelta, energyDelta, thoughtSeed,
} from "./feedback";
import { TriggerEngine } from "./triggers";
import type { TriggerFired } from "./triggers";
import type { CortisolState } from "./allostasis";
import {
  defaultCortisolState, tickCortisol,
  allostateAdjustedTension,
} from "./allostasis";

const LOGISTIC_COUPLING_INTERVAL = 10;

export class PulseLoop {
  // Core systems
  private lorenz: LorenzAttractor;
  private logistic: LogisticMap;
  private engine: EngineState;
  private cabinet: ThoughtCabinet;

  // Config
  private config: ChaosConfig;

  // State
  private tick: number = 0;
  private tension: number = 0;
  private rawTension: number = 0;
  private intervalId: ReturnType<typeof setTimeout> | null = null;
  private currentSnapshot: ChaosSnapshot;
  private eventQueue: ChaosEvent[] = [];
  private snapshotFilePath: string | null = null;

  // Trigger system
  private triggers: TriggerEngine;
  private onTriggerFired: ((fired: TriggerFired[], snap: ChaosSnapshot) => void) | null = null;

  // Allostatic regulation
  private cortisol: CortisolState = defaultCortisolState();
  private hadRecentTask: boolean = false;

  // Telemetry cache
  private lastCpuTimes: { idle: number; total: number } | null = null;

  constructor(config: ChaosConfig) {
    this.config = config;
    this.lorenz = new LorenzAttractor(config.seed);
    this.logistic = new LogisticMap(config.seed);
    this.engine = new EngineState();
    this.cabinet = new ThoughtCabinet();
    this.triggers = TriggerEngine.withDefaults();
    this.tension = config.initialTension;
    this.rawTension = config.initialTension;

    this.currentSnapshot = {
      tick: 0,
      x: config.seed, y: config.seed + 0.001, z: config.seed + 0.002,
      tension: 0, energy: 100,
      phase: Phase.Idle, alive: true, deaths: 0, chaosVal: 0.5,
      thoughtsIncubating: 0, thoughtsCrystallized: 0,
      mutations: defaultMutations(),
      llmTemperature: 0.6, llmMaxTokens: 256, llmValence: 0.0,
      lastCrystallization: null,
      cortisol: 0.0, anchoryBoost: 0.0,
      timestamp: new Date().toISOString(),
    };
  }

  /** Start the heartbeat. */
  start(snapshotFilePath?: string): void {
    if (this.intervalId) return;
    this.snapshotFilePath = snapshotFilePath ?? null;

    const intervalMs = Math.round(60000 / this.config.bpm);

    // Self-correcting timer
    const tick = () => {
      const start = Date.now();
      this.heartbeat();
      const elapsed = Date.now() - start;
      this.intervalId = setTimeout(tick, Math.max(1, intervalMs - elapsed));
    };
    this.intervalId = setTimeout(tick, intervalMs);
    console.log(`[PULSE] Started at ${this.config.bpm} BPM (${intervalMs}ms, self-correcting)`);
  }

  /** Stop the heartbeat. */
  stop(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
      if (this.snapshotFilePath) {
        try {
          // Best-effort final flush (atomic)
          atomicWriteJsonSync(
            this.snapshotFilePath.split(/[/\\]GZMO[/\\]/)[0] ?? "",
            this.snapshotFilePath,
            this.currentSnapshot,
            2,
          );
        } catch {}
      }
      console.log("[PULSE] Stopped (final snapshot flushed)");
    }
  }

  /** Get the current snapshot. */
  snapshot(): ChaosSnapshot {
    return { ...this.currentSnapshot };
  }

  /** Queue an event for processing on the next tick. */
  emitEvent(event: ChaosEvent): void {
    this.eventQueue.push(event);
  }

  /**
   * Set external dispatch callback for trigger actions.
   * In the daemon, this writes to LiveStream.md — never to APIs.
   */
  setTriggerDispatch(
    onFired: (fired: TriggerFired[], snap: ChaosSnapshot) => void,
  ): void {
    this.onTriggerFired = onFired;
  }

  // ── Heartbeat: the core tick ─────────────────────────────────────

  private heartbeat(): void {
    this.tick++;

    // 1. Read hardware telemetry → baseline raw tension
    const hwTension = this.sampleHardware();
    this.rawTension = hwTension;

    // 2. Process pending events (may adjust raw tension + energy)
    this.processEvents();

    // 3. Allostatic cortisol tick (consumes hadRecentTask set by events/tasks)
    const intervalMs = Math.round(60000 / this.config.bpm);
    this.cortisol = tickCortisol(
      this.cortisol,
      this.cabinet.mutations.tensionBias,
      this.hadRecentTask,
      intervalMs,
    );
    this.hadRecentTask = false; // consumed

    // 4. Apply tension bias + allostatic correction
    this.tension = allostateAdjustedTension(
      this.rawTension,
      this.cabinet.mutations.tensionBias,
      this.cortisol,
    );

    // 5. Apply thought cognitive effects to Lorenz
    this.lorenz.applyCognitiveNoise(this.cabinet.activeLorenzNoise());
    this.lorenz.applyRhoMutation(this.cabinet.mutations.lorenzRhoMod);

    // 6. Phase-dependent Lorenz sigma modulation
    const phase = phaseFromTension(this.tension);
    this.lorenz.updatePhase(phase);

    // 7. Lorenz RK4 step
    const [x, y, z] = this.lorenz.step();

    // 8. Logistic map coupling (every 10 ticks)
    if (this.tick % LOGISTIC_COUPLING_INTERVAL === 0) {
      this.logistic.reseedFromLorenz(this.lorenz.normalizedOutput());
    }
    const chaosVal = this.logistic.nextVal();

    // 9. Thought Cabinet tick → crystallizations
    const crystallizations = this.cabinet.tick();
    let lastCryst: CrystallizationEvent | null = null;
    if (crystallizations.length > 0) {
      lastCryst = crystallizations[crystallizations.length - 1]!;
      lastCryst!.tickCrystallized = this.tick;
    }

    // 10. Engine state tick
    const gravity = this.config.gravity + this.cabinet.mutations.gravityMod;
    const friction = Math.max(0.01, this.config.friction + this.cabinet.mutations.frictionMod);
    this.engine.tickHeartbeat(
      this.tension, gravity, friction, chaosVal,
      this.cabinet.activeDrainMultiplier(),
    );

    // 11. Derive LLM parameters from attractor state
    const llmTemperature = deriveTemperature(x);
    const llmMaxTokens = deriveMaxTokens(z);
    const llmValence = deriveValence(y);

    // 12. Build snapshot
    this.currentSnapshot = {
      tick: this.tick,
      x, y, z,
      tension: this.tension,
      energy: this.engine.energy,
      phase: this.engine.phase,
      alive: this.engine.alive,
      deaths: this.engine.deaths,
      chaosVal,
      thoughtsIncubating: this.cabinet.occupiedSlots(),
      thoughtsCrystallized: this.cabinet.mutations.totalCrystallized,
      mutations: { ...this.cabinet.mutations },
      llmTemperature,
      llmMaxTokens,
      llmValence,
      lastCrystallization: lastCryst,
      cortisol: this.cortisol.level,
      anchoryBoost: this.cortisol.anchoryBoost,
      timestamp: new Date().toISOString(),
    };

    // 13. Evaluate triggers → dispatch to LiveStream callback
    const fired = this.triggers.evaluate(this.currentSnapshot);
    if (fired.length > 0 && this.onTriggerFired) {
      this.onTriggerFired(fired, this.currentSnapshot);
    }

    // 14. Write snapshot every 30 ticks (~10s)
    this.persistSnapshot();
  }

  // ── Event Queue Processing ───────────────────────────────────────

  private processEvents(): void {
    const events = this.eventQueue.splice(0, this.eventQueue.length);

    for (const event of events) {
      this.rawTension = clamp(this.rawTension + tensionDelta(event), 0, 100);
      this.engine.applyEnergyDelta(energyDelta(event));

      // Signal allostasis that real work happened
      if (event.type === 'task_received' || event.type === 'task_completed') {
        this.hadRecentTask = true;
      }

      const seed = thoughtSeed(event);
      if (seed) {
        this.cabinet.tryAbsorb(seed.category, seed.text, this.tick, this.logistic.nextVal());
      }
    }
  }

  // ── Hardware Telemetry ───────────────────────────────────────────

  private sampleHardware(): number {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.idle + cpu.times.user + cpu.times.sys + cpu.times.irq + cpu.times.nice;
    }

    let cpuUsage = 0;
    if (this.lastCpuTimes) {
      const idleDiff = idle - this.lastCpuTimes.idle;
      const totalDiff = total - this.lastCpuTimes.total;
      cpuUsage = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
    }
    this.lastCpuTimes = { idle, total };

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramUsage = ((totalMem - freeMem) / totalMem) * 100;

    return clamp(cpuUsage * 0.6 + ramUsage * 0.4, 0, 100);
  }

  // ── Snapshot Persistence ─────────────────────────────────────────

  private persistSnapshot(): void {
    if (!this.snapshotFilePath) return;
    if (this.tick % 30 !== 0) return;

    // Fire-and-forget, but keep atomic writes to avoid partial JSON.
    const vaultRoot = this.snapshotFilePath.split(/[/\\]GZMO[/\\]/)[0] ?? "";
    if (!vaultRoot) return;
    atomicWriteJson(vaultRoot, this.snapshotFilePath, this.currentSnapshot, 2).catch(() => {});
  }
}

// ── LLM Parameter Derivation ───────────────────────────────────────

function deriveTemperature(x: number): number {
  const normalized = clamp((x + 20) / 40, 0, 1);
  return 0.3 + normalized * 0.9;
}

function deriveMaxTokens(z: number): number {
  const normalized = clamp(z / 50, 0, 1);
  return Math.round(400 + normalized * 400); // 400–800: floor high enough for think+output
}

function deriveValence(y: number): number {
  return clamp(y / 30, -1, 1);
}


