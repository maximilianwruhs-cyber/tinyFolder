/**
 * vault_fs.ts — Vault-safe filesystem writes.
 *
 * Goals:
 * - Prevent path traversal outside the vault root
 * - Enforce the invariant: raw/ is immutable (never write to raw/)
 * - Provide atomic writes for structured artifacts (json snapshots, digests, embedding store)
 *
 * This module is intentionally small and dependency-free.
 */
 
import { dirname, relative, resolve, sep } from "path";
import { lstatSync, mkdirSync, renameSync, writeFileSync } from "fs";
import { appendFile, lstat, mkdir, rename, stat, unlink } from "fs/promises";
 
export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}
 
function normalizeRel(p: string): string {
  // Normalize to forward-slash for prefix checks.
  return p.replace(/\\/g, "/");
}
 
/**
 * Resolve a target path against the vault root and validate it stays inside.
 * Accepts absolute or relative `targetPath`.
 */
export function resolveVaultPath(vaultRoot: string, targetPath: string): { abs: string; rel: string } {
  const rootAbs = resolve(vaultRoot);
  const targetAbs = resolve(rootAbs, targetPath);
  const rel = relative(rootAbs, targetAbs);
 
  // Must be inside vaultRoot.
  if (rel === "" || rel === "." || (!rel.startsWith(".."+sep) && rel !== ".." && !rel.includes(`..${sep}`))) {
    // ok
  } else {
    throw new VaultPathError(`Refusing path traversal outside vault: ${targetPath}`);
  }
 
  const relNorm = normalizeRel(rel);
  if (relNorm === "raw" || relNorm.startsWith("raw/")) {
    throw new VaultPathError(`Refusing write into raw/: ${relNorm}`);
  }
 
  return { abs: targetAbs, rel };
}

/** Reject symlinks so vault tools cannot read outside the vault via link tricks. */
export async function assertVaultFileNotSymlink(abs: string): Promise<void> {
  const st = await lstat(abs);
  if (st.isSymbolicLink()) {
    throw new VaultPathError(`Refusing symlink: ${abs}`);
  }
}

export function assertVaultFileNotSymlinkSync(abs: string): void {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) {
    throw new VaultPathError(`Refusing symlink: ${abs}`);
  }
}
 
async function ensureParentDir(fileAbs: string): Promise<void> {
  await mkdir(dirname(fileAbs), { recursive: true });
}
 
function ensureParentDirSync(fileAbs: string): void {
  mkdirSync(dirname(fileAbs), { recursive: true });
}
 
/**
 * Write text safely (vault-contained + raw-protected). Non-atomic by default.
 * Use atomicWriteText for structured artifacts where corruption is unacceptable.
 */
export async function safeWriteText(vaultRoot: string, targetPath: string, content: string): Promise<void> {
  const { abs } = resolveVaultPath(vaultRoot, targetPath);
  await ensureParentDir(abs);
  await Bun.write(abs, content);
}
 
/**
 * Atomic text write: write `*.tmp` then rename into place.
 * This avoids partial files on crash/interruption.
 */
export async function atomicWriteText(vaultRoot: string, targetPath: string, content: string): Promise<void> {
  const { abs } = resolveVaultPath(vaultRoot, targetPath);
  await ensureParentDir(abs);
  const tmp = abs + ".tmp";
  await Bun.write(tmp, content);
  // Bun.write may return before the file is observable on some FS setups.
  // Fail-closed: ensure the tmp exists before rename to avoid spurious ENOENT.
  try {
    const ok = await Bun.file(tmp).exists();
    if (!ok) {
      // As a last resort, fall back to non-atomic write rather than crashing the daemon.
      await Bun.write(abs, content);
      return;
    }
  } catch {
    // ignore
  }
  await rename(tmp, abs);
}
 
export function atomicWriteTextSync(vaultRoot: string, targetPath: string, content: string): void {
  const { abs } = resolveVaultPath(vaultRoot, targetPath);
  ensureParentDirSync(abs);
  const tmp = abs + ".tmp";
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, abs);
}
 
export async function atomicWriteJson(vaultRoot: string, targetPath: string, value: unknown, space = 2): Promise<void> {
  await atomicWriteText(vaultRoot, targetPath, JSON.stringify(value, null, space));
}
 
export function atomicWriteJsonSync(vaultRoot: string, targetPath: string, value: unknown, space = 2): void {
  atomicWriteTextSync(vaultRoot, targetPath, JSON.stringify(value, null, space));
}

/**
 * Append a single JSONL line safely (vault-contained + raw-protected).
 * Creates the parent directory if it doesn't exist.
 *
 * R5 (rotation):
 *   When the file exceeds GZMO_LOG_ROTATE_MB (default 50 MB), it is rotated:
 *     foo.jsonl  -> foo.jsonl.1
 *     foo.jsonl.1 -> foo.jsonl.2
 *     ... up to GZMO_LOG_KEEP (default 3); older rolls are deleted.
 *   Set GZMO_LOG_ROTATE_MB=0 to disable rotation entirely.
 */
export async function safeAppendJsonl(vaultRoot: string, targetPath: string, value: unknown): Promise<void> {
  const { abs } = resolveVaultPath(vaultRoot, targetPath);
  await ensureParentDir(abs);
  await maybeRotate(abs);
  const line = JSON.stringify(value) + "\n";
  await appendFile(abs, line, "utf-8");
}

/** Read rotation thresholds from env each call so tests can tweak them mid-run. */
function rotateThresholdBytes(): number {
  const raw = process.env.GZMO_LOG_ROTATE_MB;
  const mb = raw === undefined ? 50 : Number.parseInt(raw, 10);
  if (!Number.isFinite(mb) || mb <= 0) return 0; // 0/invalid disables rotation
  return mb * 1024 * 1024;
}
function rotateKeep(): number {
  const raw = process.env.GZMO_LOG_KEEP;
  const k = raw === undefined ? 3 : Number.parseInt(raw, 10);
  return Number.isFinite(k) && k >= 1 ? Math.min(k, 20) : 3;
}

async function maybeRotate(abs: string): Promise<void> {
  const limit = rotateThresholdBytes();
  if (limit === 0) return;
  let size: number;
  try {
    const st = await stat(abs);
    size = st.size;
  } catch {
    return; // file doesn't exist yet — nothing to rotate
  }
  if (size < limit) return;

  const keep = rotateKeep();
  // Drop the oldest roll if it would exceed the keep budget.
  const oldest = `${abs}.${keep}`;
  try { await unlink(oldest); } catch { /* nothing to drop */ }

  // Shift .N -> .N+1 from oldest to newest so we never overwrite live data.
  for (let i = keep - 1; i >= 1; i--) {
    try {
      await rename(`${abs}.${i}`, `${abs}.${i + 1}`);
    } catch {
      // gap in the chain is fine
    }
  }
  // Move current → .1 so the next append starts a fresh file.
  try {
    await rename(abs, `${abs}.1`);
  } catch {
    // If rename failed (race), leave the file alone — appending is still safe.
  }
}
 
