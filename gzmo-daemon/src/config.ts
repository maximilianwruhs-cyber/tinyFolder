import { mkdirSync } from "fs";
import { accessSync, constants as fsConstants, writeFileSync, unlinkSync } from "fs";
import { isAbsolute, join, resolve } from "path";

export type GzmoProfile = "core" | "standard" | "full" | "minimal" | "heartbeat";

export interface DaemonConfig {
  vaultPath: string;
  inboxPath: string;
  ollamaUrl: string;
  ollamaModel: string;
  profile: GzmoProfile;
}

function normalizeOllamaUrl(raw: string): string {
  // Historically some callers passed /v1; normalize to base.
  return raw.replace(/\/v1\/?$/, "");
}

function readProfile(): GzmoProfile {
  const raw = (process.env.GZMO_PROFILE ?? "core").trim().toLowerCase();
  if (
    raw === "core" ||
    raw === "standard" ||
    raw === "full" ||
    raw === "minimal" ||
    raw === "heartbeat"
  ) {
    return raw;
  }
  throw new Error(
    `Invalid GZMO_PROFILE=${JSON.stringify(process.env.GZMO_PROFILE)}. ` +
      `Expected one of: core, standard, full, minimal, heartbeat.`,
  );
}

function ensureWritableDir(absDir: string): void {
  mkdirSync(absDir, { recursive: true });
  accessSync(absDir, fsConstants.R_OK | fsConstants.W_OK);
}

function assertVaultWritable(vaultPath: string): void {
  // Create a small write probe inside GZMO/ so we fail fast on:
  // - non-existent path
  // - permission issues
  // - read-only FS / disk-full (best effort)
  const gzmoDir = join(vaultPath, "GZMO");
  ensureWritableDir(gzmoDir);

  const probe = join(gzmoDir, ".gzmo_write_probe");
  try {
    writeFileSync(probe, `ok ${new Date().toISOString()}\n`, { encoding: "utf8" });
  } finally {
    try {
      unlinkSync(probe);
    } catch {
      // ignore cleanup failures
    }
  }
}

/**
 * Parse + validate the critical runtime configuration.
 * Throws on misconfiguration (intended: crash fast on bad local setup).
 */
export function loadConfig(): DaemonConfig {
  const vaultPath = process.env.VAULT_PATH
    ? resolve(process.env.VAULT_PATH)
    : resolve(import.meta.dir, "../../vault");

  if (!isAbsolute(vaultPath)) {
    throw new Error(
      `VAULT_PATH must be an absolute path. Got: ${JSON.stringify(process.env.VAULT_PATH ?? vaultPath)}`,
    );
  }

  assertVaultWritable(vaultPath);

  const inboxPath = join(vaultPath, "GZMO", "Inbox");
  // Ensure the Inbox exists too; the watcher assumes it.
  ensureWritableDir(inboxPath);

  const ollamaUrl = normalizeOllamaUrl(process.env.OLLAMA_URL?.trim() || "http://localhost:11434");
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || "hermes3:8b";
  const profile = readProfile();

  return { vaultPath, inboxPath, ollamaUrl, ollamaModel, profile };
}

