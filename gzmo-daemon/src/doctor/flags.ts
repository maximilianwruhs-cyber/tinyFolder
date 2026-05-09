import type { DoctorProfile } from "./types";

export interface DoctorFlags {
  profile: DoctorProfile;
  readonly: boolean;
  writeReports: boolean;
  timeoutMs: number;
  heal: boolean;
  healRetries: number;
  healDelayMs: number;
}

function pickProfile(v: string | undefined): DoctorProfile | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === "fast" || s === "standard" || s === "deep") return s;
  return null;
}

export function parseDoctorFlags(argv = process.argv.slice(2)): DoctorFlags {
  // Defaults (per your preference): deep + readonly + write reports to repo
  let profile: DoctorProfile = "deep";
  let readonly = true;
  let writeReports = true;
  let timeoutMs = 120_000;
  let heal = false;
  let healRetries = 3;
  let healDelayMs = 2000;

  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--profile") {
      const p = pickProfile(args[i + 1]);
      if (p) profile = p;
      i++;
      continue;
    }
    if (a.startsWith("--profile=")) {
      const p = pickProfile(a.split("=", 2)[1]);
      if (p) profile = p;
      continue;
    }
    if (a === "--fast") profile = "fast";
    if (a === "--standard") profile = "standard";
    if (a === "--deep") profile = "deep";

    if (a === "--readonly") readonly = true;
    if (a === "--write") readonly = false;

    if (a === "--no-report") writeReports = false;
    if (a === "--report") writeReports = true;

    if (a === "--heal") { heal = true; continue; }
    if (a === "--heal-retries") {
      const n = Number.parseInt(args[i + 1] ?? "", 10);
      if (Number.isFinite(n) && n >= 0) healRetries = n;
      i++;
      continue;
    }
    if (a.startsWith("--heal-retries=")) {
      const n = Number.parseInt(a.split("=", 2)[1] ?? "", 10);
      if (Number.isFinite(n) && n >= 0) healRetries = n;
      continue;
    }
    if (a === "--heal-delay-ms") {
      const n = Number.parseInt(args[i + 1] ?? "", 10);
      if (Number.isFinite(n) && n >= 0) healDelayMs = n;
      i++;
      continue;
    }
    if (a.startsWith("--heal-delay-ms=")) {
      const n = Number.parseInt(a.split("=", 2)[1] ?? "", 10);
      if (Number.isFinite(n) && n >= 0) healDelayMs = n;
      continue;
    }

    if (a === "--timeout-ms") {
      const n = Number.parseInt(args[i + 1] ?? "", 10);
      if (Number.isFinite(n) && n > 0) timeoutMs = n;
      i++;
      continue;
    }
    if (a.startsWith("--timeout-ms=")) {
      const n = Number.parseInt(a.split("=", 2)[1] ?? "", 10);
      if (Number.isFinite(n) && n > 0) timeoutMs = n;
      continue;
    }
  }

  return { profile, readonly, writeReports, timeoutMs, heal, healRetries, healDelayMs };
}
