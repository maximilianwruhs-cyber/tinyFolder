import { describe, expect, it } from "bun:test";
import {
  fileExtensionLower,
  isExtensionConvertible,
  parseExtensionAllowlist,
  type DropzoneConvertConfig,
} from "../dropzone_convert";

describe("parseExtensionAllowlist", () => {
  it("defaults to built-in set when empty", () => {
    const s = parseExtensionAllowlist(undefined);
    expect(s.has("pdf")).toBe(true);
    expect(s.has("docx")).toBe(true);
  });

  it("parses comma-separated extensions", () => {
    const s = parseExtensionAllowlist(" PDF, .DOCX ; html ");
    expect(s.has("pdf")).toBe(true);
    expect(s.has("docx")).toBe(true);
    expect(s.has("html")).toBe(true);
    expect(s.has("txt")).toBe(false);
  });
});

describe("fileExtensionLower", () => {
  it("returns last extension lowercase", () => {
    expect(fileExtensionLower("Foo.BAR.pdf")).toBe("pdf");
    expect(fileExtensionLower("noext")).toBe("");
  });
});

describe("isExtensionConvertible", () => {
  const cfg: DropzoneConvertConfig = {
    enabled: true,
    maxBytes: 1000,
    timeoutMs: 5000,
    extensions: new Set(["pdf"]),
  };

  it("respects enabled and allowlist", () => {
    expect(isExtensionConvertible("pdf", cfg)).toBe(true);
    expect(isExtensionConvertible("docx", cfg)).toBe(false);
    expect(isExtensionConvertible("pdf", { ...cfg, enabled: false })).toBe(false);
  });
});
