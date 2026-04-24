import { expect, test, describe } from "bun:test";
import { Phase, phaseFromTension } from "../types";

describe("phaseFromTension", () => {
  test("returns Idle for tension < 33.0", () => {
    expect(phaseFromTension(0)).toBe(Phase.Idle);
    expect(phaseFromTension(32.9)).toBe(Phase.Idle);
    expect(phaseFromTension(-10)).toBe(Phase.Idle);
  });

  test("returns Build for tension >= 33.0 and < 66.0", () => {
    expect(phaseFromTension(33.0)).toBe(Phase.Build);
    expect(phaseFromTension(50)).toBe(Phase.Build);
    expect(phaseFromTension(65.9)).toBe(Phase.Build);
  });

  test("returns Drop for tension >= 66.0", () => {
    expect(phaseFromTension(66.0)).toBe(Phase.Drop);
    expect(phaseFromTension(100)).toBe(Phase.Drop);
    expect(phaseFromTension(1000)).toBe(Phase.Drop);
  });
});
