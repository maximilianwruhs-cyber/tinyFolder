import { describe, expect, test } from "bun:test";
import { resolveVaultPath, VaultPathError } from "../vault_fs";
import { resolve, sep } from "path";

describe("vault_fs resolveVaultPath", () => {
  const vaultRoot = "/mock/vault/root";

  test("allows valid paths inside the vault", () => {
    const result1 = resolveVaultPath(vaultRoot, "valid.txt");
    expect(result1.rel).toBe("valid.txt");
    expect(result1.abs).toBe(resolve(vaultRoot, "valid.txt"));

    const result2 = resolveVaultPath(vaultRoot, `nested${sep}folder${sep}file.json`);
    expect(result2.rel).toBe(`nested${sep}folder${sep}file.json`);
    expect(result2.abs).toBe(resolve(vaultRoot, `nested${sep}folder${sep}file.json`));
  });

  test("throws VaultPathError for path traversal attempts", () => {
    expect(() => resolveVaultPath(vaultRoot, "../outside.txt")).toThrow(VaultPathError);
    expect(() => resolveVaultPath(vaultRoot, "../../etc/passwd")).toThrow(VaultPathError);
    expect(() => resolveVaultPath(vaultRoot, "nested/../../outside.txt")).toThrow(VaultPathError);
    expect(() => resolveVaultPath(vaultRoot, "/absolute/path/outside")).toThrow(VaultPathError);
  });

  test("throws VaultPathError for attempts to write to raw/", () => {
    expect(() => resolveVaultPath(vaultRoot, "raw")).toThrow(VaultPathError);
    expect(() => resolveVaultPath(vaultRoot, "raw/")).toThrow(VaultPathError);
    expect(() => resolveVaultPath(vaultRoot, "raw/data.txt")).toThrow(VaultPathError);
    expect(() => resolveVaultPath(vaultRoot, "raw/nested/file.json")).toThrow(VaultPathError);
  });
});
