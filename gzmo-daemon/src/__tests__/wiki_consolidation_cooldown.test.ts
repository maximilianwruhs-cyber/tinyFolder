import { describe, expect, test } from "bun:test";
import {
  consolidationBackoffMinutes,
  consolidationClusterKey,
  consolidationCooldownActive,
  parseConsolidationCooldowns,
} from "../wiki_consolidation_cooldown";

describe("wiki_consolidation_cooldown", () => {
  test("cluster key stable when caller passes sorted paths", () => {
    const paths = ["a/x.md", "b/y.md"].sort();
    const k = consolidationClusterKey("dream", paths);
    expect(k).toBe(consolidationClusterKey("dream", [...paths]));
    expect(k.length).toBe(16);
  });

  test("consolidationClusterKey differs across categories", () => {
    const k1 = consolidationClusterKey("dream", ["a.md"]);
    const k2 = consolidationClusterKey("tension", ["a.md"]);
    expect(k1).not.toBe(k2);
  });

  test("consolidationBackoffMinutes doubles until cap", () => {
    expect(consolidationBackoffMinutes(1, 15, 24)).toBe(15);
    expect(consolidationBackoffMinutes(2, 15, 24)).toBe(30);
    expect(consolidationBackoffMinutes(3, 15, 24)).toBe(60);
    const minutesIn24h = 24 * 60;
    expect(consolidationBackoffMinutes(99, 15, 24)).toBe(minutesIn24h);
  });

  test("consolidationCooldownActive respects wall clock", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(consolidationCooldownActive(past, Date.now())).toBe(false);
    expect(consolidationCooldownActive(future, Date.now())).toBe(true);
    expect(consolidationCooldownActive("not-a-date", Date.now())).toBe(false);
  });

  test("parseConsolidationCooldowns drops invalid rows", () => {
    expect(parseConsolidationCooldowns(undefined)).toEqual({});
    expect(parseConsolidationCooldowns([])).toEqual({});
    expect(
      parseConsolidationCooldowns({
        good: { failures: 2, nextRetryAt: "2026-05-01T00:00:00.000Z", lastReason: "x".repeat(500) },
        bad1: {},
        bad2: { failures: "nope", nextRetryAt: "2026-05-01T00:00:00.000Z" },
      }),
    ).toEqual({
      good: {
        failures: 2,
        nextRetryAt: "2026-05-01T00:00:00.000Z",
        lastReason: "x".repeat(240),
      },
    });
  });
});
