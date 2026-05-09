/**
 * boot_recovery.ts — recover from unclean shutdowns.
 *
 * On every daemon boot, scan the inbox for tasks that were left in
 * `status: processing` because the previous process was killed mid-task
 * (SIGKILL, OOM, host crash, etc). Without this, those tasks stay frozen
 * forever because the watcher only dispatches `pending` files.
 *
 * Default policy: reset to `pending` so the watcher can re-run the task
 * after the boot completes. Tasks with a recent `started_at` (within the
 * grace window) are left alone in case another instance is genuinely
 * running concurrently. If `failOnRecover` is set, files are instead
 * marked `failed` with a "daemon restart" note.
 */

import { promises as fsp } from "fs";
import { join } from "path";
import { TaskDocument } from "./frontmatter";

export interface RecoverStaleOptions {
  /** Don't reset tasks whose started_at is newer than this many ms. Defaults to 30_000. */
  graceMs?: number;
  /** If true, mark failed instead of resetting to pending. Defaults to false. */
  failOnRecover?: boolean;
  /** Override the clock for tests. */
  now?: () => number;
}

export interface RecoverStaleResult {
  scanned: number;
  recovered: string[]; // file paths
  skipped: string[]; // file paths within the grace window
}

export async function recoverStaleProcessing(
  inboxPath: string,
  opts: RecoverStaleOptions = {},
): Promise<RecoverStaleResult> {
  const graceMs = opts.graceMs ?? 30_000;
  const now = opts.now ?? Date.now;

  const result: RecoverStaleResult = { scanned: 0, recovered: [], skipped: [] };

  let entries: string[];
  try {
    entries = await fsp.readdir(inboxPath);
  } catch {
    return result;
  }

  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const fp = join(inboxPath, f);
    const doc = await TaskDocument.load(fp);
    if (!doc) continue;
    result.scanned++;
    if (doc.status !== "processing") continue;

    // The yaml package (like the gray-matter→js-yaml stack we used to ship)
    // auto-parses ISO timestamps into Date instances, so the YAML value can
    // arrive as either a string or a Date depending on how the file was
    // written. Handle both — and treat anything else as "missing", which
    // forces immediate recovery.
    // The TaskFrontmatter type narrows started_at to `string | undefined`
    // even though the runtime value can be a Date; widen via `unknown` so
    // the runtime check actually compiles under strict mode.
    const startedAtRaw: unknown = doc.frontmatter.started_at;
    let startedAtMs = NaN;
    if (typeof startedAtRaw === "string") {
      startedAtMs = Date.parse(startedAtRaw);
    } else if (startedAtRaw instanceof Date) {
      startedAtMs = startedAtRaw.getTime();
    }
    const ageMs = Number.isFinite(startedAtMs) ? now() - startedAtMs : Number.POSITIVE_INFINITY;

    if (ageMs < graceMs) {
      result.skipped.push(fp);
      continue;
    }

    try {
      if (opts.failOnRecover) {
        await doc.markFailed(
          `Recovered after daemon restart (was 'processing' for ${Math.round(ageMs / 1000)}s).`,
        );
      } else {
        await doc.markPendingRecovered(new Date(now()));
      }
      result.recovered.push(fp);
    } catch {
      // Best effort: a file we couldn't recover stays as-is and shows up in health counts.
    }
  }

  return result;
}
