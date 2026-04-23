import type { DoctorProfile } from "./types";

export interface DoctorFlags {
  profile: DoctorProfile;
  readonly: boolean;
  writeReports: boolean;
  runLegacy?: "unit" | "pipeline" | "nightshift" | "stress" | "all";
  timeoutMs: number;
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
  let runLegacy: DoctorFlags["runLegacy"] | undefined;
  let timeoutMs = 120_000;

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

    if (a === "--run-legacy") {
      const v = (args[i + 1] ?? "").trim().toLowerCase();
      if (v === "unit" || v === "pipeline" || v === "nightshift" || v === "stress" || v === "all") runLegacy = v;
      i++;
      continue;
    }
    if (a.startsWith("--run-legacy=")) {
      const v = (a.split("=", 2)[1] ?? "").trim().toLowerCase();
      if (v === "unit" || v === "pipeline" || v === "nightshift" || v === "stress" || v === "all") runLegacy = v;
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

  // Safety: legacy runs are inherently write-y; require explicit --write
  if (runLegacy && readonly) {
    // Keep readonly, but the runner will SKIP writey legacy steps and report the requirement.
  }

  return { profile, readonly, writeReports, runLegacy, timeoutMs };
}

