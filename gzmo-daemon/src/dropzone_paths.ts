import { mkdirSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";

/** Vault-relative prefix used in wiki frontmatter and dedup index (even when files live elsewhere). */
export const DROPZONE_LOGICAL_PREFIX = "GZMO/Dropzone";

/**
 * Physical Dropzone root: `GZMO_DROPZONE_DIR` when set (absolute), else `$VAULT_PATH/GZMO/Dropzone`.
 */
export function resolveDropzoneRoot(vaultPath: string): string {
  const raw = process.env.GZMO_DROPZONE_DIR?.trim();
  if (!raw) return join(resolve(vaultPath), "GZMO", "Dropzone");
  if (!isAbsolute(raw)) {
    throw new Error(
      `GZMO_DROPZONE_DIR must be an absolute path. Got: ${JSON.stringify(process.env.GZMO_DROPZONE_DIR)}`,
    );
  }
  return resolve(raw);
}

/** Relative path under the drop root (POSIX slashes), or null if outside. */
export function dropzoneInnerFromAbs(absPath: string, dropRoot: string): string | null {
  const rel = relative(resolve(dropRoot), resolve(absPath)).replace(/\\/g, "/");
  if (!rel || rel === "." || rel.startsWith("..")) return null;
  return rel;
}

/** Logical vault-relative path for a stored binary under `Dropzone/files/`. */
export function logicalDropzoneBinaryRel(storedFileName: string): string {
  return `${DROPZONE_LOGICAL_PREFIX}/files/${storedFileName}`;
}

export function ensureDropzoneScaffold(dropRoot: string): void {
  mkdirSync(dropRoot, { recursive: true });
  for (const sub of ["_processed", "_failed", "files", "_tmp"]) {
    mkdirSync(join(dropRoot, sub), { recursive: true });
  }
}

/** Prefer localized Desktop (e.g. Schreibtisch) for default agent/human drop folder name. */
export function defaultDesktopDropzoneDir(): string {
  const home = process.env.HOME?.trim();
  if (!home) return join("/tmp", "GZMO-Dropzone");
  for (const segment of ["Schreibtisch", "Desktop"]) {
    const desktop = join(home, segment);
    try {
      mkdirSync(desktop, { recursive: true });
      return join(desktop, "GZMO-Dropzone");
    } catch {
      // try next
    }
  }
  return join(home, "GZMO-Dropzone");
}
