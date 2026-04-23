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
import { mkdirSync, renameSync, writeFileSync } from "fs";
import { mkdir, rename } from "fs/promises";
 
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
 
