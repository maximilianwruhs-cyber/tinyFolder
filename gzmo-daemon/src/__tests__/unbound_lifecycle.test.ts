/**
 * unbound_lifecycle.test.ts — clarification-first task status (GAH / DSJ support).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TaskDocument } from "../frontmatter";
import { recoverStaleProcessing } from "../boot_recovery";

let inbox = "";

function writeTask(name: string, fm: Record<string, string>, body = "query"): string {
  const fp = join(inbox, name);
  const lines = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", "", body, ""];
  writeFileSync(fp, lines.join("\n"), "utf8");
  return fp;
}

beforeEach(() => {
  inbox = mkdtempSync(join(tmpdir(), "gzmo-unbound-"));
});

afterEach(() => {
  if (inbox) try { rmSync(inbox, { recursive: true, force: true }); } catch { /* ignore */ }
  inbox = "";
});

describe("TaskDocument.markUnbound", () => {
  test("writes unbound status and clarification block", async () => {
    const fp = writeTask("halt.md", { status: "processing", action: "search" });
    const doc = await TaskDocument.load(fp);
    expect(doc).not.toBeNull();
    await doc!.markUnbound("Need more context about X.", { haltReason: "test_halt", issueType: "ISSUE" });

    const md = readFileSync(fp, "utf8");
    expect(md).toMatch(/status:\s*unbound/);
    expect(md).toMatch(/## ⏸️ GZMO Needs Clarification/);
    expect(md).toMatch(/Need more context about X/);
    expect(md).toMatch(/type:\s*ISSUE/);
    expect(md).toMatch(/halt_reason:\s*test_halt/);
  });

  test("replaces prior clarification block on re-halt", async () => {
    const fp = writeTask("twice.md", { status: "processing", action: "search" });
    const doc = (await TaskDocument.load(fp))!;
    await doc.markUnbound("First question.");
    await doc.markUnbound("Second question.");
    const md = readFileSync(fp, "utf8");
    const matches = md.match(/## ⏸️ GZMO Needs Clarification/g) ?? [];
    expect(matches.length).toBe(1);
    expect(md).toMatch(/Second question/);
    expect(md).not.toMatch(/First question/);
  });

  test("markPendingRecovered leaves unbound alone", async () => {
    const fp = writeTask("wait.md", { status: "unbound", unbound_at: new Date().toISOString() });
    const doc = (await TaskDocument.load(fp))!;
    await doc.markPendingRecovered();
    const md = readFileSync(fp, "utf8");
    expect(md).toMatch(/status:\s*unbound/);
  });

  test("markPendingRecovered resets processing only", async () => {
    const oldIso = new Date(Date.now() - 60_000).toISOString();
    const fp = writeTask("stuck.md", { status: "processing", started_at: oldIso });
    const doc = (await TaskDocument.load(fp))!;
    await doc.markPendingRecovered();
    const md = readFileSync(fp, "utf8");
    expect(md).toMatch(/status:\s*pending/);
  });
});

describe("recoverStaleProcessing with unbound", () => {
  test("does not touch unbound tasks", async () => {
    writeTask("u.md", { status: "unbound", unbound_at: new Date().toISOString() });
    const r = await recoverStaleProcessing(inbox);
    expect(r.scanned).toBe(1);
    expect(r.recovered.length).toBe(0);
    const md = readFileSync(join(inbox, "u.md"), "utf8");
    expect(md).toMatch(/status:\s*unbound/);
  });
});
