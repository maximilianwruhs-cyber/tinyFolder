/**
 * gzmo_api_client.ts — typed HTTP/SSE client for the GZMO daemon API.
 *
 * Used by the Pi extension (entry + dashboard). Has no Pi-specific
 * dependencies so it is trivially unit-testable in isolation.
 */

import fs from "node:fs";
import { asNonEmptyString, type GzmoAction } from "./gzmo_shared";

export type ApiClientEnv = {
  baseUrl: string;
  socketPath: string | null;
};

export function readApiClientEnv(): ApiClientEnv {
  const socket = asNonEmptyString(process.env.GZMO_API_SOCKET) ?? "";
  const host = asNonEmptyString(process.env.GZMO_API_HOST) ?? "127.0.0.1";
  const port = asNonEmptyString(process.env.GZMO_API_PORT) ?? "12700";
  if (socket && fs.existsSync(socket)) return { baseUrl: `http://unix:${socket}`, socketPath: socket };
  return { baseUrl: `http://${host}:${port}`, socketPath: null };
}

export type ApiSubmitOk = { ok: true; id: string; path?: string; status: string };
export type ApiCallErr = { ok: false; error: string; status?: number };
export type ApiHealthOk = { ok: true; data: ApiHealthShape };
export type ApiTaskOk = { ok: true; data: ApiTaskShape };
export type ApiSearchOk = { ok: true; answer: string; evidence?: string; trace_id?: string; task_path?: string };

export type ApiHealthShape = {
  status: string;
  version: string;
  ollama_connected: boolean;
  model_loaded: string;
  embedding_model?: string;
  pending_tasks: number;
  processing_tasks: number;
  uptime_seconds: number;
  vram_used_mb?: number;
  vram_total_mb?: number;
};

export type ApiTaskShape = {
  id: string;
  status: string;
  action?: string;
  body?: string;
  output?: string;
  evidence?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  path?: string;
};

export type ApiSearchAccepted = {
  id: string;
  status: string;
  action: "search";
  path: string;
  stream_url: string;
  task_url: string;
};

export type ApiEventShape = {
  type: "task_created" | "task_started" | "task_completed" | "task_failed" | "task_unbound" | "token" | "log";
  task_id?: string;
  data?: unknown;
  timestamp: string;
};

/**
 * Wait for an API task to reach `completed` or `failed`, primarily by
 * subscribing to the daemon SSE stream. A periodic poll of /api/v1/task/:id
 * acts as a backstop so callers still finish if SSE drops the event (network
 * blip, idle reconnect, etc.). Either path is sufficient on its own.
 */
export async function waitForApiTaskTerminal(
  client: GzmoApiClient,
  taskId: string,
  maxSec: number,
  pollSec: number,
  signal?: AbortSignal,
): Promise<"completed" | "failed" | "unbound"> {
  return await new Promise<"completed" | "failed" | "unbound">((resolve, reject) => {
    let settled = false;
    let closeSse: (() => void) | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let deadlineTimer: NodeJS.Timeout | null = null;
    let abortHandler: (() => void) | null = null;

    const cleanup = () => {
      if (closeSse) {
        try { closeSse(); } catch { /* ignore */ }
        closeSse = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      if (abortHandler && signal) {
        signal.removeEventListener("abort", abortHandler);
        abortHandler = null;
      }
    };

    const finish = (s: "completed" | "failed" | "unbound") => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(s);
    };

    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    };

    closeSse = client.connectSSE((ev) => {
      if (ev.task_id !== taskId) return;
      if (ev.type === "task_completed") finish("completed");
      else if (ev.type === "task_unbound") finish("unbound");
      else if (ev.type === "task_failed") finish("failed");
    });

    pollTimer = setInterval(() => {
      void (async () => {
        const t = await client.getTask(taskId, 3000);
        if (!t.ok) return;
        if (t.data.status === "completed") finish("completed");
        else if (t.data.status === "unbound") finish("unbound");
        else if (t.data.status === "failed") finish("failed");
      })();
    }, Math.max(1, pollSec) * 1000);

    deadlineTimer = setTimeout(
      () => fail(new Error(`Timeout after ${maxSec}s waiting for API task ${taskId}`)),
      Math.max(1, maxSec) * 1000,
    );

    if (signal) {
      if (signal.aborted) {
        fail(new Error("Aborted"));
        return;
      }
      abortHandler = () => fail(new Error("Aborted"));
      signal.addEventListener("abort", abortHandler);
    }
  });
}

export class GzmoApiClient {
  readonly baseUrl: string;

  constructor(env: ApiClientEnv = readApiClientEnv()) {
    this.baseUrl = env.baseUrl;
  }

  private async fetchJson(pathSuffix: string, init?: RequestInit & { timeoutMs?: number }) {
    const timeoutMs = init?.timeoutMs ?? 5000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.baseUrl}${pathSuffix}`, {
        ...init,
        signal: init?.signal ?? ac.signal,
      });
      const text = await r.text();
      let data: any = null;
      try {
        data = text.length ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { r, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async health(timeoutMs = 2000): Promise<ApiHealthOk | ApiCallErr> {
    try {
      const { r, data } = await this.fetchJson("/api/v1/health", { timeoutMs });
      if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
      return { ok: true, data: data as ApiHealthShape };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async submitTask(action: GzmoAction, body: string, chainNext?: string): Promise<ApiSubmitOk | ApiCallErr> {
    try {
      const payload: Record<string, unknown> = { action, body };
      if (chainNext) payload.chain_next = chainNext;
      const { r, data } = await this.fetchJson("/api/v1/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
      });
      if (!r.ok) return { ok: false, status: r.status, error: data?.error ?? `HTTP ${r.status}` };
      return { ok: true, id: String(data.id), path: data.path, status: String(data.status ?? "pending") };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getTask(id: string, timeoutMs = 5000): Promise<ApiTaskOk | ApiCallErr> {
    try {
      const { r, data } = await this.fetchJson(`/api/v1/task/${encodeURIComponent(id)}`, { timeoutMs });
      if (!r.ok) return { ok: false, status: r.status, error: data?.error ?? `HTTP ${r.status}` };
      return { ok: true, data: data as ApiTaskShape };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Submit a search task to /api/v1/search and return immediately. The server
   * returns 202 Accepted with `stream_url` and `task_url`; callers then wait
   * for completion via SSE (preferred) or polling /api/v1/task/:id.
   */
  async submitSearch(query: string): Promise<{ ok: true; data: ApiSearchAccepted } | ApiCallErr> {
    try {
      const { r, data } = await this.fetchJson("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        timeoutMs: 10_000,
      });
      if (!r.ok) return { ok: false, status: r.status, error: data?.error ?? `HTTP ${r.status}` };
      return { ok: true, data: data as ApiSearchAccepted };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * High-level search: submit (non-blocking) → wait for completion via SSE
   * (with polling backstop) → fetch and return the answer + evidence packet.
   * The HTTP server never holds a worker for the full duration, so concurrent
   * /health and /task submits stay responsive while the search runs.
   */
  async search(query: string, maxSec = 120, signal?: AbortSignal): Promise<ApiSearchOk | ApiCallErr> {
    const sub = await this.submitSearch(query);
    if (!sub.ok) return sub;
    const id = sub.data.id;

    let terminal: "completed" | "failed" | "unbound";
    try {
      terminal = await waitForApiTaskTerminal(this, id, maxSec, 2, signal);
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const t = await this.getTask(id, 5000);
    if (!t.ok) return t;
    if (terminal === "failed") {
      return {
        ok: false,
        error: t.data.error ?? "Search task failed",
        status: 500,
      };
    }
    if (terminal === "unbound") {
      return {
        ok: false,
        error: t.data.error ?? "Search halted — clarification needed (status: unbound)",
        status: 422,
      };
    }

    const answer = t.data.output ?? t.data.body ?? "";
    return {
      ok: true,
      answer,
      evidence: t.data.evidence,
      trace_id: id,
      task_path: t.data.path ?? sub.data.path,
    };
  }

  /**
   * Subscribe to the daemon SSE stream. Returns a function that closes the
   * underlying connection. Resilient to disconnects: callers are responsible
   * for re-subscribing if they want long-lived listening.
   */
  connectSSE(onEvent: (ev: ApiEventShape) => void, onClose?: () => void): () => void {
    const ac = new AbortController();
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      try {
        ac.abort();
      } catch { /* ignore */ }
      onClose?.();
    };

    (async () => {
      try {
        const r = await fetch(`${this.baseUrl}/api/v1/stream`, {
          headers: { Accept: "text/event-stream" },
          signal: ac.signal,
        });
        if (!r.ok || !r.body) {
          close();
          return;
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let eventEnd: number;
          while ((eventEnd = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, eventEnd);
            buf = buf.slice(eventEnd + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                onEvent(JSON.parse(payload) as ApiEventShape);
              } catch { /* malformed event */ }
            }
          }
        }
      } catch { /* aborted or network error */ }
      close();
    })();

    return close;
  }
}
