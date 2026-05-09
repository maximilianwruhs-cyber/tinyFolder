/**
 * dropzone_watcher.ts — Watch GZMO/Dropzone/ for arbitrary files (recursive under the drop root).
 *
 * - Valid pending GZMO task .md → move into GZMO/Inbox/
 * - Other .md → copy into wiki/incoming/ + optional follow-up search task
 * - Non-.md → optional local convert → wiki/incoming + stored copy under files/; else stub + follow-up search task
 *
 * Skips only root-level daemon dirs `_processed/`, `_failed/`, `files/`, `_tmp/` and any path with a `.-` segment.
 */

import { watch, type FSWatcher } from "chokidar";
import { basename, dirname, join, relative, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { copyFile, lstat, readdir, rename, unlink } from "fs/promises";
import matter from "./yaml_frontmatter";
import { TaskDocument } from "./frontmatter";
import { safeWriteText } from "./vault_fs";
import {
  convertDropzoneBuffer,
  fileExtensionLower,
  getDropzoneConvertConfig,
  isExtensionConvertible,
} from "./dropzone_convert";
import { getDropzoneDedupConfig, mergeDropzoneIndexEntry, readDropzoneIndex, sha256Hex } from "./dropzone_dedup";
import { getDropzoneZipConfig, pickConvertibleZipMember } from "./dropzone_zip";

export function sanitizeDropzoneBaseName(name: string): string {
  const base = basename(name).replace(/\.[^.]+$/, "");
  return base
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "drop";
}

/** Path under `GZMO/Dropzone/` (no prefix), POSIX slashes. */
const DROPZONE_INNER_RESERVED = new Set(["_processed", "_failed", "files", "_tmp"]);

/**
 * True when `inner` is entirely under daemon-owned subtrees at the **root** of Dropzone
 * (`_processed/`, `_failed/`, `files/`, `_tmp/`). Nested folders like `customer/files/readme.md`
 * are not reserved.
 */
export function isReservedInnerDropzonePath(inner: string): boolean {
  const norm = inner.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm) return false;
  const first = norm.split("/")[0] ?? "";
  return DROPZONE_INNER_RESERVED.has(first);
}

/** Skip ingest for dotfile / dot-dir segments anywhere in the relative path. */
export function dropzoneRelHasDotSegment(inner: string): boolean {
  return inner.split("/").some((seg) => seg.length > 0 && seg.startsWith("."));
}

/** Wiki slug from path under Dropzone so nested `.../same-name.md` files do not collide. */
export function wikiSlugFromDropzoneInner(inner: string, fileName: string): string {
  const norm = inner.replace(/\\/g, "/");
  const dir = dirname(norm);
  const combined =
    dir && dir !== "." ? `${dir.replace(/\//g, "__")}__${fileName}` : fileName;
  return sanitizeDropzoneBaseName(combined);
}

function isoCompact(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function moveAcrossDevices(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    await unlink(src);
  }
}

async function uniqueDestPath(destDir: string, fileName: string): Promise<string> {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let candidate = join(destDir, fileName);
  let n = 0;
  while (existsSync(candidate)) {
    n++;
    candidate = join(destDir, `${stem}__${n}${ext}`);
  }
  return candidate;
}

function isPendingGzmoTask(doc: TaskDocument): boolean {
  if (doc.status !== "pending") return false;
  const action = String(doc.frontmatter?.action ?? "think").toLowerCase();
  return action === "think" || action === "search" || action === "chain";
}

export interface DropzoneEmbedQueue {
  enqueueUpsertFile(relPath: string): void;
  whenIdle(): Promise<void>;
}

export interface DropzoneWatcherDeps {
  vaultPath: string;
  inboxPath: string;
  /** When set, new wiki pages are embedded and flushed before the follow-up search task is written. */
  embeddings?: DropzoneEmbedQueue;
  log: (line: string) => void;
}

const processing = new Set<string>();

async function writeFollowUpSearchTask(
  vaultPath: string,
  inboxPath: string,
  relPathForQuery: string,
  kind: "markdown" | "binary" | "converted" | "duplicate",
): Promise<void> {
  const id = isoCompact();
  const taskName = `__dropzone_followup__${id}.md`;
  const taskPath = join(inboxPath, taskName);
  const hint =
    kind === "markdown"
      ? "The user dropped a Markdown file into GZMO/Dropzone; it was ingested as vault-local notes."
      : kind === "converted"
        ? "The user dropped a file into GZMO/Dropzone; it was converted to Markdown under wiki/incoming (see that page's frontmatter for the stored binary path and handler)."
        : kind === "duplicate"
          ? "The user dropped a file that matches an earlier Dropzone ingest by SHA256; the linked page points at the primary wiki note and stored binary."
          : "The user dropped a non-Markdown file into GZMO/Dropzone; metadata is in the linked stub page.";
  const body = [
    "## Dropzone ingest follow-up",
    "",
    hint,
    "",
    `Primary material (vault-relative): \`${relPathForQuery}\``,
    "",
    "Summarize the substance of that material and how it relates to the rest of the vault. Answer with [E#] citations into the evidence packet where possible.",
    "",
  ].join("\n");
  const taskRaw = matter.stringify(body, {
    status: "pending",
    action: "search",
    dropzone_ingest: relPathForQuery,
  });
  await safeWriteText(vaultPath, taskPath, taskRaw);
}

/**
 * Handle one stable file path under GZMO/Dropzone/ (not a directory; skips root `_processed/` etc.).
 */
export async function handleDropzoneFile(absPath: string, deps: DropzoneWatcherDeps): Promise<void> {
  const { vaultPath, inboxPath, embeddings, log } = deps;
  const relFromVault = relative(resolve(vaultPath), resolve(absPath)).replace(/\\/g, "/");
  if (relFromVault.startsWith("..") || !relFromVault.startsWith("GZMO/Dropzone/")) return;

  const inner = relFromVault.slice("GZMO/Dropzone/".length);
  if (isReservedInnerDropzonePath(inner) || dropzoneRelHasDotSegment(inner)) return;

  const bn = basename(absPath);
  if (bn.startsWith(".")) return;

  if (processing.has(absPath)) return;
  processing.add(absPath);
  try {
    let st;
    try {
      st = await lstat(absPath);
    } catch {
      return;
    }
    if (!st.isFile() || st.isSymbolicLink()) return;

    const dropRoot = join(vaultPath, "GZMO", "Dropzone");
    const processedDir = join(dropRoot, "_processed");
    const failedDir = join(dropRoot, "_failed");
    const filesDir = join(dropRoot, "files");
    const tmpDir = join(dropRoot, "_tmp");
    const wikiIncoming = join(vaultPath, "wiki", "incoming");
    for (const d of [processedDir, failedDir, filesDir, tmpDir, wikiIncoming]) {
      mkdirSync(d, { recursive: true });
    }

    const doc = await TaskDocument.load(absPath);
    if (doc && isPendingGzmoTask(doc)) {
      const dest = await uniqueDestPath(inboxPath, bn.endsWith(".md") ? bn : `${bn}.md`);
      await moveAcrossDevices(absPath, dest);
      log(`📥 Dropzone: promoted pending task → Inbox/${basename(dest)}`);
      return;
    }

    if (bn.toLowerCase().endsWith(".md")) {
      const raw = await Bun.file(absPath).text();
      const slug = wikiSlugFromDropzoneInner(inner, bn);
      const wikiName = `${isoCompact()}__${slug}.md`;
      const wikiAbs = join(wikiIncoming, wikiName);
      const relWiki = `wiki/incoming/${wikiName}`;

      let bodyOut: string;
      const parsed = matter(raw);
      if (parsed.data && typeof parsed.data === "object" && Object.keys(parsed.data).length > 0) {
        const merged = { ...parsed.data, source: "gzmo_dropzone", type: "incoming-note" };
        bodyOut = matter.stringify(parsed.content ?? "", merged);
      } else {
        bodyOut = matter.stringify(raw.trimEnd(), {
          source: "gzmo_dropzone",
          type: "incoming-note",
        });
      }
      await safeWriteText(vaultPath, wikiAbs, bodyOut);
      const destProc = await uniqueDestPath(processedDir, bn);
      await moveAcrossDevices(absPath, destProc);
      if (embeddings) {
        embeddings.enqueueUpsertFile(relWiki);
        await embeddings.whenIdle();
      }
      await writeFollowUpSearchTask(vaultPath, inboxPath, relWiki, "markdown");
      log(`📥 Dropzone: ingested Markdown → ${relWiki} (+ search follow-up)`);
      return;
    }

    const ext = fileExtensionLower(bn);
    const convertCfg = getDropzoneConvertConfig();
    const zipCfg = getDropzoneZipConfig();
    const dedupCfg = getDropzoneDedupConfig();

    let innerZip: { memberPath: string; buffer: Uint8Array; ext: string } | null = null;
    if (ext === "zip" && zipCfg.enabled && st.size > 0 && st.size <= zipCfg.maxZipBytes) {
      try {
        innerZip = await pickConvertibleZipMember(absPath, convertCfg.extensions, zipCfg);
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : String(err);
        log(`📥 Dropzone: zip scan failed for ${bn} — ${m}`);
      }
    }

    const needOuterBytesForDedup = dedupCfg.enabled && st.size > 0 && st.size <= dedupCfg.maxBytes;
    const needOuterBytesForConvert = !innerZip && st.size > 0 && st.size <= convertCfg.maxBytes;
    let outerFileBuf: Uint8Array | null = null;
    if (needOuterBytesForDedup || needOuterBytesForConvert) {
      outerFileBuf = new Uint8Array(await Bun.file(absPath).arrayBuffer());
    }

    let pendingDedupHash: string | null = null;
    if (needOuterBytesForDedup && outerFileBuf) {
      try {
        const h = sha256Hex(outerFileBuf);
        const idx = await readDropzoneIndex(vaultPath);
        const prior = idx.by_sha256[h];
        if (prior) {
          const storedNameDup = `${isoCompact()}__${bn}`;
          const binDestDup = join(filesDir, storedNameDup);
          await moveAcrossDevices(absPath, binDestDup);
          const relBinDup = relative(vaultPath, binDestDup).replace(/\\/g, "/");
          const stubSlugDup = wikiSlugFromDropzoneInner(inner, bn);
          const wikiNameDup = `${isoCompact()}__${stubSlugDup}.md`;
          const wikiAbsDup = join(wikiIncoming, wikiNameDup);
          const relWikiDup = `wiki/incoming/${wikiNameDup}`;

          const dupPage = matter.stringify(
            [
              "## Dropzone duplicate (same file hash)",
              "",
              `This drop matches an earlier ingest (SHA256 \`${h.slice(0, 16)}…\`).`,
              "",
              `- **Earlier wiki page:** \`${prior.rel_wiki}\``,
              `- **Earlier stored file:** \`${prior.rel_binary}\``,
              `- **This duplicate stored at:** \`${relBinDup}\``,
              `- **Original name (this drop):** ${bn}`,
              "",
            ].join("\n"),
            {
              source: "gzmo_dropzone",
              type: "dropzone-duplicate-ref",
              retrievalPriority: "normal",
              binary_path: relBinDup,
              dropzone_duplicate_of_wiki: prior.rel_wiki,
              dropzone_duplicate_of_binary: prior.rel_binary,
              dropzone_sha256: h,
            },
          );
          await safeWriteText(vaultPath, wikiAbsDup, dupPage);
          if (embeddings) {
            embeddings.enqueueUpsertFile(relWikiDup);
            await embeddings.whenIdle();
          }
          await writeFollowUpSearchTask(vaultPath, inboxPath, relWikiDup, "duplicate");
          log(`📥 Dropzone: duplicate of ${prior.rel_wiki} → ${relWikiDup}`);
          return;
        }
        pendingDedupHash = h;
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : String(err);
        log(`📥 Dropzone: dedup hash skipped for ${bn} — ${m}`);
      }
    }

    const extForConvert = innerZip ? innerZip.ext : ext;
    let bufForConvert: Uint8Array | null = null;
    if (innerZip) bufForConvert = innerZip.buffer;
    else if (needOuterBytesForConvert && outerFileBuf) bufForConvert = outerFileBuf;

    let converted: {
      markdown: string;
      handler: string;
      extraFrontmatter?: Record<string, unknown>;
    } | null = null;
    if (bufForConvert && isExtensionConvertible(extForConvert, convertCfg)) {
      try {
        converted = await convertDropzoneBuffer(extForConvert, bufForConvert, convertCfg);
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : String(err);
        log(`📥 Dropzone: convert failed for ${bn} — ${m} (using stub)`);
      }
    }

    const storedName = `${isoCompact()}__${bn}`;
    const binDest = join(filesDir, storedName);
    await moveAcrossDevices(absPath, binDest);
    const relBin = relative(vaultPath, binDest).replace(/\\/g, "/");
    const stubSlug = wikiSlugFromDropzoneInner(inner, bn);
    const wikiName = `${isoCompact()}__${stubSlug}.md`;
    const wikiAbs = join(wikiIncoming, wikiName);
    const relWiki = `wiki/incoming/${wikiName}`;

    if (converted) {
      const wikiBody = converted.markdown.trimEnd() + "\n";
      const fm: Record<string, unknown> = {
        source: "gzmo_dropzone",
        type: "dropzone-converted",
        retrievalPriority: "high",
        binary_path: relBin,
        dropzone_original_name: bn,
        converted_by: "gzmo_dropzone_convert",
        converted_handler: converted.handler,
        converted_at: new Date().toISOString(),
        ...(converted.extraFrontmatter ?? {}),
      };
      if (innerZip) {
        fm.dropzone_zip_member = innerZip.memberPath;
        fm.dropzone_zip_outer_name = bn;
      }
      const page = matter.stringify(wikiBody, fm);
      await safeWriteText(vaultPath, wikiAbs, page);
      if (embeddings) {
        embeddings.enqueueUpsertFile(relWiki);
        await embeddings.whenIdle();
      }
      await writeFollowUpSearchTask(vaultPath, inboxPath, relWiki, "converted");
      log(`📥 Dropzone: converted (${converted.handler}) → ${relWiki} (+ search follow-up)`);
      if (pendingDedupHash) {
        await mergeDropzoneIndexEntry(vaultPath, pendingDedupHash, {
          first_seen_at: new Date().toISOString(),
          rel_wiki: relWiki,
          rel_binary: relBin,
          original_name: bn,
        });
      }
    } else {
      const stub = matter.stringify(
        [
          "## Dropped file (binary)",
          "",
          `- **Original name:** ${bn}`,
          `- **Stored at (vault-relative):** \`${relBin}\``,
          `- **Size (bytes):** ${st.size}`,
          "",
          "GZMO does not parse this format automatically. Summarize likely intent from the filename and suggest next steps (convert to text, split, etc.).",
        ].join("\n"),
        {
          source: "gzmo_dropzone",
          type: "dropzone-binary-stub",
          retrievalPriority: "high",
          binary_path: relBin,
        },
      );
      await safeWriteText(vaultPath, wikiAbs, stub);
      if (embeddings) {
        embeddings.enqueueUpsertFile(relWiki);
        await embeddings.whenIdle();
      }
      await writeFollowUpSearchTask(vaultPath, inboxPath, relWiki, "binary");
      log(`📥 Dropzone: stored binary + stub → ${relWiki} (+ search follow-up)`);
      if (pendingDedupHash) {
        await mergeDropzoneIndexEntry(vaultPath, pendingDedupHash, {
          first_seen_at: new Date().toISOString(),
          rel_wiki: relWiki,
          rel_binary: relBin,
          original_name: bn,
        });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Dropzone: failed on ${basename(absPath)} — ${msg}`);
    try {
      const failedDir = join(vaultPath, "GZMO", "Dropzone", "_failed");
      if (!existsSync(failedDir)) mkdirSync(failedDir, { recursive: true });
      if (existsSync(absPath)) {
        const destFail = await uniqueDestPath(failedDir, basename(absPath));
        await moveAcrossDevices(absPath, destFail);
      }
    } catch {
      // best effort
    }
  } finally {
    processing.delete(absPath);
  }
}

export function startDropzoneWatcher(deps: DropzoneWatcherDeps): FSWatcher {
  const dropDir = join(deps.vaultPath, "GZMO", "Dropzone");
  if (!existsSync(dropDir)) mkdirSync(dropDir, { recursive: true });

  const dropDirAbs = resolve(dropDir);
  const w = watch(dropDir, {
    ignored: (p: string) => {
      const rel = relative(dropDirAbs, resolve(p)).replace(/\\/g, "/");
      if (rel.startsWith("..") || rel === "") return false;
      return isReservedInnerDropzonePath(rel) || dropzoneRelHasDotSegment(rel);
    },
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const DEBOUNCE_MS = 600;

  const schedule = (filePath: string) => {
    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        void handleDropzoneFile(filePath, deps);
      }, DEBOUNCE_MS),
    );
  };

  w.on("add", schedule);
  w.on("change", schedule);

  w.on("error", (err: unknown) => {
    console.error(`[DROPZONE] Watcher error: ${err instanceof Error ? err.message : err}`);
  });

  console.log(`[DROPZONE] Watching: ${dropDir}`);
  return w;
}

async function scanDropzoneTree(dirAbs: string, dropRootAbs: string, deps: DropzoneWatcherDeps): Promise<void> {
  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = join(dirAbs, ent.name);
    if (ent.isSymbolicLink()) continue;
    const inner = relative(dropRootAbs, abs).replace(/\\/g, "/");
    if (inner.startsWith("..")) continue;
    if (ent.isDirectory()) {
      if (isReservedInnerDropzonePath(inner)) continue;
      await scanDropzoneTree(abs, dropRootAbs, deps);
      continue;
    }
    if (!ent.isFile()) continue;
    if (isReservedInnerDropzonePath(inner) || dropzoneRelHasDotSegment(inner)) continue;
    await handleDropzoneFile(abs, deps);
  }
}

/** Process any files already sitting in Dropzone/ (e.g. left before a daemon restart). */
export async function scanDropzoneOnBoot(deps: DropzoneWatcherDeps): Promise<void> {
  const dropDir = join(deps.vaultPath, "GZMO", "Dropzone");
  if (!existsSync(dropDir)) return;
  await scanDropzoneTree(resolve(dropDir), resolve(dropDir), deps);
}
