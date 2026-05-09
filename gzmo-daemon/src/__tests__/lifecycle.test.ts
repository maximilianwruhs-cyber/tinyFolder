import { describe, expect, test } from "bun:test";
import { makeAbortSignal } from "../lifecycle";

describe("makeAbortSignal", () => {
  test("times out via timeoutMs", async () => {
    const sig = makeAbortSignal({ timeoutMs: 30, honorDaemonAbort: false });
    await new Promise((r) => setTimeout(r, 80));
    expect(sig.aborted).toBe(true);
  });

  test("aborts when caller signal aborts", () => {
    const ac = new AbortController();
    const sig = makeAbortSignal({ signal: ac.signal, honorDaemonAbort: false });
    expect(sig.aborted).toBe(false);
    ac.abort();
    expect(sig.aborted).toBe(true);
  });

  test("returns the single source signal directly when only one is requested", () => {
    const ac = new AbortController();
    const sig = makeAbortSignal({ signal: ac.signal, honorDaemonAbort: false });
    // Same identity — composition skipped when there's nothing to compose.
    expect(sig).toBe(ac.signal);
  });

  test("composes daemonAbort + caller + timeout into one signal", () => {
    const ac = new AbortController();
    const sig = makeAbortSignal({ signal: ac.signal, timeoutMs: 1000 });
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig.aborted).toBe(false);
  });
});
