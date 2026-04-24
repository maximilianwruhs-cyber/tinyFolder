import { describe, expect, test } from "bun:test";
import { resolveVaultPath, VaultPathError } from "../vault_fs";
import { resolve, sep } from "path";

describe("resolveVaultPath", () => {
  const vaultRoot = resolve("/mock/vault/root");

  test("resolves valid path inside vault", () => {
    const target = `some${sep}folder${sep}file.md`;
    const result = resolveVaultPath(vaultRoot, target);
    expect(result.rel).toBe(target);
    expect(result.abs).toBe(resolve(vaultRoot, target));
  });

  test("throws error when traversing outside vault", () => {
    expect(() => resolveVaultPath(vaultRoot, `..${sep}outside${sep}file.md`)).toThrow(VaultPathError);
  });

  test("throws error when accessing raw/ directory", () => {
    expect(() => resolveVaultPath(vaultRoot, `raw${sep}some_file.md`)).toThrow(VaultPathError);
  });
});
