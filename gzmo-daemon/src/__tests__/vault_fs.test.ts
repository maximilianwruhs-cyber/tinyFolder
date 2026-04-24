import { describe, test, expect } from "bun:test";
import { atomicWriteText } from "../vault_fs";
import { mkdirSync, rmSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("vault_fs", () => {
  describe("atomicWriteText", () => {
    test("rejects when permissions prevent directory creation", async () => {
      const vaultRoot = join(tmpdir(), `gzmo-test-vault-fs-${Date.now()}`);
      mkdirSync(vaultRoot, { recursive: true });

      const readOnlyDir = join(vaultRoot, "readonly");
      mkdirSync(readOnlyDir, { recursive: true });

      // Make read-only (remove write permissions)
      chmodSync(readOnlyDir, 0o555);

      try {
        const targetPath = join("readonly", "subdir", "test.txt");
        await expect(atomicWriteText(vaultRoot, targetPath, "content")).rejects.toThrow();
      } finally {
        // Restore permissions for cleanup
        chmodSync(readOnlyDir, 0o777);
        rmSync(vaultRoot, { recursive: true, force: true });
      }
    });
  });
});
