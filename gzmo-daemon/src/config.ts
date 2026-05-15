import { mkdirSync } from "fs";
import { accessSync, constants as fsConstants, writeFileSync, unlinkSync } from "fs";
import { isAbsolute, join, resolve } from "path";

export type GzmoProfile = "core" | "standard" | "full" | "minimal" | "heartbeat" | "interactive" | "art";

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
    raw === "heartbeat" ||
    raw === "interactive" ||
    raw === "art"
  ) {
    return raw;
  }
  throw new Error(
    `Invalid GZMO_PROFILE=${JSON.stringify(process.env.GZMO_PROFILE)}. ` +
      `Expected one of: core, standard, full, minimal, heartbeat, interactive, art.`,
  );
}

/** When `GZMO_PROFILE=art`, set conservative defaults for subsystem + auto-inbox flags (explicit env wins). */
export function applyArtProfileDefaults(): void {
  if ((process.env.GZMO_PROFILE ?? "").trim().toLowerCase() !== "art") return;
  const setDefault = (key: string, value: string) => {
    if (process.env[key] === undefined) process.env[key] = value;
  };
  setDefault("GZMO_ENABLE_WIKI", "off");
  setDefault("GZMO_ENABLE_INGEST", "off");
  setDefault("GZMO_ENABLE_WIKI_LINT", "off");
  setDefault("GZMO_ENABLE_PRUNING", "off");
  setDefault("GZMO_AUTO_INBOX_FROM_WIKI_REPAIR", "off");
  setDefault("GZMO_AUTO_INBOX_FROM_SELF_ASK", "off");
  setDefault("GZMO_AUTO_INBOX_FROM_DREAMS", "off");
}

/** Enable clarification-first flags when profile=interactive (explicit env wins). */
export function applyInteractiveProfileDefaults(): void {
  if ((process.env.GZMO_PROFILE ?? "").trim().toLowerCase() !== "interactive") return;
  const setDefault = (key: string, value: string) => {
    if (process.env[key] === undefined) process.env[key] = value;
  };
  setDefault("GZMO_ENABLE_GAH", "on");
  setDefault("GZMO_ENABLE_DSJ", "on");
  setDefault("GZMO_ENABLE_TEACHBACK", "on");
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
  applyInteractiveProfileDefaults();
  applyArtProfileDefaults();

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

