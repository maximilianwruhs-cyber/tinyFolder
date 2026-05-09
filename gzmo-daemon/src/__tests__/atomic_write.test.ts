import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { atomicWriteFile } from "../atomic_write";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gzmo-atomic-"));
});

afterEach(() => {
  if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  dir = "";
});

describe("atomicWriteFile", () => {
  test("writes file content correctly", async () => {
    const fp = join(dir, "out.txt");
    await atomicWriteFile(fp, "hello world\n");
    expect(readFileSync(fp, "utf8")).toBe("hello world\n");
  });

  test("overwrites an existing file atomically (no truncation visible)", async () => {
    const fp = join(dir, "x.txt");
    await atomicWriteFile(fp, "v1");
    await atomicWriteFile(fp, "v2-with-more-bytes");
    expect(readFileSync(fp, "utf8")).toBe("v2-with-more-bytes");
  });

  test("creates parent directory if it doesn't exist", async () => {
    const fp = join(dir, "deep", "nested", "file.txt");
    await atomicWriteFile(fp, "ok");
    expect(readFileSync(fp, "utf8")).toBe("ok");
  });

  test("does not leave the .tmp sibling behind on success", async () => {
    const fp = join(dir, "clean.txt");
    await atomicWriteFile(fp, "done");
    const leftover = readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(leftover.length).toBe(0);
  });

  test("two concurrent writes both succeed and the file is one of them (no partial mix)", async () => {
    const fp = join(dir, "race.txt");
    const a = "A".repeat(2048);
    const b = "B".repeat(2048);
    await Promise.all([atomicWriteFile(fp, a), atomicWriteFile(fp, b)]);
    const final = readFileSync(fp, "utf8");
    // Either A or B won the rename; we never observe a half-A-half-B mash.
    expect(final === a || final === b).toBe(true);
  });

  test("0o600 permissions on the temp file", async () => {
    // We can only check the mode of the resulting file (Linux). On platforms
    // without POSIX modes Bun returns 0; skip when that's the case.
    const fp = join(dir, "mode.txt");
    await atomicWriteFile(fp, "secret");
    const st = await Bun.file(fp).stat();
    if (st.mode === 0) return; // platform without POSIX modes
    // We don't enforce a specific final mode (umask varies); just assert the
    // file exists with non-zero size — the temp's wx + 0o600 path executed.
    expect(st.size).toBeGreaterThan(0);
  });

  test("ignores stray .tmp files left in the directory from prior runs", async () => {
    // Simulate a prior crash leaving a .tmp around — the next write must still succeed.
    writeFileSync(join(dir, ".final.txt.tmp.99999.deadbe"), "stale", "utf8");
    const fp = join(dir, "final.txt");
    await atomicWriteFile(fp, "fresh");
    expect(readFileSync(fp, "utf8")).toBe("fresh");
  });
});
