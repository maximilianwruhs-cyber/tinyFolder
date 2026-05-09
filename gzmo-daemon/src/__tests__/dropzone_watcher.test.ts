import { describe, expect, it, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  dropzoneRelHasDotSegment,
  handleDropzoneFile,
  isReservedInnerDropzonePath,
  sanitizeDropzoneBaseName,
  scanDropzoneOnBoot,
  wikiSlugFromDropzoneInner,
} from "../dropzone_watcher";

describe("sanitizeDropzoneBaseName", () => {
  test("strips extension and unsafe chars", () => {
    expect(sanitizeDropzoneBaseName("My Notes!.md")).toBe("My-Notes");
  });

  test("empty-ish name becomes drop", () => {
    expect(sanitizeDropzoneBaseName("!!!")).toBe("drop");
  });
});

describe("isReservedInnerDropzonePath", () => {
  test("root daemon dirs only", () => {
    expect(isReservedInnerDropzonePath("_processed/a.md")).toBe(true);
    expect(isReservedInnerDropzonePath("files/x.bin")).toBe(true);
    expect(isReservedInnerDropzonePath("customer/files/readme.md")).toBe(false);
    expect(isReservedInnerDropzonePath("customer/_tmp/notes.txt")).toBe(false);
  });
});

describe("dropzoneRelHasDotSegment", () => {
  test("detects hidden path segments", () => {
    expect(dropzoneRelHasDotSegment("a/.git/config")).toBe(true);
    expect(dropzoneRelHasDotSegment("a/b/c")).toBe(false);
  });
});

describe("wikiSlugFromDropzoneInner", () => {
  test("disambiguates nested same basename", () => {
    const a = wikiSlugFromDropzoneInner("cust-a/readme.md", "readme.md");
    const b = wikiSlugFromDropzoneInner("cust-b/readme.md", "readme.md");
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("nested dropzone ingest", () => {
  it("handleDropzoneFile processes file under nested customer path", async () => {
    const vault = await mkdtemp(join(tmpdir(), "gzmo-dz-nest-"));
    try {
      await mkdir(join(vault, "GZMO", "Inbox"), { recursive: true });
      const nested = join(vault, "GZMO", "Dropzone", "customer-a", "invoices");
      await mkdir(nested, { recursive: true });
      await mkdir(join(vault, "wiki", "incoming"), { recursive: true });
      const f = join(nested, "note.txt");
      await writeFile(f, "nested hello\n");
      const deps = { vaultPath: vault, inboxPath: join(vault, "GZMO", "Inbox"), log: () => {} };
      await handleDropzoneFile(f, deps);
      const inbox = await readdir(join(vault, "GZMO", "Inbox"));
      expect(inbox.some((n) => n.startsWith("__dropzone_followup__"))).toBe(true);
      const stored = await readdir(join(vault, "GZMO", "Dropzone", "files"));
      expect(stored.length).toBeGreaterThan(0);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });

  it("scanDropzoneOnBoot walks nested files", async () => {
    const vault = await mkdtemp(join(tmpdir(), "gzmo-dz-boot-"));
    try {
      await mkdir(join(vault, "GZMO", "Inbox"), { recursive: true });
      const nested = join(vault, "GZMO", "Dropzone", "bundle", "deep");
      await mkdir(nested, { recursive: true });
      await mkdir(join(vault, "wiki", "incoming"), { recursive: true });
      await writeFile(join(nested, "x.txt"), "boot scan\n");
      const deps = { vaultPath: vault, inboxPath: join(vault, "GZMO", "Inbox"), log: () => {} };
      await scanDropzoneOnBoot(deps);
      const inbox = await readdir(join(vault, "GZMO", "Inbox"));
      expect(inbox.some((n) => n.startsWith("__dropzone_followup__"))).toBe(true);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });
});
