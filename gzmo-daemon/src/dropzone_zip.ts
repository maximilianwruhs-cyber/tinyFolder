/**
 * dropzone_zip.ts — Opt-in ZIP handling for Dropzone (Zip Slip safe, bounded).
 *
 * Opens the archive from disk path (streaming); picks the first inner file whose
 * extension is in the convert allowlist.
 */

import * as yauzl from "yauzl";
import { basename } from "path";
import { readBoolEnv, readIntEnv } from "./pipelines/helpers";
import { fileExtensionLower } from "./dropzone_convert";

export interface DropzoneZipConfig {
  enabled: boolean;
  /** Max outer .zip file size to attempt (bytes) */
  maxZipBytes: number;
  maxEntriesScanned: number;
  maxEntryUncompressedBytes: number;
  maxCompressionRatio: number;
}

export function getDropzoneZipConfig(): DropzoneZipConfig {
  return {
    enabled: readBoolEnv("GZMO_DROPZONE_ZIP", false),
    maxZipBytes: readIntEnv("GZMO_DROPZONE_ZIP_MAX_BYTES", 104_857_600, 1024, 500 * 1024 * 1024),
    maxEntriesScanned: readIntEnv("GZMO_DROPZONE_ZIP_MAX_ENTRIES", 512, 1, 65_535),
    maxEntryUncompressedBytes: readIntEnv(
      "GZMO_DROPZONE_ZIP_MAX_ENTRY_BYTES",
      52_428_800,
      1024,
      200 * 1024 * 1024,
    ),
    maxCompressionRatio: readIntEnv("GZMO_DROPZONE_ZIP_MAX_RATIO", 100, 2, 1000),
  };
}

/** Reject absolute paths, "..", NUL (yauzl validates path segments). */
export function isSafeZipEntryName(name: string): boolean {
  if (!name || name.includes("\0")) return false;
  return yauzl.validateFileName(name) === null;
}

function readNextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (e: yauzl.Entry) => {
      cleanup();
      resolve(e);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onErr = (e: Error) => {
      cleanup();
      reject(e);
    };
    function cleanup() {
      zip.removeListener("entry", onEntry);
      zip.removeListener("end", onEnd);
      zip.removeListener("error", onErr);
    }
    zip.once("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onErr);
    zip.readEntry();
  });
}

function readEntryToBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("zip_open_read_stream"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on("data", (c: Buffer) => {
        total += c.length;
        if (total > maxBytes) {
          stream.destroy();
          reject(new Error("zip_entry_stream_over_max"));
          return;
        }
        chunks.push(c);
      });
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error", reject);
    });
  });
}

/**
 * yauzl.open defaults autoClose to true: the fd is released when entry read streams finish
 * or on fatal errors. We still call zip.close() in pickConvertibleZipMember's finally so an
 * early return (first matching inner file) does not leave the archive half-open.
 */
function openZipFromPath(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (err, zf) => {
        if (err || !zf) reject(err ?? new Error("zip_open_failed"));
        else resolve(zf);
      },
    );
  });
}

/**
 * First inner file matching `extensions` (lowercase, no dot). Returns null if none.
 */
export async function pickConvertibleZipMember(
  zipPath: string,
  extensions: Set<string>,
  cfg: DropzoneZipConfig,
): Promise<{ memberPath: string; buffer: Uint8Array; ext: string } | null> {
  const zip = await openZipFromPath(zipPath);
  try {
    let scanned = 0;
    while (scanned < cfg.maxEntriesScanned) {
      let entry: yauzl.Entry | null;
      try {
        entry = await readNextEntry(zip);
      } catch {
        // e.g. strictFileNames rejects Zip Slip / invalid central-directory names
        return null;
      }
      if (!entry) break;
      scanned++;
      if (/\/$/.test(entry.fileName)) continue;
      const base = basename(entry.fileName);
      if (base === ".DS_Store" || entry.fileName.startsWith("__MACOSX/")) continue;
      if (!isSafeZipEntryName(entry.fileName)) continue;

      const usize = entry.uncompressedSize;
      if (usize === 0xffffffff || usize > cfg.maxEntryUncompressedBytes) continue;

      const csize = entry.compressedSize;
      if (csize > 0 && usize / csize > cfg.maxCompressionRatio) continue;

      const ext = fileExtensionLower(base);
      if (!extensions.has(ext)) continue;

      try {
        const buffer = await readEntryToBuffer(zip, entry, cfg.maxEntryUncompressedBytes);
        return { memberPath: entry.fileName, buffer, ext };
      } catch {
        continue;
      }
    }
    return null;
  } finally {
    try {
      zip.close();
    } catch {
      // ignore
    }
  }
}
