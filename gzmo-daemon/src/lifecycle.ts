/**
 * lifecycle.ts — process-wide AbortController + signal helpers.
 *
 * Keeping these out of `index.ts` avoids circular imports: any module
 * (inference, embeddings, query_rewrite, etc.) can pull in `daemonAbort`
 * without triggering `index.ts`'s top-level boot side effects.
 *
 * Use `makeAbortSignal({ signal, timeoutMs })` to compose a per-call signal
 * that is automatically aborted on daemon shutdown, on the caller's own
 * AbortController, or after `timeoutMs`. Pass the result as `signal` to
 * `fetch` or as `abortSignal` to AI SDK `streamText`.
 */

/** Process-wide controller. shutdown() in index.ts calls .abort() on SIGINT/SIGTERM. */
export const daemonAbort = new AbortController();

export interface MakeSignalOptions {
  /** Caller-provided signal; combined with daemon abort + optional timeout. */
  signal?: AbortSignal;
  /** Hard upper bound for this call. 0 / undefined disables the per-call timeout. */
  timeoutMs?: number;
  /** When false, do not include the daemon-wide signal (rare; tests). Defaults to true. */
  honorDaemonAbort?: boolean;
}

/**
 * Compose a single AbortSignal for a single LLM/HTTP call.
 *
 * Uses `AbortSignal.any([...])` (Bun + Node 20.3+ ship it). When only one
 * source signal is requested, returns it directly to avoid an extra wrapper.
 */
export function makeAbortSignal(opts: MakeSignalOptions = {}): AbortSignal {
  const honor = opts.honorDaemonAbort !== false;
  const signals: AbortSignal[] = [];
  if (honor) signals.push(daemonAbort.signal);
  if (opts.signal) signals.push(opts.signal);
  if (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) {
    signals.push(AbortSignal.timeout(opts.timeoutMs));
  }
  if (signals.length === 0) {
    // Should not happen in practice; return a never-aborting signal so callers can pass it directly.
    return new AbortController().signal;
  }
  if (signals.length === 1) return signals[0]!;
  return AbortSignal.any(signals);
}

/** Numeric env helper local to lifecycle to avoid pulling in pipelines/helpers. */
function envInt(name: string, dflt: number): number {
  const raw = process.env[name];
  if (!raw) return dflt;
  const v = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/** Default timeouts (ms) for each stage. Override via env. */
export const DEFAULT_TIMEOUTS = {
  /** Main reasoning call (`reason`). 120s by default — long enough for slow local models. */
  inferReason: () => envInt("GZMO_INFER_REASON_TIMEOUT_MS", 120_000),
  /** Quick chat ops (`fast`, `judge`, query rewrite). 30s by default. */
  inferFast: () => envInt("GZMO_INFER_FAST_TIMEOUT_MS", 30_000),
  /** Embedding HTTP call. 30s by default. */
  embed: () => envInt("GZMO_EMBED_TIMEOUT_MS", 30_000),
};
