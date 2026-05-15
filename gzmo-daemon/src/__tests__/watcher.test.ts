/**
 * watcher.test.ts — VaultWatcher dispatches pending inbox tasks.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { VaultWatcher, type TaskEvent } from "../watcher";

let inbox = "";
let watcher: VaultWatcher | null = null;

function writePendingTask(name: string, body = "hello from watcher test"): void {
  const fp = join(inbox, name);
  const md = ["---", "status: pending", "action: think", "---", "", body, ""].join("\n");
  writeFileSync(fp, md, "utf8");
}

beforeEach(() => {
  inbox = mkdtempSync(join(tmpdir(), "gzmo-watcher-"));
});

afterEach(async () => {
  if (watcher) {
    await watcher.stop();
    watcher = null;
  }
  if (inbox) try { rmSync(inbox, { recursive: true, force: true }); } catch { /* ignore */ }
  inbox = "";
});

describe("VaultWatcher", () => {
  test("emits task event for a new pending .md file", async () => {
    watcher = new VaultWatcher(inbox, 80);
    const seen = new Promise<TaskEvent>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for task event")), 5000);
      watcher!.once("task", (ev) => {
        clearTimeout(t);
        resolve(ev);
      });
    });
    watcher.start();
    writePendingTask("dispatch-me.md");

    const ev = await seen;
    expect(ev.fileName).toBe("dispatch-me");
    expect(ev.status).toBe("pending");
    expect(ev.body).toContain("hello from watcher test");
    expect(ev.document.status).toBe("pending");
  });

  test("does not emit for completed tasks", async () => {
    watcher = new VaultWatcher(inbox, 80);
    let count = 0;
    watcher.on("task", () => {
      count++;
    });
    watcher.start();
    const fp = join(inbox, "done.md");
    writeFileSync(
      fp,
      ["---", "status: completed", "action: think", "completed_at: 2020-01-01T00:00:00.000Z", "---", "", "done", ""].join(
        "\n",
      ),
      "utf8",
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(count).toBe(0);
  });

  test("lockFile prevents re-dispatch while locked", async () => {
    watcher = new VaultWatcher(inbox, 80);
    const fp = join(inbox, "locked.md");
    writePendingTask("locked.md");
    let count = 0;
    watcher.on("task", () => {
      count++;
    });
    watcher.start();
    await new Promise((r) => setTimeout(r, 300));
    watcher.lockFile(fp);
    writeFileSync(fp, ["---", "status: pending", "action: think", "---", "", "updated body", ""].join("\n"), "utf8");
    await new Promise((r) => setTimeout(r, 400));
    expect(count).toBeLessThanOrEqual(1);
    watcher.unlockFile(fp);
  });
});
