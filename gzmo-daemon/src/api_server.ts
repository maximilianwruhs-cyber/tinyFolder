/**
 * api_server.ts — Local-only HTTP API for the GZMO daemon.
 *
 * Exposes the engine via REST + Server-Sent Events. By design:
 *   • Binds to 127.0.0.1 (or a Unix socket) — no external exposure.
 *   • CORS is locked to loopback origins when GZMO_LOCAL_ONLY=1.
 *   • Tasks are written to GZMO/Inbox/ exactly like the file watcher path,
 *     so the watcher remains the single source of truth for the engine.
 *   • The HTTP layer is a thin shell: the watcher + processTask() do the work,
 *     and this server just publishes lifecycle events back to subscribers.
 *
 * The server is started by index.ts after the watcher boots, when
 * GZMO_API_ENABLED=1.
 */

import type { Server } from "bun";
import { promises as fsp } from "fs";
import { existsSync, mkdirSync } from "fs";
import { basename, join, resolve } from "path";
import crypto from "node:crypto";

import { readBoolEnv, readIntEnv } from "./pipelines/helpers";
import { TaskDocument } from "./frontmatter";
import { atomicWriteFile } from "./atomic_write";
import { apiEventEmitter } from "./api_events";
import type {
  ApiEvent,
  ApiHealthResponse,
  ApiSearchAcceptedResponse,
  ApiSearchRequest,
  ApiTaskRequest,
  ApiTaskResponse,
  ApiTaskStatus,
} from "./api_types";

const API_VERSION = "0.4.0-api";

const LOCAL_ONLY = readBoolEnv("GZMO_LOCAL_ONLY", false);
const API_HOST = process.env.GZMO_API_HOST?.trim() || "127.0.0.1";
const API_PORT = readIntEnv("GZMO_API_PORT", 12700, 1024, 65535);
const API_SOCKET = process.env.GZMO_API_SOCKET?.trim() || "";

/**
 * In-memory mirror of recently-submitted tasks. The canonical state lives
 * on disk inside the inbox; this map is just a fast lookup cache for the
 * synchronous /api/v1/task/:id endpoint.
 */
const taskRegistry = new Map<string, ApiTaskResponse>();

const startedAtMs = Date.now();

function resolveVaultPath(): string {
  const vp = process.env.VAULT_PATH;
  if (!vp) throw new Error("VAULT_PATH is not set; cannot serve /api/v1/* requests.");
  return resolve(vp);
}

function inboxDirFor(vaultPath: string): string {
  return join(vaultPath, "GZMO", "Inbox");
}

function ensureInboxDir(vaultPath: string): string {
  const dir = inboxDirFor(vaultPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function allowOrigin(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  if (LOCAL_ONLY) {
    if (origin.startsWith("http://127.") || origin.startsWith("http://localhost")) return origin;
    return "http://localhost";
  }
  return origin || "*";
}

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin(req),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse<T>(data: T, status: number, req: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
    },
  });
}

function badJson(req: Request): Response {
  return jsonResponse({ error: "Invalid JSON body" }, 400, req);
}

function extractResponse(body: string): string {
  const idx = body.indexOf("## GZMO Response");
  if (idx >= 0) {
    const after = body.slice(idx + "## GZMO Response".length);
    return after.trim();
  }
  return body.trim();
}

function extractEvidence(body: string): string | undefined {
  const idx = body.indexOf("## Evidence Packet");
  if (idx < 0) return undefined;
  const end = body.indexOf("## GZMO Response", idx);
  const raw = end > idx ? body.slice(idx, end) : body.slice(idx);
  return raw.trim();
}

function statusOf(doc: TaskDocument): ApiTaskStatus {
  const s = String(doc.frontmatter.status ?? "pending").toLowerCase();
  if (s === "processing" || s === "completed" || s === "failed") return s;
  return "pending";
}

async function findInboxFileByApiId(vaultPath: string, id: string): Promise<string | null> {
  const dir = inboxDirFor(vaultPath);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const needle = `api_id: ${id}`;
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const p = join(dir, f);
    try {
      const text = await fsp.readFile(p, "utf8");
      if (text.includes(needle)) return p;
    } catch {
      // ignore unreadable files
    }
  }
  return null;
}

async function buildHealthResponse(vaultPath: string): Promise<ApiHealthResponse> {
  let pending = 0;
  let processing = 0;
  try {
    const dir = inboxDirFor(vaultPath);
    const files = await fsp.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      try {
        const raw = await fsp.readFile(join(dir, f), "utf8");
        const m = raw.match(/^\s*status:\s*(\w+)\s*$/m);
        const s = (m?.[1] ?? "").toLowerCase();
        if (s === "pending") pending++;
        else if (s === "processing") processing++;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore: inbox may not exist yet
  }

  let ollamaConnected = false;
  try {
    const ollamaUrl = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/v1\/?$/, "");
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    ollamaConnected = r.ok;
  } catch {
    ollamaConnected = false;
  }

  const status: ApiHealthResponse["status"] = ollamaConnected ? "healthy" : "degraded";
  return {
    status,
    version: API_VERSION,
    ollama_connected: ollamaConnected,
    model_loaded: process.env.OLLAMA_MODEL ?? "hermes3:8b",
    embedding_model: process.env.GZMO_EMBED_MODEL ?? "nomic-embed-text",
    pending_tasks: pending,
    processing_tasks: processing,
    uptime_seconds: Math.round((Date.now() - startedAtMs) / 1000),
    vault_path: vaultPath,
    // Bridge: until a live nvidia-smi / Ollama metrics scraper lands, accept
    // GZMO_VRAM_USED_MB / GZMO_VRAM_TOTAL_MB from .env. `|| undefined` ensures
    // we publish the fields only when the operator actually set them.
    // Publish VRAM fields only when the operator explicitly set them.
    // Explicit 0 is accepted (e.g. fresh boot before Ollama loads).
    vram_used_mb: process.env.GZMO_VRAM_USED_MB ? Number.parseInt(process.env.GZMO_VRAM_USED_MB, 10) : undefined,
    vram_total_mb: process.env.GZMO_VRAM_TOTAL_MB ? Number.parseInt(process.env.GZMO_VRAM_TOTAL_MB, 10) : undefined,
  };
}

function sseStreamResponse(req: Request): Response {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let handler: ((ev: ApiEvent) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream closed; ignore.
        }
      };

      send(`:hello ${new Date().toISOString()}\n\n`);

      handler = (ev: ApiEvent) => {
        const text = `event: ${ev.type}\nid: ${crypto.randomUUID()}\ndata: ${JSON.stringify(ev)}\n\n`;
        send(text);
      };
      apiEventEmitter.on(handler);

      interval = setInterval(() => send(":keep-alive\n\n"), 15_000);

      req.signal.addEventListener("abort", () => {
        if (interval) clearInterval(interval);
        if (handler) apiEventEmitter.off(handler);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (handler) apiEventEmitter.off(handler);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeaders(req),
    },
  });
}

async function handleTaskSubmit(req: Request): Promise<Response> {
  let body: ApiTaskRequest;
  try {
    body = (await req.json()) as ApiTaskRequest;
  } catch {
    return badJson(req);
  }

  const action = body?.action;
  if (action !== "think" && action !== "search" && action !== "chain") {
    return jsonResponse({ error: "action must be 'think' | 'search' | 'chain'" }, 400, req);
  }
  if (typeof body.body !== "string" || body.body.trim() === "") {
    return jsonResponse({ error: "body is required" }, 400, req);
  }
  if (action === "chain" && !body.chain_next) {
    return jsonResponse({ error: "chain_next is required when action='chain'" }, 400, req);
  }

  const id = body.id?.trim() || crypto.randomUUID();
  const vaultPath = resolveVaultPath();
  const inboxDir = ensureInboxDir(vaultPath);

  const filename = `api_${Date.now()}_${id.slice(0, 8)}.md`;
  const filePath = join(inboxDir, filename);

  const fmLines = ["---", "status: pending", `action: ${action}`, `api_id: ${id}`];
  if (body.chain_next) fmLines.push(`chain_next: ${body.chain_next}`);
  fmLines.push("---");
  const fullMd = `${fmLines.join("\n")}\n\n${body.body.trim()}\n`;

  await atomicWriteFile(filePath, fullMd);

  const now = new Date().toISOString();
  const initial: ApiTaskResponse = {
    id,
    status: "pending",
    action,
    body: body.body,
    started_at: now,
    path: filePath,
  };
  taskRegistry.set(id, initial);

  apiEventEmitter.emit({
    type: "task_created",
    task_id: id,
    data: { path: filePath, action },
    timestamp: now,
  });

  return jsonResponse({ id, status: "pending", path: filePath, action }, 202, req);
}

async function handleTaskGet(id: string, req: Request): Promise<Response> {
  if (!id) return jsonResponse({ error: "Missing task id" }, 400, req);
  const vaultPath = resolveVaultPath();

  const cached = taskRegistry.get(id);

  const filePath = await findInboxFileByApiId(vaultPath, id);
  if (filePath) {
    const doc = await TaskDocument.load(filePath);
    if (doc) {
      const status = statusOf(doc);
      const fm = doc.frontmatter as Record<string, unknown>;
      const output = doc.body.includes("## GZMO Response") ? extractResponse(doc.body) : undefined;
      const evidence = extractEvidence(doc.body);
      const resp: ApiTaskResponse = {
        id,
        status,
        action: String(fm.action ?? cached?.action ?? "think"),
        body: doc.body,
        output,
        evidence,
        started_at: typeof fm.started_at === "string" ? fm.started_at : cached?.started_at,
        completed_at: typeof fm.completed_at === "string" ? fm.completed_at : cached?.completed_at,
        path: filePath,
      };
      taskRegistry.set(id, resp);
      return jsonResponse(resp, 200, req);
    }
  }

  if (cached) return jsonResponse(cached, 200, req);
  return jsonResponse({ error: "Task not found" }, 404, req);
}

/**
 * Non-blocking search handler.
 *
 * Drops a `search` task into the inbox like the file watcher path, returns
 * 202 Accepted immediately, and lets the client observe completion via:
 *   1. GET /api/v1/stream  (SSE — `task_completed` carries the matching task_id)
 *   2. GET /api/v1/task/:id (poll fallback — same canonical state on disk)
 *
 * No HTTP worker is held open for the duration of the engine work, so
 * /health and concurrent /task submits never queue behind a search.
 */
async function handleSearch(req: Request): Promise<Response> {
  let body: ApiSearchRequest;
  try {
    body = (await req.json()) as ApiSearchRequest;
  } catch {
    return badJson(req);
  }
  const query = (body?.query ?? "").trim();
  if (!query) return jsonResponse({ error: "query is required" }, 400, req);

  const id = crypto.randomUUID();
  const vaultPath = resolveVaultPath();
  const inboxDir = ensureInboxDir(vaultPath);
  const filename = `api_search_${Date.now()}_${id.slice(0, 8)}.md`;
  const filePath = join(inboxDir, filename);

  const fmLines = ["---", "status: pending", "action: search", `api_id: ${id}`, "---"];
  await atomicWriteFile(filePath, `${fmLines.join("\n")}\n\n${query}\n`);

  const now = new Date().toISOString();
  taskRegistry.set(id, {
    id,
    status: "pending",
    action: "search",
    body: query,
    started_at: now,
    path: filePath,
  });

  apiEventEmitter.emit({
    type: "task_created",
    task_id: id,
    data: { path: filePath, action: "search" },
    timestamp: now,
  });

  const accepted: ApiSearchAcceptedResponse = {
    id,
    status: "pending",
    action: "search",
    path: filePath,
    stream_url: "/api/v1/stream",
    task_url: `/api/v1/task/${id}`,
  };
  return jsonResponse(accepted, 202, req);
}

export interface StartApiServerOptions {
  /**
   * Optional callback invoked once the server is listening. Useful for tests.
   */
  onReady?: (info: { host: string; port: number; socket: string }) => void;
}

export function startApiServer(opts?: StartApiServerOptions): Server<unknown> {
  const useSocket = API_SOCKET.length > 0;

  const serveOptions: Parameters<typeof Bun.serve>[0] = useSocket
    ? ({
        unix: API_SOCKET,
        fetch: routeRequest,
      } as unknown as Parameters<typeof Bun.serve>[0])
    : {
        hostname: API_HOST,
        port: API_PORT,
        fetch: routeRequest,
      };

  const server = Bun.serve(serveOptions);

  const where = useSocket ? `unix:${API_SOCKET}` : `http://${API_HOST}:${API_PORT}`;
  console.log(`[API] Server listening at ${where}`);
  if (LOCAL_ONLY) console.log("[API] LOCAL_ONLY=1 — only loopback origins permitted by CORS.");
  console.log("[API] Routes:");
  console.log("[API]   GET  /api/v1/health");
  console.log("[API]   POST /api/v1/task        (action: think|search|chain)");
  console.log("[API]   GET  /api/v1/task/:id    (also exposes 'output' + 'evidence')");
  console.log("[API]   POST /api/v1/search      (async — 202 + stream_url)");
  console.log("[API]   GET  /api/v1/stream      (SSE)");

  opts?.onReady?.({ host: API_HOST, port: API_PORT, socket: API_SOCKET });

  return server;
}

async function routeRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return jsonResponse({ error: "Invalid URL" }, 400, req);
  }
  const pathname = url.pathname;

  try {
    if (pathname === "/api/v1/health" && req.method === "GET") {
      const vaultPath = resolveVaultPath();
      const health = await buildHealthResponse(vaultPath);
      return jsonResponse(health, 200, req);
    }

    if (pathname === "/api/v1/stream" && req.method === "GET") {
      return sseStreamResponse(req);
    }

    if (pathname === "/api/v1/task" && req.method === "POST") {
      return await handleTaskSubmit(req);
    }

    if (pathname.startsWith("/api/v1/task/") && req.method === "GET") {
      const id = decodeURIComponent(pathname.slice("/api/v1/task/".length));
      return await handleTaskGet(id, req);
    }

    if (pathname === "/api/v1/search" && req.method === "POST") {
      return await handleSearch(req);
    }

    if (pathname === "/" || pathname === "/api/v1" || pathname === "/api/v1/") {
      return jsonResponse(
        { name: "gzmo-daemon", version: API_VERSION, routes: ["/api/v1/health", "/api/v1/task", "/api/v1/search", "/api/v1/stream"] },
        200,
        req,
      );
    }

    return jsonResponse({ error: "Not found", path: pathname }, 404, req);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[API] Unhandled error on ${pathname}:`, msg);
    return jsonResponse({ error: msg }, 500, req);
  }
}

/** Visible for tests — clears the in-memory registry. */
export function _clearTaskRegistry(): void {
  taskRegistry.clear();
}
