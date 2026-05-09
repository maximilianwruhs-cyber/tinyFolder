/**
 * atomic_write.ts — Cross-platform atomic file write.
 *
 * Writes content to a temp file in the target directory, then renames it
 * into place. On POSIX, rename() within a single filesystem is atomic, so
 * concurrent readers either see the old file or the fully written new one.
 */

import { promises as fsp } from "fs";
import path from "path";
import crypto from "crypto";

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`,
  );
  const fh = await fsp.open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(content, "utf8");
    try {
      await fh.sync();
    } catch {
      // sync may fail on some filesystems; rename below is still atomic.
    }
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, filePath);
}
