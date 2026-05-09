/**
 * boot_recovery.test.ts — verify R1 contract.
 *
 * After an unclean shutdown, tasks left in `processing` must either be
 * reset to `pending` (so the watcher's initial scan re-dispatches them)
 * or marked `failed` if `failOnRecover` is set. Tasks within the grace
 * window are left alone in case another instance is concurrently running.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recoverStaleProcessing } from "../boot_recovery";

let inbox = "";

function writeTask(name: string, fm: Record<string, string>, body = "do work"): string {
  const fp = join(inbox, name);
  const lines = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", "", body, ""];
  writeFileSync(fp, lines.join("\n"), "utf8");
  return fp;
}

beforeEach(() => {
  inbox = mkdtempSync(join(tmpdir(), "gzmo-recovery-"));
});

afterEach(() => {
  if (inbox) try { rmSync(inbox, { recursive: true, force: true }); } catch { /* ignore */ }
  inbox = "";
});

describe("recoverStaleProcessing", () => {
  test("no-op on an empty inbox", async () => {
    const r = await recoverStaleProcessing(inbox);
    expect(r.scanned).toBe(0);
    expect(r.recovered.length).toBe(0);
    expect(r.skipped.length).toBe(0);
  });

  test("ignores pending / completed / failed tasks", async () => {
    writeTask("a.md", { status: "pending" });
    writeTask("b.md", { status: "completed", completed_at: new Date().toISOString() });
    writeTask("c.md", { status: "failed", completed_at: new Date().toISOString() });
    const r = await recoverStaleProcessing(inbox);
    expect(r.scanned).toBe(3);
    expect(r.recovered.length).toBe(0);
  });

  test("resets stale processing → pending and clears started_at", async () => {
    const oldIso = new Date(Date.now() - 60_000).toISOString();
    const fp = writeTask("stuck.md", { status: "processing", started_at: oldIso });
    const r = await recoverStaleProcessing(inbox, { graceMs: 30_000 });
    expect(r.recovered).toContain(fp);
    const md = readFileSync(fp, "utf8");
    expect(md).toMatch(/status:\s*pending/);
    // started_at should be cleared so the watcher's next dispatch starts fresh.
    expect(md).not.toMatch(/started_at:/);
    expect(md).toMatch(/recovered_at:/);
  });

  test("respects grace window: recent processing left as-is", async () => {
    const recentIso = new Date(Date.now() - 5_000).toISOString();
    const fp = writeTask("recent.md", { status: "processing", started_at: recentIso });
    const r = await recoverStaleProcessing(inbox, { graceMs: 30_000 });
    expect(r.skipped).toContain(fp);
    expect(r.recovered.length).toBe(0);
    const md = readFileSync(fp, "utf8");
    expect(md).toMatch(/status:\s*processing/);
  });

  test("treats missing started_at as infinitely old (recovers immediately)", async () => {
    const fp = writeTask("orphan.md", { status: "processing" }); // no started_at
    const r = await recoverStaleProcessing(inbox, { graceMs: 30_000 });
    expect(r.recovered).toContain(fp);
  });

  test("failOnRecover: marks failed instead of pending", async () => {
    const oldIso = new Date(Date.now() - 60_000).toISOString();
    const fp = writeTask("dead.md", { status: "processing", started_at: oldIso });
    const r = await recoverStaleProcessing(inbox, { graceMs: 30_000, failOnRecover: true });
    expect(r.recovered).toContain(fp);
    const md = readFileSync(fp, "utf8");
    expect(md).toMatch(/status:\s*failed/);
    expect(md).toContain("Recovered after daemon restart");
  });

  test("returns gracefully when inbox dir does not exist", async () => {
    const r = await recoverStaleProcessing(join(inbox, "nope"));
    expect(r.scanned).toBe(0);
    expect(r.recovered.length).toBe(0);
  });
});
