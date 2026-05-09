/**
 * dropzone_dedup.ts — SHA256 dedup index for Dropzone ingests (vault-local JSON).
 */

import { join } from "path";
import { readBoolEnv, readIntEnv } from "./pipelines/helpers";
import { atomicWriteJson } from "./vault_fs";

export const DROPZONE_INDEX_REL = "GZMO/.gzmo_dropzone_index.json";

export interface DropzoneIndexEntry {
  first_seen_at: string;
  rel_wiki: string;
  rel_binary: string;
  original_name: string;
}

export interface DropzoneIndexFile {
  version: 1;
  by_sha256: Record<string, DropzoneIndexEntry>;
}

export function getDropzoneDedupConfig(): { enabled: boolean; maxBytes: number } {
  const convertMax = readIntEnv("GZMO_DROPZONE_CONVERT_MAX_BYTES", 52_428_800, 4096, 200 * 1024 * 1024);
  return {
    enabled: readBoolEnv("GZMO_DROPZONE_DEDUP", true),
    maxBytes: readIntEnv("GZMO_DROPZONE_DEDUP_MAX_BYTES", convertMax, 4096, 200 * 1024 * 1024),
  };
}

export function emptyDropzoneIndex(): DropzoneIndexFile {
  return { version: 1, by_sha256: {} };
}

export async function readDropzoneIndex(vaultPath: string): Promise<DropzoneIndexFile> {
  const abs = join(vaultPath, DROPZONE_INDEX_REL);
  try {
    const raw = await Bun.file(abs).text();
    const j = JSON.parse(raw) as DropzoneIndexFile;
    if (j && j.version === 1 && j.by_sha256 && typeof j.by_sha256 === "object") return j;
  } catch {
    // missing or corrupt
  }
  return emptyDropzoneIndex();
}

export async function writeDropzoneIndex(vaultPath: string, idx: DropzoneIndexFile): Promise<void> {
  await atomicWriteJson(vaultPath, DROPZONE_INDEX_REL, idx);
}

/** Serialize read–merge–write so concurrent drops do not clobber the index (single-user; still worth serializing). */
let indexWriteTail: Promise<void> = Promise.resolve();

/**
 * Read latest index, set `by_sha256[hash] = entry`, write atomically. Chained so concurrent updates merge safely.
 */
export async function mergeDropzoneIndexEntry(
  vaultPath: string,
  hash: string,
  entry: DropzoneIndexEntry,
): Promise<void> {
  const prev = indexWriteTail;
  let release!: () => void;
  indexWriteTail = new Promise<void>((res) => {
    release = res;
  });
  await prev;
  try {
    const idx = await readDropzoneIndex(vaultPath);
    idx.by_sha256[hash] = entry;
    await writeDropzoneIndex(vaultPath, idx);
  } finally {
    release();
  }
}

export function sha256Hex(buf: Uint8Array): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(buf);
  return h.digest("hex");
}
