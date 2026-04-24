import { describe, expect, test, beforeEach } from "bun:test";
import { EngineState } from "../engine_state";
import { Phase } from "../types";

describe("EngineState", () => {
  let state: EngineState;

  beforeEach(() => {
    state = new EngineState();
  });

  describe("tickHeartbeat", () => {
    test("increments tick and updates phase based on tension", () => {
      // tension < 33 is Idle
      state.tickHeartbeat(10, 9.8, 0.5, 0.5, 1.0);
      expect(state.tick).toBe(1);
      expect(state.phase).toBe(Phase.Idle);

      // tension < 66 is Build
      state.tickHeartbeat(40, 9.8, 0.5, 0.5, 1.0);
      expect(state.tick).toBe(2);
      expect(state.phase).toBe(Phase.Build);

      // tension >= 66 is Drop
      state.tickHeartbeat(80, 9.8, 0.5, 0.5, 1.0);
      expect(state.tick).toBe(3);
      expect(state.phase).toBe(Phase.Drop);
    });

    test("drains energy in drop phase", () => {
      state.energy = 50; // Set to middle to avoid clamping
      const initialEnergy = state.energy;
      // High tension -> Drop phase -> only drains energy
      state.tickHeartbeat(80, 10, 1, 0.5, 1.0);
      expect(state.energy).toBeLessThan(initialEnergy);
    });

    test("dies when energy reaches 0", () => {
      state.energy = 0.1;
      // High tension -> Drop phase -> negative net
      // Gravity 10, friction 1, drain mod 1 -> drain = 10 * 1 * 0.02 * 2.0 * 1 = 0.4
      state.tickHeartbeat(80, 10, 1, 0.5, 1.0);

      expect(state.energy).toBe(0);
      expect(state.alive).toBe(false);
      expect(state.deaths).toBe(1);
    });

    test("handles rebirth correctly", () => {
      state.alive = false;
      state.energy = 0;

      // chaosRoll > 0.7 triggers rebirth
      const reborn = state.tickHeartbeat(10, 9.8, 0.5, 0.8, 1.0);

      expect(reborn).toBe(true);
      expect(state.alive).toBe(true);
      expect(state.energy).toBe(30); // REBIRTH_ENERGY
    });

    test("does not rebirth if chaosRoll is too low", () => {
      state.alive = false;
      state.energy = 0;

      // chaosRoll <= 0.7 does not trigger rebirth
      const reborn = state.tickHeartbeat(10, 9.8, 0.5, 0.5, 1.0);

      expect(reborn).toBe(false);
      expect(state.alive).toBe(false);
      expect(state.energy).toBe(0);
    });
  });

  describe("applyInboxDrop", () => {
    test("increases energy by INBOX_ENERGY and clamps at MAX", () => {
      state.energy = 90;
      state.applyInboxDrop();
      expect(state.energy).toBe(100); // Clamped at ENERGY_MAX

      state.energy = 50;
      state.applyInboxDrop();
      expect(state.energy).toBe(70); // 50 + 20
    });

    test("resurrects a dead engine", () => {
      state.alive = false;
      state.energy = 0;

      const resurrected = state.applyInboxDrop();

      expect(resurrected).toBe(true);
      expect(state.alive).toBe(true);
      expect(state.energy).toBe(20); // 0 + 20
    });
  });

  describe("applyEnergyDelta", () => {
    test("applies positive delta", () => {
      state.energy = 50;
      state.applyEnergyDelta(10);
      expect(state.energy).toBe(60);
    });

    test("applies negative delta", () => {
      state.energy = 50;
      state.applyEnergyDelta(-10);
      expect(state.energy).toBe(40);
    });

    test("clamps energy between MIN and MAX", () => {
      state.energy = 90;
      state.applyEnergyDelta(50);
      expect(state.energy).toBe(100);

      state.energy = 10;
      state.applyEnergyDelta(-50);
      expect(state.energy).toBe(0);
    });

    test("dies when energy hits 0", () => {
      state.energy = 10;
      state.applyEnergyDelta(-20);

      expect(state.energy).toBe(0);
      expect(state.alive).toBe(false);
      expect(state.deaths).toBe(1);
    });
  });
});
