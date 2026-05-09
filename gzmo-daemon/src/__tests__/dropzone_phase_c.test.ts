import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { strToU8, zipSync } from "fflate";
import {
  emptyDropzoneIndex,
  mergeDropzoneIndexEntry,
  readDropzoneIndex,
  sha256Hex,
  writeDropzoneIndex,
} from "../dropzone_dedup";
import { isSafeZipEntryName, pickConvertibleZipMember, type DropzoneZipConfig } from "../dropzone_zip";
import { handleDropzoneFile } from "../dropzone_watcher";

function zipFixture(files: Record<string, string | Uint8Array>): Uint8Array {
  const z: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) {
    z[k] = typeof v === "string" ? strToU8(v) : v;
  }
  return zipSync(z);
}

const tightRatioCfg: DropzoneZipConfig = {
  enabled: true,
  maxZipBytes: 50_000_000,
  maxEntriesScanned: 64,
  maxEntryUncompressedBytes: 5_000_000,
  maxCompressionRatio: 4,
};

describe("dropzone_dedup", () => {
  it("sha256Hex is stable for known input", () => {
    const h = sha256Hex(new TextEncoder().encode("gzmo"));
    expect(h).toHaveLength(64);
    expect(h).toBe(sha256Hex(new TextEncoder().encode("gzmo")));
  });

  it("read/write index round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gzmo-dz-"));
    try {
      const idx = emptyDropzoneIndex();
      idx.by_sha256["abc"] = {
        first_seen_at: "2026-01-01T00:00:00.000Z",
        rel_wiki: "wiki/incoming/a.md",
        rel_binary: "GZMO/Dropzone/files/a.bin",
        original_name: "a.bin",
      };
      await writeDropzoneIndex(dir, idx);
      const back = await readDropzoneIndex(dir);
      expect(back.by_sha256["abc"]?.rel_wiki).toBe("wiki/incoming/a.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("mergeDropzoneIndexEntry chains without dropping sibling keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gzmo-dz-merge-"));
    try {
      await mergeDropzoneIndexEntry(dir, "aa", {
        first_seen_at: "2026-01-01T00:00:00.000Z",
        rel_wiki: "wiki/incoming/a.md",
        rel_binary: "GZMO/Dropzone/files/a",
        original_name: "a",
      });
      await mergeDropzoneIndexEntry(dir, "bb", {
        first_seen_at: "2026-01-02T00:00:00.000Z",
        rel_wiki: "wiki/incoming/b.md",
        rel_binary: "GZMO/Dropzone/files/b",
        original_name: "b",
      });
      const back = await readDropzoneIndex(dir);
      expect(back.by_sha256["aa"]?.rel_wiki).toBe("wiki/incoming/a.md");
      expect(back.by_sha256["bb"]?.rel_wiki).toBe("wiki/incoming/b.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("dropzone_zip isSafeZipEntryName", () => {
  it("accepts normal relative paths", () => {
    expect(isSafeZipEntryName("doc/report.pdf")).toBe(true);
  });

  it("rejects traversal and absolute", () => {
    expect(isSafeZipEntryName("../evil")).toBe(false);
    expect(isSafeZipEntryName("/etc/passwd")).toBe(false);
    expect(isSafeZipEntryName("a/../../b")).toBe(false);
  });
});

describe("pickConvertibleZipMember", () => {
  it("returns null for Zip Slip style entry names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gzmo-dz-zip-"));
    try {
      const zipPath = join(dir, "slip.zip");
      const bytes = zipFixture({ "../../../evil.txt": strToU8("x") });
      await writeFile(zipPath, bytes);
      const m = await pickConvertibleZipMember(zipPath, new Set(["txt"]), tightRatioCfg);
      expect(m).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when compression ratio exceeds cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gzmo-dz-zip2-"));
    try {
      const zipPath = join(dir, "ratio.zip");
      const big = new Uint8Array(400_000);
      const bytes = zipFixture({ "zeros.txt": big });
      await writeFile(zipPath, bytes);
      const m = await pickConvertibleZipMember(zipPath, new Set(["txt"]), tightRatioCfg);
      expect(m).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when uncompressed entry exceeds maxEntryUncompressedBytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gzmo-dz-zip3-"));
    try {
      const zipPath = join(dir, "big.zip");
      const cfg: DropzoneZipConfig = {
        ...tightRatioCfg,
        maxEntryUncompressedBytes: 50,
        maxCompressionRatio: 1000,
      };
      const bytes = zipFixture({ "huge.txt": strToU8("x".repeat(200)) });
      await writeFile(zipPath, bytes);
      const m = await pickConvertibleZipMember(zipPath, new Set(["txt"]), cfg);
      expect(m).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("extracts first matching inner .txt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gzmo-dz-zip4-"));
    try {
      const zipPath = join(dir, "ok.zip");
      const cfg: DropzoneZipConfig = {
        ...tightRatioCfg,
        maxCompressionRatio: 200,
        maxEntryUncompressedBytes: 10_000,
      };
      const bytes = zipFixture({ "readme.txt": strToU8("hello-zip") });
      await writeFile(zipPath, bytes);
      const m = await pickConvertibleZipMember(zipPath, new Set(["txt"]), cfg);
      expect(m).not.toBeNull();
      expect(m?.ext).toBe("txt");
      expect(new TextDecoder().decode(m!.buffer)).toContain("hello-zip");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("handleDropzoneFile dedup", () => {
  it("second identical file produces dropzone-duplicate-ref", async () => {
    const vault = await mkdtemp(join(tmpdir(), "gzmo-dz-int-"));
    try {
      await mkdir(join(vault, "GZMO", "Inbox"), { recursive: true });
      await mkdir(join(vault, "GZMO", "Dropzone"), { recursive: true });
      await mkdir(join(vault, "wiki", "incoming"), { recursive: true });
      const deps = { vaultPath: vault, inboxPath: join(vault, "GZMO", "Inbox"), log: () => {} };

      const f1 = join(vault, "GZMO", "Dropzone", "a.txt");
      await writeFile(f1, "identical-bytes\n");
      await handleDropzoneFile(f1, deps);

      const f2 = join(vault, "GZMO", "Dropzone", "b.txt");
      await writeFile(f2, "identical-bytes\n");
      await handleDropzoneFile(f2, deps);

      const wikiDir = join(vault, "wiki", "incoming");
      const names = await readdir(wikiDir);
      const texts = await Promise.all(names.map((n) => Bun.file(join(wikiDir, n)).text()));
      expect(texts.some((t) => t.includes("dropzone-converted"))).toBe(true);
      expect(texts.some((t) => t.includes("dropzone-duplicate-ref"))).toBe(true);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  });
});
