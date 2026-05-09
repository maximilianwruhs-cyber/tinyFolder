/**
 * task_semaphore.ts — bounded parallelism for inbox task processing.
 *
 * Without this, a bulk inbox drop fires `processTask` for every file at once,
 * which can saturate VRAM, thrash Ollama, and (paradoxically) make every task
 * slower. We default to 1 concurrent task — the safe choice for single-user
 * local use where one model usually monopolises the GPU.
 */

export class TaskSemaphore {
  private inFlight = 0;
  private waiters: Array<() => void> = [];

  constructor(public readonly limit: number) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error(`TaskSemaphore: limit must be >= 1 (got ${limit})`);
    }
  }

  /** Number of permits currently held. Useful for tests + observability. */
  get active(): number {
    return this.inFlight;
  }

  /** Number of callers parked waiting for a permit. */
  get waiting(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<void> {
    if (this.inFlight < this.limit) {
      this.inFlight++;
      return;
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    if (this.inFlight === 0) return;
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit directly to the next waiter; inFlight stays the same.
      next();
    } else {
      this.inFlight--;
    }
  }

  /** Acquire, run `fn`, release exactly once even if `fn` throws. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export function readTaskConcurrency(): number {
  const raw = process.env.GZMO_TASK_CONCURRENCY?.trim();
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  // Cap aggressively — beyond ~8 you almost certainly want a real queue, not threads.
  return Math.min(8, n);
}
