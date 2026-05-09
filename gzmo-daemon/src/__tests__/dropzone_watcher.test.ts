import { describe, expect, test } from "bun:test";
import { sanitizeDropzoneBaseName } from "../dropzone_watcher";

describe("sanitizeDropzoneBaseName", () => {
  test("strips extension and unsafe chars", () => {
    expect(sanitizeDropzoneBaseName("My Notes!.md")).toBe("My-Notes");
  });

  test("empty-ish name becomes drop", () => {
    expect(sanitizeDropzoneBaseName("!!!")).toBe("drop");
  });
});
