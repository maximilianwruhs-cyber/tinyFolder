/**
 * vram_probe.ts — periodic VRAM telemetry via `nvidia-smi`.
 *
 * Lifecycle:
 *   1. `startVramProbe()` is called once from index.ts at boot.
 *   2. Mode is resolved from `GZMO_VRAM_PROBE` (auto|nvidia-smi|env|off).
 *      In `auto` mode we shell out only when `nvidia-smi` is on PATH; on
 *      machines without an NVIDIA GPU the probe stays dormant and the env
 *      var bridge keeps working.
 *   3. Every `GZMO_VRAM_PROBE_INTERVAL_MS` (default 10_000) we run
 *      `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits`
 *      and cache the result. The probe is best-effort: any error leaves the
 *      previous cached snapshot intact and is logged once (deduplicated).
 *   4. `getVramSnapshot()` is the read API for `buildHealthResponse()` —
 *      consumers use the probe value when present, env vars otherwise.
 *   5. `stopVramProbe()` is called from `shutdown()` so the timer doesn't
 *      keep the process alive past drain.
 */

import { daemonAbort } from "./lifecycle";

export type VramProbeMode = "auto" | "nvidia-smi" | "env" | "off";

export interface VramSnapshot {
  used_mb: number;
  total_mb: number;
  source: "nvidia-smi";
  /** epoch ms */
  at: number;
}

let cached: VramSnapshot | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let lastErrorMessage: string | undefined;
let activeMode: VramProbeMode = "off";

function resolveMode(): VramProbeMode {
  const raw = (process.env.GZMO_VRAM_PROBE ?? "auto").trim().toLowerCase();
  if (raw === "nvidia-smi" || raw === "env" || raw === "off") return raw;
  return "auto";
}

function resolveIntervalMs(): number {
  const raw = process.env.GZMO_VRAM_PROBE_INTERVAL_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  // Floor at 1s — anything tighter is wasteful since nvidia-smi itself takes ~50ms.
  return Number.isFinite(n) && n >= 1000 ? n : 10_000;
}

/** Resolve which mode is active given env + tool availability. Pure helper for tests. */
export async function resolveActiveMode(probeAvailable: () => Promise<boolean> = nvidiaSmiAvailable): Promise<VramProbeMode> {
  const requested = resolveMode();
  if (requested === "off" || requested === "env") return requested;
  if (requested === "nvidia-smi") return "nvidia-smi";
  // auto: enable iff the tool is on PATH
  return (await probeAvailable()) ? "nvidia-smi" : "env";
}

async function nvidiaSmiAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["nvidia-smi", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Parse the output of `nvidia-smi --query-gpu=memory.used,memory.total
 * --format=csv,noheader,nounits`. With multiple GPUs we sum across rows so
 * the dashboard's single-bar UI always shows the aggregate footprint.
 *
 * Exported for unit tests.
 */
export function parseNvidiaSmiOutput(stdout: string): { used_mb: number; total_mb: number } | null {
  let used = 0;
  let total = 0;
  let rowCount = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s*,\s*/);
    if (parts.length < 2) continue;
    const u = Number.parseInt(parts[0]!, 10);
    const t = Number.parseInt(parts[1]!, 10);
    if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) continue;
    used += u;
    total += t;
    rowCount++;
  }
  if (rowCount === 0 || total <= 0) return null;
  return { used_mb: used, total_mb: total };
}

async function runProbeOnce(): Promise<void> {
  try {
    const proc = Bun.spawn(
      ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`nvidia-smi exit=${exitCode}`);
    const parsed = parseNvidiaSmiOutput(stdout);
    if (!parsed) throw new Error("nvidia-smi returned no parseable rows");
    cached = { ...parsed, source: "nvidia-smi", at: Date.now() };
    lastErrorMessage = undefined;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg !== lastErrorMessage) {
      console.warn(`[VRAM] Probe failed: ${msg} (will retry; cached snapshot preserved)`);
      lastErrorMessage = msg;
    }
  }
}

export interface StartVramProbeResult {
  mode: VramProbeMode;
  intervalMs: number;
}

/**
 * Start the periodic probe. Idempotent — calling twice is a no-op after the
 * first call. Returns the resolved mode + interval so the caller can log it.
 */
export async function startVramProbe(): Promise<StartVramProbeResult> {
  if (timer) return { mode: activeMode, intervalMs: resolveIntervalMs() };

  activeMode = await resolveActiveMode();
  if (activeMode !== "nvidia-smi") {
    return { mode: activeMode, intervalMs: 0 };
  }

  const intervalMs = resolveIntervalMs();
  // Run once immediately so /health has data on the very first request.
  await runProbeOnce();
  timer = setInterval(() => {
    void runProbeOnce();
  }, intervalMs);
  // Don't keep the event loop alive purely for the probe — Bun timers default
  // to ref'd, which would block shutdown if the embedding queue + watcher both
  // exit but this timer is still scheduled.
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  // Tear down on daemon shutdown so the timer doesn't fire after process.exit
  // is queued.
  daemonAbort.signal.addEventListener("abort", () => stopVramProbe(), { once: true });
  return { mode: activeMode, intervalMs };
}

export function stopVramProbe(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/**
 * Read the most recent probe snapshot. Returns undefined when the probe is
 * disabled, hasn't run yet, or is in `env` mode. Callers in `api_server.ts`
 * should prefer this over env vars when present.
 */
export function getVramSnapshot(): VramSnapshot | undefined {
  return cached;
}

/** Visible for tests. */
export function _resetVramProbeForTest(): void {
  stopVramProbe();
  cached = undefined;
  lastErrorMessage = undefined;
  activeMode = "off";
}
