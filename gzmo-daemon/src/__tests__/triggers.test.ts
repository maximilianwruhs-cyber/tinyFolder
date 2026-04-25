import { expect, test, describe } from "bun:test";
import { TriggerEngine } from "../triggers";
import { Phase, defaultSnapshot } from "../types";

describe("Trigger Engine", () => {
  test("above condition fires correctly", () => {
    const engine = new TriggerEngine();
    engine.add({
      name: "test_above",
      condition: { type: "above", metric: "tension", threshold: 50 },
      action: { type: "log", message: "fire", level: "normal" },
      cooldownTicks: 10,
      enabled: true,
      lastFired: 0
    });

    const snap1 = { ...defaultSnapshot(), tick: 1, tension: 40 };
    const fired1 = engine.evaluate(snap1);
    expect(fired1.length).toBe(0);

    const snap2 = { ...defaultSnapshot(), tick: 2, tension: 60 };
    const fired2 = engine.evaluate(snap2);
    expect(fired2.length).toBe(1);
    expect(fired2[0]!.triggerName).toBe("test_above");

    // Test cooldown
    const snap3 = { ...defaultSnapshot(), tick: 3, tension: 70 };
    const fired3 = engine.evaluate(snap3);
    expect(fired3.length).toBe(0);
  });

  test("phaseEnter fires correctly", () => {
    const engine = new TriggerEngine();
    engine.add({
      name: "test_phase",
      condition: { type: "phaseEnter", phase: Phase.Drop },
      action: { type: "log", message: "fire", level: "normal" },
      cooldownTicks: 10,
      enabled: true,
      lastFired: 0
    });

    const snap1 = { ...defaultSnapshot(), tick: 1, phase: Phase.Idle };
    engine.evaluate(snap1);

    const snap2 = { ...defaultSnapshot(), tick: 2, phase: Phase.Drop };
    const fired2 = engine.evaluate(snap2);
    expect(fired2.length).toBe(1);
  });
});
