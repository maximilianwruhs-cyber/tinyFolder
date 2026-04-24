import { expect, test, describe } from "bun:test";
import { LorenzAttractor, LogisticMap } from "../chaos";
import { EngineState } from "../engine_state";
import { Phase } from "../types";

describe("Chaos Engine", () => {
  test("LorenzAttractor step stability", () => {
    const lorenz = new LorenzAttractor();
    const initial = [lorenz.x, lorenz.y, lorenz.z];
    const next = lorenz.step();
    expect(next[0]).not.toBe(initial[0]);
    expect(next[1]).not.toBe(initial[1]);
    expect(next[2]).not.toBe(initial[2]);

    // Check if it doesn't explode in 1000 steps
    for (let i = 0; i < 1000; i++) {
      const [x, y, z] = lorenz.step();
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
    }
  });

  test("LorenzAttractor phase modulation", () => {
    const lorenz = new LorenzAttractor();

    lorenz.updatePhase(Phase.Idle);
    // @ts-ignore - accessing private for test
    const sigmaIdle = lorenz.sigma;

    lorenz.updatePhase(Phase.Build);
    // @ts-ignore
    const sigmaBuild = lorenz.sigma;

    lorenz.updatePhase(Phase.Drop);
    // @ts-ignore
    const sigmaDrop = lorenz.sigma;

    expect(sigmaIdle).toBeLessThan(sigmaBuild);
    expect(sigmaBuild).toBeLessThan(sigmaDrop);
  });

  test("LogisticMap chaos", () => {
    const map = new LogisticMap(0.5);
    const v1 = map.nextVal();
    const v2 = map.nextVal();
    expect(v1).not.toBe(v2);
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(1);
  });

  test("EngineState lifecycle", () => {
    const engine = new EngineState();
    expect(engine.alive).toBe(true);
    expect(engine.energy).toBe(100);

    // Drain energy to death
    engine.applyEnergyDelta(-110);
    expect(engine.energy).toBe(0);
    expect(engine.alive).toBe(false);
    expect(engine.deaths).toBe(1);

    // Test rebirth
    let resurrected = false;
    for (let i = 0; i < 100; i++) {
      if (engine.tickHeartbeat(50, 10, 10, 0.8, 1.0)) {
        resurrected = true;
        break;
      }
    }
    expect(resurrected).toBe(true);
    expect(engine.alive).toBe(true);
    expect(engine.energy).toBe(30);
  });
});
