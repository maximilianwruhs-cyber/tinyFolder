import { describe, expect, test } from "bun:test";
import { LruMap } from "../lru_map";

describe("LruMap", () => {
  test("rejects invalid max", () => {
    expect(() => new LruMap(0)).toThrow();
    expect(() => new LruMap(-1)).toThrow();
    expect(() => new LruMap(NaN)).toThrow();
  });

  test("stores and retrieves like a Map up to capacity", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1).set("b", 2).set("c", 3);
    expect(m.size).toBe(3);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBe(2);
    expect(m.get("c")).toBe(3);
  });

  test("evicts least-recently-inserted on overflow", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1).set("b", 2).set("c", 3);
    m.set("d", 4); // capacity reached → evict 'a'
    expect(m.has("a")).toBe(false);
    expect(m.has("b")).toBe(true);
    expect(m.has("c")).toBe(true);
    expect(m.has("d")).toBe(true);
    expect(m.size).toBe(3);
  });

  test("get() refreshes recency so the touched key survives the next eviction", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1).set("b", 2).set("c", 3);
    expect(m.get("a")).toBe(1); // bumps 'a' to MRU
    m.set("d", 4); // evicts the oldest unbumped key, which is now 'b'
    expect(m.has("a")).toBe(true);
    expect(m.has("b")).toBe(false);
    expect(m.has("c")).toBe(true);
    expect(m.has("d")).toBe(true);
  });

  test("set() on existing key refreshes recency without evicting anything", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1).set("b", 2).set("c", 3);
    m.set("a", 99); // update + bump
    expect(m.size).toBe(3);
    expect(m.get("a")).toBe(99);
    m.set("d", 4); // 'b' should be the LRU now
    expect(m.has("b")).toBe(false);
    expect(m.has("a")).toBe(true);
  });

  test("delete() and clear()", () => {
    const m = new LruMap<string, number>(3);
    m.set("a", 1).set("b", 2);
    expect(m.delete("a")).toBe(true);
    expect(m.has("a")).toBe(false);
    expect(m.delete("missing")).toBe(false);
    m.clear();
    expect(m.size).toBe(0);
  });

  test("get() on missing key returns undefined and does not change order", () => {
    const m = new LruMap<string, number>(2);
    m.set("a", 1).set("b", 2);
    expect(m.get("missing")).toBeUndefined();
    m.set("c", 3); // evict 'a' (still oldest)
    expect(m.has("a")).toBe(false);
    expect(m.has("b")).toBe(true);
    expect(m.has("c")).toBe(true);
  });

  test("max=1 always replaces", () => {
    const m = new LruMap<string, string>(1);
    m.set("a", "first");
    m.set("b", "second");
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toBe("second");
  });
});
