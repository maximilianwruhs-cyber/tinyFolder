/**
 * api_server.test.ts — end-to-end tests for the GZMO HTTP API.
 *
 * Each test spawns the real Bun server on an ephemeral port against a temp
 * vault and exercises the contract from a real HTTP client. The watcher /
 * engine are NOT involved — these tests verify the HTTP layer's responses,
 * status codes, security gates, and SSE plumbing only.
 *
 * IMPORTANT: api_server.ts reads several env vars at IMPORT TIME (LOCAL_ONLY,
 * MAX_BODY_BYTES, etc). To exercise different configurations we set env vars
 * BEFORE importing the module dynamically inside each block.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpVault = "";

function mkVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "gzmo-api-test-"));
  mkdirSync(join(dir, "GZMO", "Inbox"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpVault = mkVault();
  process.env.VAULT_PATH = tmpVault;
});

afterEach(() => {
  if (tmpVault) {
    try { rmSync(tmpVault, { recursive: true, force: true }); } catch { /* ignore */ }
    tmpVault = "";
  }
  // Reset env we mutate so other tests run untouched.
  delete process.env.GZMO_API_TOKEN;
  delete process.env.GZMO_API_HOST;
  delete process.env.GZMO_LOCAL_ONLY;
  delete process.env.GZMO_API_ALLOW_INSECURE;
  delete process.env.GZMO_API_MAX_BODY_BYTES;
  delete process.env.GZMO_API_MAX_QUERY_CHARS;
});

const TEST_API_TOKEN = "test-api-token";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TEST_API_TOKEN}`, ...extra };
}

/**
 * Spawn a fresh server on an ephemeral port. Re-imports `api_server` after
 * setting env so module-level constants see the configuration we want.
 */
async function startTestServer(envOverrides: Record<string, string> = {}): Promise<{
  base: string;
  stop: () => void;
  clearRegistry: () => void;
  token: string;
}> {
  const defaults: Record<string, string> = {
    GZMO_API_TOKEN: TEST_API_TOKEN,
    GZMO_LOCAL_ONLY: "1",
  };
  Object.assign(process.env, defaults, envOverrides);
  // Bun caches dynamic imports per-URL — append a query string to bust the cache
  // so module-level reads of process.env take effect every test.
  const cacheBust = `?t=${Date.now()}_${Math.random()}`;
  const mod = (await import(`../api_server${cacheBust}`)) as typeof import("../api_server");
  // Use a high random port to minimise collisions when tests run in parallel.
  const port = 13000 + Math.floor(Math.random() * 5000);
  process.env.GZMO_API_PORT = String(port);
  // We have to re-import since GZMO_API_PORT is also captured at module scope.
  const mod2 = (await import(`../api_server?p=${port}`)) as typeof import("../api_server");
  const server = mod2.startApiServer();
  mod._clearTaskRegistry?.();
  mod2._clearTaskRegistry?.();
  const token = process.env.GZMO_API_TOKEN?.trim() || "";
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => server.stop(true),
    clearRegistry: () => {
      mod._clearTaskRegistry?.();
      mod2._clearTaskRegistry?.();
    },
    token,
  };
}

describe("api_server: /health", () => {
  test("returns 200 with version + counts", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/health`, { headers: authHeaders() });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { version: string; pending_tasks: number; processing_tasks: number };
      expect(body.version).toBeDefined();
      expect(body.pending_tasks).toBe(0);
      expect(body.processing_tasks).toBe(0);
    } finally {
      srv.stop();
    }
  });
});

describe("api_server: POST /task", () => {
  test("rejects unknown action with 400", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "nope", body: "hi" }),
      });
      expect(r.status).toBe(400);
    } finally {
      srv.stop();
    }
  });

  test("accepts a think task and writes the inbox file", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "think", body: "what time is it" }),
      });
      expect(r.status).toBe(202);
      const body = (await r.json()) as { id: string; status: string; path: string; action: string };
      expect(body.status).toBe("pending");
      expect(body.action).toBe("think");
      expect(body.path).toContain("GZMO/Inbox");
      // The file should be readable and contain the api_id we got back.
      const md = await Bun.file(body.path).text();
      expect(md).toContain(`api_id: ${body.id}`);
      expect(md).toContain("status: pending");
      expect(md).toContain("what time is it");
    } finally {
      srv.stop();
    }
  });

  test("S4: rejects chain_next with directory traversal", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "chain", body: "next", chain_next: "../escape.md" }),
      });
      expect(r.status).toBe(400);
      const body = (await r.json()) as { error: string };
      expect(body.error).toContain("chain_next");
    } finally {
      srv.stop();
    }
  });

  test("S4: rejects chain_next with embedded newline (YAML break)", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "chain", body: "x", chain_next: "ok.md\nstatus: completed" }),
      });
      expect(r.status).toBe(400);
    } finally {
      srv.stop();
    }
  });

  test("S4: accepts a clean chain_next filename", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "chain", body: "x", chain_next: "next-step_v2.md" }),
      });
      expect(r.status).toBe(202);
    } finally {
      srv.stop();
    }
  });

  test("S5: rejects oversize body with 413", async () => {
    const srv = await startTestServer({ GZMO_API_MAX_BODY_BYTES: "2048" });
    try {
      const big = "x".repeat(4096);
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "think", body: big }),
      });
      expect(r.status).toBe(413);
    } finally {
      srv.stop();
    }
  });
});

describe("api_server: GET /task/:id (polling)", () => {
  test("404 for unknown id", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/task/does-not-exist`, { headers: authHeaders() });
      expect(r.status).toBe(404);
    } finally {
      srv.stop();
    }
  });

  test("returns the cached pending task immediately after submit", async () => {
    const srv = await startTestServer();
    try {
      const sub = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "think", body: "hello" }),
      });
      const submitted = (await sub.json()) as { id: string };
      const r = await fetch(`${srv.base}/api/v1/task/${submitted.id}`, { headers: authHeaders() });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { id: string; status: string };
      expect(body.id).toBe(submitted.id);
      // Engine isn't running in tests — task stays pending. That's fine.
      expect(["pending", "processing"]).toContain(body.status);
    } finally {
      srv.stop();
    }
  });
});

describe("api_server: POST /search (async 202 contract)", () => {
  test("returns 202 with stream_url + task_url", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/search`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ query: "what is the meaning of life" }),
      });
      expect(r.status).toBe(202);
      const body = (await r.json()) as { id: string; status: string; stream_url: string; task_url: string };
      expect(body.status).toBe("pending");
      expect(body.stream_url).toBe("/api/v1/stream");
      expect(body.task_url).toBe(`/api/v1/task/${body.id}`);
    } finally {
      srv.stop();
    }
  });

  test("rejects empty query with 400", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/search`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ query: "  " }),
      });
      expect(r.status).toBe(400);
    } finally {
      srv.stop();
    }
  });

  test("S5: rejects oversize query with 413", async () => {
    const srv = await startTestServer({ GZMO_API_MAX_QUERY_CHARS: "32" });
    try {
      const r = await fetch(`${srv.base}/api/v1/search`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ query: "x".repeat(64) }),
      });
      expect(r.status).toBe(413);
    } finally {
      srv.stop();
    }
  });
});

describe("api_server: GET /stream (SSE)", () => {
  test("emits task_created when a task is submitted", async () => {
    const srv = await startTestServer();
    try {
      // Open SSE first so we don't miss the event.
      const sseAbort = new AbortController();
      const ssePromise = (async () => {
        const r = await fetch(`${srv.base}/api/v1/stream`, { signal: sseAbort.signal, headers: authHeaders() });
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toContain("text/event-stream");
        const reader = r.body!.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value);
          if (acc.includes("event: task_created")) return acc;
        }
        return acc;
      })();

      // Tiny delay so the SSE handler is registered before we emit.
      await new Promise((r) => setTimeout(r, 80));

      const sub = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "think", body: "ping" }),
      });
      expect(sub.status).toBe(202);

      const acc = await ssePromise;
      sseAbort.abort();
      expect(acc).toContain("event: task_created");
    } finally {
      srv.stop();
    }
  });
});

describe("api_server: S3 bearer auth", () => {
  test("rejects unauthorized requests with 401 when GZMO_API_TOKEN is set", async () => {
    const srv = await startTestServer({ GZMO_API_TOKEN: "supersecret" });
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "think", body: "hi" }),
      });
      expect(r.status).toBe(401);
    } finally {
      srv.stop();
    }
  });

  test("accepts requests with the right Bearer token", async () => {
    const srv = await startTestServer({ GZMO_API_TOKEN: "supersecret" });
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer supersecret" },
        body: JSON.stringify({ action: "think", body: "hi" }),
      });
      expect(r.status).toBe(202);
    } finally {
      srv.stop();
    }
  });

  test("/health requires Bearer when GZMO_API_TOKEN is set", async () => {
    const srv = await startTestServer({ GZMO_API_TOKEN: "supersecret" });
    try {
      const r = await fetch(`${srv.base}/api/v1/health`);
      expect(r.status).toBe(401);
      const ok = await fetch(`${srv.base}/api/v1/health`, {
        headers: { authorization: "Bearer supersecret" },
      });
      expect(ok.status).toBe(200);
    } finally {
      srv.stop();
    }
  });
});

describe("api_server: api_id validation", () => {
  test("rejects api_id with embedded newline (YAML break)", async () => {
    const srv = await startTestServer();
    try {
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "think", body: "hi", id: "ok\nstatus: completed" }),
      });
      expect(r.status).toBe(400);
    } finally {
      srv.stop();
    }
  });

  test("accepts UUID api_id", async () => {
    const srv = await startTestServer();
    try {
      const id = "550e8400-e29b-41d4-a716-446655440000";
      const r = await fetch(`${srv.base}/api/v1/task`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "think", body: "hi", id }),
      });
      expect(r.status).toBe(202);
      const body = (await r.json()) as { id: string };
      expect(body.id).toBe(id);
    } finally {
      srv.stop();
    }
  });
});

describe("api_server: S1 boot guard", () => {
  test("startApiServer throws when LOCAL_ONLY=1 + GZMO_API_HOST is non-loopback", async () => {
    process.env.GZMO_LOCAL_ONLY = "1";
    process.env.GZMO_API_HOST = "0.0.0.0";
    process.env.GZMO_API_TOKEN = TEST_API_TOKEN;
    process.env.GZMO_API_PORT = String(13000 + Math.floor(Math.random() * 5000));
    const cacheBust = `?bind=${Date.now()}_${Math.random()}`;
    const mod = (await import(`../api_server${cacheBust}`)) as typeof import("../api_server");
    expect(() => mod.startApiServer()).toThrow(/loopback/i);
  });

  test("startApiServer throws when GZMO_API_TOKEN is unset", async () => {
    delete process.env.GZMO_API_TOKEN;
    delete process.env.GZMO_API_ALLOW_INSECURE;
    process.env.GZMO_API_HOST = "127.0.0.1";
    process.env.GZMO_API_PORT = String(13000 + Math.floor(Math.random() * 5000));
    const cacheBust = `?notoken=${Date.now()}_${Math.random()}`;
    const mod = (await import(`../api_server${cacheBust}`)) as typeof import("../api_server");
    expect(() => mod.startApiServer()).toThrow(/GZMO_API_TOKEN/);
  });

  test("startApiServer throws when public bind has no token", async () => {
    process.env.GZMO_LOCAL_ONLY = "0";
    process.env.GZMO_API_HOST = "0.0.0.0";
    delete process.env.GZMO_API_TOKEN;
    delete process.env.GZMO_API_ALLOW_INSECURE;
    process.env.GZMO_API_PORT = String(13000 + Math.floor(Math.random() * 5000));
    const cacheBust = `?token=${Date.now()}_${Math.random()}`;
    const mod = (await import(`../api_server${cacheBust}`)) as typeof import("../api_server");
    expect(() => mod.startApiServer()).toThrow(/GZMO_API_TOKEN/);
  });

  test("startApiServer allows insecure mode when GZMO_API_ALLOW_INSECURE=1", async () => {
    delete process.env.GZMO_API_TOKEN;
    process.env.GZMO_API_ALLOW_INSECURE = "1";
    process.env.GZMO_API_HOST = "127.0.0.1";
    process.env.GZMO_API_PORT = String(13000 + Math.floor(Math.random() * 5000));
    const cacheBust = `?insecure=${Date.now()}_${Math.random()}`;
    const mod = (await import(`../api_server${cacheBust}`)) as typeof import("../api_server");
    const server = mod.startApiServer();
    server.stop(true);
  });
});

describe("api_server: S2 CORS loopback parsing", () => {
  test("does not echo origin with attacker-controlled hostname", async () => {
    const srv = await startTestServer({ GZMO_LOCAL_ONLY: "1" });
    try {
      const r = await fetch(`${srv.base}/api/v1/health`, {
        headers: authHeaders({ origin: "http://localhost.evil.com" }),
      });
      // The previous startsWith bug would have echoed the attacker origin.
      const acao = r.headers.get("access-control-allow-origin") ?? "";
      expect(acao).not.toContain("evil");
      // Vary: Origin must accompany dynamic ACAO.
      expect((r.headers.get("vary") ?? "").toLowerCase()).toContain("origin");
    } finally {
      srv.stop();
    }
  });

  test("echoes legitimate http://127.0.0.1:port origin", async () => {
    const srv = await startTestServer({ GZMO_LOCAL_ONLY: "1" });
    try {
      const r = await fetch(`${srv.base}/api/v1/health`, {
        headers: authHeaders({ origin: "http://127.0.0.1:5173" }),
      });
      expect(r.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    } finally {
      srv.stop();
    }
  });
});
