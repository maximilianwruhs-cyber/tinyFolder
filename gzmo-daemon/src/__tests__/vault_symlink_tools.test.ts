/**
 * vault_symlink_tools.test.ts — symlink guards on vault_read / fs_grep / dir_list.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { dirListTool } from "../tools/dir_list";
import { fsGrepTool } from "../tools/fs_grep";
import { vaultReadTool } from "../tools/vault_read";

let vault = "";

function toolCtx(): { vaultPath: string; taskFilePath: string } {
  return { vaultPath: vault, taskFilePath: join(vault, "GZMO", "Inbox", "task.md") };
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "gzmo-symlink-"));
  mkdirSync(join(vault, "GZMO"), { recursive: true });
  writeFileSync(join(vault, "secret.txt"), "outside-vault-secret", "utf8");
  writeFileSync(join(vault, "GZMO", "ok.md"), "# ok\n", "utf8");
});

afterEach(() => {
  if (vault) try { rmSync(vault, { recursive: true, force: true }); } catch { /* ignore */ }
  vault = "";
});

describe("vault tool symlink guards", () => {
  test("vault_read refuses symlink targets", async () => {
    const link = join(vault, "GZMO", "escape.md");
    symlinkSync(join(vault, "secret.txt"), link);
    const r = await vaultReadTool.execute({ path: "GZMO/escape.md" }, toolCtx());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/symlink/i);
  });

  test("fs_grep skips symlinked files", async () => {
    const link = join(vault, "GZMO", "leak.md");
    symlinkSync(join(vault, "secret.txt"), link);
    const r = await fsGrepTool.execute({ pattern: "outside-vault", path: "GZMO" }, toolCtx());
    expect(r.ok).toBe(true);
    expect(r.output).toBe("(no matches)");
  });

  test("dir_list skips symlinked entries", async () => {
    const link = join(vault, "GZMO", "leak.md");
    symlinkSync(join(vault, "secret.txt"), link);
    const r = await dirListTool.execute({ path: "GZMO", recursive: false }, toolCtx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("ok.md");
    expect(r.output).not.toContain("leak.md");
  });
});
