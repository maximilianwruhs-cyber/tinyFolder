/**
 * log_rotation.test.ts — verify R5 size-based rotation in safeAppendJsonl.
 *
 * Threshold and keep-count come from env each call, so we can drive the test
 * with tiny limits and confirm the rotation chain is shifted correctly.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { safeAppendJsonl } from "../vault_fs";

let vault = "";

function seed(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf8");
}
const original: Partial<Record<string, string | undefined>> = {};

function snap() {
  for (const k of ["GZMO_LOG_ROTATE_MB", "GZMO_LOG_KEEP"]) original[k] = process.env[k];
}
function restore() {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "gzmo-rotate-"));
  snap();
});

afterEach(() => {
  restore();
  if (vault) try { rmSync(vault, { recursive: true, force: true }); } catch { /* ignore */ }
  vault = "";
});

describe("safeAppendJsonl rotation", () => {
  test("does not rotate small files (default threshold)", async () => {
    const target = "GZMO/perf.jsonl";
    await safeAppendJsonl(vault, target, { msg: "small" });
    expect(existsSync(join(vault, target + ".1"))).toBe(false);
  });

  test("rotates when file exceeds GZMO_LOG_ROTATE_MB threshold", async () => {
    // Use a fractional MB via direct override of internal threshold by setting
    // GZMO_LOG_ROTATE_MB=1 and pre-filling the file with > 1MB of garbage.
    process.env.GZMO_LOG_ROTATE_MB = "1";
    process.env.GZMO_LOG_KEEP = "3";
    const target = "GZMO/perf.jsonl";
    const abs = join(vault, target);
    // Write 1.2 MB of stale content so the next append triggers rotation.
    const fill = "x".repeat(1024) + "\n";
    let body = "";
    while (body.length < 1.2 * 1024 * 1024) body += fill;
    seed(abs, body);
    expect(statSync(abs).size).toBeGreaterThan(1024 * 1024);

    await safeAppendJsonl(vault, target, { msg: "first-after-rotate" });

    // After rotation: original moved to .1; new file contains only the just-appended line.
    expect(existsSync(abs + ".1")).toBe(true);
    const newContent = readFileSync(abs, "utf8");
    expect(newContent).toBe(JSON.stringify({ msg: "first-after-rotate" }) + "\n");
  });

  test("respects GZMO_LOG_KEEP cap (oldest roll dropped)", async () => {
    process.env.GZMO_LOG_ROTATE_MB = "1";
    process.env.GZMO_LOG_KEEP = "2";
    const target = "GZMO/perf.jsonl";
    const abs = join(vault, target);
    // Pre-existing rolls: .1 (newer), .2 (oldest). We expect .2 to be deleted on next rotation.
    const fill = "y".repeat(2 * 1024 * 1024); // 2 MB, definitely over 1 MB
    seed(abs, fill);
    writeFileSync(abs + ".1", "old-1", "utf8");
    writeFileSync(abs + ".2", "old-2", "utf8");

    await safeAppendJsonl(vault, target, { tick: 1 });

    expect(readFileSync(abs + ".2", "utf8")).toBe("old-1"); // .1 moved to .2
    expect(readFileSync(abs + ".1", "utf8").startsWith(fill.slice(0, 32))).toBe(true); // current → .1
    expect(existsSync(abs + ".3")).toBe(false); // keep cap honoured
  });

  test("GZMO_LOG_ROTATE_MB=0 disables rotation entirely", async () => {
    process.env.GZMO_LOG_ROTATE_MB = "0";
    const target = "GZMO/perf.jsonl";
    const abs = join(vault, target);
    seed(abs, "x".repeat(5 * 1024 * 1024));
    await safeAppendJsonl(vault, target, { tick: 1 });
    expect(existsSync(abs + ".1")).toBe(false); // never rotated
  });
});
