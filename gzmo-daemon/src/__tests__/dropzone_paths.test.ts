import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  dropzoneInnerFromAbs,
  logicalDropzoneBinaryRel,
  resolveDropzoneRoot,
} from "../dropzone_paths";

describe("dropzone_paths", () => {
  const vault = mkdtempSync(join(tmpdir(), "gzmo-vault-"));
  const external = mkdtempSync(join(tmpdir(), "gzmo-drop-"));

  beforeEach(() => {
    // gzmo-daemon/.env may set GZMO_DROPZONE_DIR; clear before each assertion.
    delete process.env.GZMO_DROPZONE_DIR;
  });

  afterEach(() => {
    delete process.env.GZMO_DROPZONE_DIR;
  });

  test("default dropzone is under vault", () => {
    expect(resolveDropzoneRoot(vault)).toBe(join(vault, "GZMO", "Dropzone"));
  });

  test("GZMO_DROPZONE_DIR overrides vault location", () => {
    process.env.GZMO_DROPZONE_DIR = external;
    expect(resolveDropzoneRoot(vault)).toBe(external);
  });

  test("inner path from absolute file under external root", () => {
    process.env.GZMO_DROPZONE_DIR = external;
    const root = resolveDropzoneRoot(vault);
    const file = join(root, "invoices", "bill.pdf");
    expect(dropzoneInnerFromAbs(file, root)).toBe("invoices/bill.pdf");
  });

  test("logical binary path stays vault-relative", () => {
    expect(logicalDropzoneBinaryRel("2026__invoice.pdf")).toBe(
      "GZMO/Dropzone/files/2026__invoice.pdf",
    );
  });

  test("rejects relative GZMO_DROPZONE_DIR", () => {
    process.env.GZMO_DROPZONE_DIR = "relative/path";
    expect(() => resolveDropzoneRoot(vault)).toThrow(/absolute/);
  });

  test("cleanup", () => {
    rmSync(vault, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  });
});
