/**
 * Fire-and-forget Spark / Ollama self-check; writes $VAULT_PATH/GZMO/SELF_HELP.md.
 */

import { existsSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { readBoolEnv } from "./pipelines/helpers";

export function sparkSelfCheckEnabled(): boolean {
  return readBoolEnv("GZMO_SPARK_SELF_CHECK", true);
}

/** Repo root (tinyFolder), not gzmo-daemon/. */
export function repoRootFromDaemon(): string {
  return resolve(import.meta.dir, "..", "..");
}

export function selfHelpPath(vaultPath: string): string {
  return join(vaultPath, "GZMO", "SELF_HELP.md");
}

/**
 * Run scripts/spark-self-check.sh in the background (does not block daemon boot).
 */
export function runSparkSelfCheckAsync(opts?: { heal?: boolean }): void {
  if (!sparkSelfCheckEnabled()) return;

  const repoRoot = repoRootFromDaemon();
  const script = join(repoRoot, "scripts", "spark-self-check.sh");
  if (!existsSync(script)) return;

  const envFile =
    process.env.GZMO_ENV_FILE?.trim() || join(repoRoot, "gzmo-daemon", ".env");

  const args = [script, "--write-vault"];
  if (opts?.heal) args.push("--heal");

  try {
    const child = spawn("bash", args, {
      env: { ...process.env, GZMO_ENV_FILE: envFile },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // non-fatal
  }
}
