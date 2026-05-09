# tinyFolder + pi — Unified Local Agent Stack
## Comprehensive Step-by-Step Implementation Guide

**Version:** 1.0  
**Goal:** Merge `tinyFolder` (GZMO Backend) with `pi` (TUI Frontend) into a single, fully-local, unified agent stack.  
**Constraint:** Zero external network dependencies in final mode. Everything runs on `localhost`.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites & Environment](#2-prerequisites--environment)
3. [Phase 1 — Backend API Layer](#3-phase-1--backend-api-layer)
4. [Phase 2 — Pi Extension 2.0](#4-phase-2--pi-extension-20)
5. [Phase 3 — Performance Stack](#5-phase-3--performance-stack)
6. [Phase 4 — UI/UX Polish](#6-phase-4--uiux-polish)
7. [Phase 5 — Local-Only Distribution](#7-phase-5--local-only-distribution)
8. [Troubleshooting Matrix](#8-troubleshooting-matrix)
9. [Environment Reference](#9-environment-reference)
10. [Migration Path](#10-migration-path-from-file-only-to-api-hybrid)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  pi TUI — Frontend                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │
│  │ Chat Input  │  │ /gzmo Dash  │  │ Footer: GZMO ● Ollama ●     │ │
│  └──────┬──────┘  └─────────────┘  └─────────────────────────────┘ │
│         │                                                           │
│  ┌──────┴──────────────────────────────────────────────────────┐    │
│  │  Extension: gzmo-tinyfolder.ts (v2.0)                       │    │
│  │  • Daemon lifecycle mgmt    • API client + SSE consumer     │    │
│  │  • Fast SLM intent parser     • File-system fallback          │    │
│  └──────┬──────────────────────────────────────────────────────┘    │
└─────────┼───────────────────────────────────────────────────────────┘
          │
          ▼ localhost:12700 (or Unix socket /tmp/gzmo.sock)
┌─────────────────────────────────────────────────────────────────────┐
│  GZMO DAEMON — Backend (Bun + Ollama)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ HTTP API    │  │ Inbox       │  │ Engine      │  │ Embedding  │ │
│  │ /task       │  │ Watcher     │  │ think/search│  │ Sync       │ │
│  │ /search     │  │ (legacy)    │  │ /chain      │  │ (nomic)    │ │
│  │ /stream     │  │             │  │             │  │            │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────────────┘ │
│         └─────────────────┴─────────────────┘                       │
│                            │                                        │
│                    ┌───────┴────────┐                               │
│                    │   OLLAMA       │                               │
│                    │  • Main LLM    │                               │
│                    │  • Embedder    │                               │
│                    │  • Draft/Rank  │                               │
│                    └────────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │  Vault (Markdown FS)  │
                    │  GZMO/Inbox, wiki,    │
                    │  Traces, Ledger, KG   │
                    └──────────────────────┘
```

**Design Principles**
1. **Unified Contract:** Both file-watcher and API feed into the same `processTask()` engine.
2. **Fail-Closed:** API is opt-in. If API is off, file-system fallback works exactly as today.
3. **Zero-Trust Local:** Bind to `127.0.0.1` or Unix socket only. No external exposure.
4. **Streaming-First:** Wherever possible, stream tokens/events rather than polling.

---

## 2. Prerequisites & Environment

### 2.1 Required Software

| Component | Version | Install Command |
|-----------|---------|-----------------|
| Ubuntu (or similar) | 22.04+ | — |
| Bun | 1.1+ | `curl -fsSL https://bun.sh/install \| bash` |
| Ollama | 0.3+ | `curl -fsSL https://ollama.com/install.sh \| sh` |
| pi (TUI) | latest | `npm install -g @mariozechner/pi-coding-agent` |
| Node.js (for pi) | 20+ | `nvm install 20` |

### 2.2 Hardware Recommendations

| Profile | GPU | VRAM | Models | Notes |
|---------|-----|------|--------|-------|
| `minimal` | None / iGPU | 8 GB RAM | phi3:mini | CPU inference |
| `core` | GTX 4060+ | 8 GB VRAM | hermes3:8b | Entry-level local |
| `standard` | RTX 4090 | 24 GB VRAM | qwen3:32b, EXL2 | Sweet spot |
| `full` | RTX 5090 | 32 GB VRAM | qwen3:32b reasoning + Draft + Rerank | Target spec for this guide |

### 2.3 Model Pull List (for `full` profile)

```bash
# Primary reasoning model
ollama pull qwen3:32b

# Alternative default (if VRAM is tight)
ollama pull hermes3:8b

# Embedding
ollama pull nomic-embed-text

# Fast draft for speculative decoding (same tokenizer family as Hermes/Qwen)
ollama pull qwen2.5:0.5b

# Intent router / query rewriter (on pi side, optional)
ollama pull phi3.5:3.8b
```

### 2.4 Base `.env` File

Create `gzmo-daemon/.env`:

```bash
# ── Paths ─────────────────────────────────────────
VAULT_PATH="/home/mw/vault"              # MUST be absolute

# ── Ollama ────────────────────────────────────────
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="qwen3:32b"                 # or hermes3:8b

# ── API Server (Phase 1) ──────────────────────────
GZMO_API_ENABLED="1"
GZMO_API_HOST="127.0.0.1"
GZMO_API_PORT="12700"
# GZMO_API_SOCKET="/tmp/gzmo.sock"      # Optional: use instead of TCP

# ── Retrieval Stack ───────────────────────────────
GZMO_MULTIQUERY="on"
GZMO_RERANK_LLM="on"
GZMO_ANCHOR_PRIOR="on"
GZMO_MIN_RETRIEVAL_SCORE="0.32"

# ── Multi-Model Routing (Phase 3) ─────────────────
GZMO_FAST_MODEL="qwen2.5:0.5b"
GZMO_REASON_MODEL="qwen3:32b"
GZMO_JUDGE_MODEL="qwen3:32b"
GZMO_ENABLE_MODEL_ROUTING="on"

# ── Reasoning & Tools ─────────────────────────────
GZMO_ENABLE_TRACES="on"
GZMO_ENABLE_TOOLS="on"
GZMO_MAX_TOOL_CALLS="3"
GZMO_ENABLE_TOT="on"
GZMO_TOT_MAX_NODES="15"
GZMO_TOT_MIN_SCORE="0.5"

# ── Safety ────────────────────────────────────────
GZMO_VERIFY_SAFETY="1"
GZMO_ENABLE_SELF_EVAL="1"

# ── Local-Only Lock (Phase 5) ─────────────────────
GZMO_LOCAL_ONLY="1"
```

---

## 3. Phase 1 — Backend API Layer

**Goal:** Add an HTTP server inside `gzmo-daemon` that exposes the engine via REST + SSE.

### 3.1 File: `gzmo-daemon/src/api_types.ts`

Create this first. Shared types for API contracts.

```typescript
/**
 * api_types.ts — Shared contract between GZMO daemon HTTP API and pi extension.
 */

export interface ApiTaskRequest {
  id?: string;                 // client-provided optional ID
  action: "think" | "search" | "chain";
  body: string;
  chain_next?: string;
  stream?: boolean;            // if true, return SSE stream
}

export interface ApiTaskResponse {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  action: string;
  body: string;
  output?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  trace_id?: string;
}

export interface ApiSearchRequest {
  query: string;
  top_k?: number;
  stream?: boolean;
}

export interface ApiSearchResponse {
  query: string;
  answer: string;
  evidence?: string;
  citations: Array<{ id: string; file: string; text: string }>;
  trace_id: string;
}

export interface ApiHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  ollama_connected: boolean;
  model_loaded: string;
  embedding_model: string;
  pending_tasks: number;
  processing_tasks: number;
  uptime_seconds: number;
  vram_used_mb?: number;
  vram_total_mb?: number;
}

export interface ApiEvent {
  type: "task_created" | "task_started" | "task_completed" | "task_failed" | "token" | "log";
  task_id?: string;
  data?: unknown;
  timestamp: string;
}
```

### 3.2 File: `gzmo-daemon/src/api_server.ts`

The main server implementation using `Bun.serve()`.

```typescript
/**
 * api_server.ts — Local-only HTTP API for GZMO daemon.
 * Binds to 127.0.0.1 (or Unix socket) only. No external exposure.
 */

import { type Server, type ServerWebSocket } from "bun";
import { resolve, join, basename } from "path";
import { existsSync, mkdirSync } from "fs";
import { readBoolEnv, readIntEnv } from "./pipelines/helpers";
import { processTask } from "./engine";
import { VaultWatcher, type TaskEvent } from "./watcher";
import type { PulseLoop } from "./pulse";
import type { EmbeddingStore } from "./embeddings";
import type { TaskMemory } from "./memory";
import { TaskDocument } from "./frontmatter";
import { atomicWriteFile } from "./vault_fs"; // Create atomicWriteFile if not present
import crypto from "node:crypto";
import type {
  ApiTaskRequest,
  ApiTaskResponse,
  ApiSearchRequest,
  ApiSearchResponse,
  ApiHealthResponse,
  ApiEvent,
} from "./api_types";

const LOCAL_ONLY = readBoolEnv("GZMO_LOCAL_ONLY", false);
const API_HOST = process.env.GZMO_API_HOST ?? "127.0.0.1";
const API_PORT = readIntEnv("GZMO_API_PORT", 12700, 1024, 65535);
const API_SOCKET = process.env.GZMO_API_SOCKET ?? "";

// In-memory task registry (ephemeral; canonical state is still on disk)
const taskRegistry = new Map<string, ApiTaskResponse>();
const sseClients = new Set<ServerWebSocket<unknown>>();

function allowOrigin(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  if (LOCAL_ONLY) {
    // Only allow loopback origins
    if (origin.startsWith("http://127.") || origin.startsWith("http://localhost")) return origin;
    return "http://localhost";
  }
  return origin || "*";
}

function jsonResponse<T>(data: T, status = 200, req: Request): Response {
  const ao = allowOrigin(req);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ao,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function sseStream(req: Request): Response {
  const ao = allowOrigin(req);
  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: ApiEvent) => {
        const text = `event: ${ev.type}\nid: ${crypto.randomUUID()}\ndata: ${JSON.stringify(ev)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };
      // Keep-alive
      const interval = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(":keep-alive\n\n"));
      }, 15000);

      // Attach to global emitter (we'll wire this in)
      const handler = (ev: ApiEvent) => send(ev);
      apiEventEmitter.on("event", handler);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        apiEventEmitter.off("event", handler);
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": ao,
    },
  });
}

// Simple event emitter for server-side events
class ApiEventEmitter {
  private handlers = new Set<(ev: ApiEvent) => void>();
  on(fn: (ev: ApiEvent) => void) { this.handlers.add(fn); }
  off(fn: (ev: ApiEvent) => void) { this.handlers.delete(fn); }
  emit(ev: ApiEvent) { for (const h of this.handlers) try { h(ev); } catch {} }
}
export const apiEventEmitter = new ApiEventEmitter();

export function broadcastEvent(ev: ApiEvent) {
  apiEventEmitter.emit(ev);
}

export function startApiServer(deps: {
  watcher: VaultWatcher;
  pulse?: PulseLoop;
  embeddingStore?: EmbeddingStore;
  memory?: TaskMemory;
}): Server {
  const { watcher, pulse, embeddingStore, memory } = deps;

  const server = Bun.serve({
    hostname: API_SOCKET ? undefined : API_HOST,
    port: API_SOCKET ? undefined : API_PORT,
    unix: API_SOCKET || undefined,
    fetch(req: Request, server: Server) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": allowOrigin(req),
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── SSE Stream ──
      if (pathname === "/api/v1/stream" && req.method === "GET") {
        return sseStream(req);
      }

      // ── Health ──
      if (pathname === "/api/v1/health" && req.method === "GET") {
        const health: ApiHealthResponse = buildHealthResponse(pulse, embeddingStore);
        return jsonResponse(health, 200, req);
      }

      // ── Submit Task ──
      if (pathname === "/api/v1/task" && req.method === "POST") {
        return handleTaskSubmit(req, watcher, pulse, embeddingStore, memory);
      }

      // ── Get Task ──
      if (pathname.startsWith("/api/v1/task/") && req.method === "GET") {
        const id = pathname.slice("/api/v1/task/".length);
        return handleTaskGet(id, req);
      }

      // ── Search (Synchronous RAG) ──
      if (pathname === "/api/v1/search" && req.method === "POST") {
        return handleSearch(req, watcher, pulse, embeddingStore, memory);
      }

      return jsonResponse({ error: "Not found" }, 404, req);
    },
  });

  console.log(`[API] Server running at ${API_SOCKET || `${API_HOST}:${API_PORT}`}`);
  if (LOCAL_ONLY) console.log("[API] LOCAL_ONLY mode active — only loopback connections allowed.");
  return server;
}

// ── Handlers ───────────────────────────────────────────────────────

async function handleTaskSubmit(
  req: Request,
  watcher: VaultWatcher,
  pulse?: PulseLoop,
  embeddingStore?: EmbeddingStore,
  memory?: TaskMemory,
): Promise<Response> {
  let body: ApiTaskRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const id = body.id ?? crypto.randomUUID();
  const { vaultPath } = resolveVaultFromEnv();
  const inboxDir = join(vaultPath, "GZMO", "Inbox");
  if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

  const filename = `${Date.now()}_${id.slice(0, 8)}.md`;
  const filePath = join(inboxDir, filename);

  const frontmatter = [
    "---",
    `status: pending`,
    `action: ${body.action}`,
    `api_id: ${id}`,
    body.chain_next ? `chain_next: ${body.chain_next}` : "",
    "---",
  ].filter(Boolean).join("\n");

  const fullMd = `${frontmatter}\n${body.body}\n`;
  await atomicWriteFile(filePath, fullMd);

  // Register in-memory
  taskRegistry.set(id, {
    id,
    status: "pending",
    action: body.action,
    body: body.body,
    started_at: new Date().toISOString(),
  });

  broadcastEvent({
    type: "task_created",
    task_id: id,
    data: { path: filePath },
    timestamp: new Date().toISOString(),
  });

  return jsonResponse({ id, path: filePath, status: "pending" }, 202, req);
}

async function handleTaskGet(id: string, req: Request): Promise<Response> {
  // 1. Check registry
  const reg = taskRegistry.get(id);
  if (reg) return jsonResponse(reg, 200, req);

  // 2. Fallback: scan inbox for api_id
  const { vaultPath } = resolveVaultFromEnv();
  const inboxDir = join(vaultPath, "GZMO", "Inbox");
  try {
    const files = await fsp.readdir(inboxDir);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const p = join(inboxDir, f);
      const text = await fsp.readFile(p, "utf8");
      if (text.includes(`api_id: ${id}`)) {
        const doc = await TaskDocument.load(p);
        if (!doc) continue;
        const resp: ApiTaskResponse = {
          id,
          status: doc.status as any,
          action: doc.frontmatter.action as string,
          body: doc.body,
          output: doc.body.includes("## GZMO Response") ? extractResponse(doc.body) : undefined,
        };
        return jsonResponse(resp, 200, req);
      }
    }
  } catch {
    // ignore
  }
  return jsonResponse({ error: "Task not found" }, 404, req);
}

async function handleSearch(
  req: Request,
  _watcher: VaultWatcher,
  pulse?: PulseLoop,
  embeddingStore?: EmbeddingStore,
  memory?: TaskMemory,
): Promise<Response> {
  let body: ApiSearchRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const id = crypto.randomUUID();
  const { vaultPath } = resolveVaultFromEnv();
  const inboxDir = join(vaultPath, "GZMO", "Inbox");
  if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

  const filename = `api_search_${Date.now()}.md`;
  const filePath = join(inboxDir, filename);

  const fm = `---\nstatus: pending\naction: search\napi_id: ${id}\n---\n`;
  await atomicWriteFile(filePath, `${fm}${body.query}\n`);

  // Create synthetic TaskEvent
  const doc = await TaskDocument.load(filePath);
  if (!doc) return jsonResponse({ error: "Failed to create task doc" }, 500, req);

  const event: TaskEvent = {
    filePath,
    fileName: basename(filePath, ".md"),
    status: "pending",
    body: body.query,
    frontmatter: doc.frontmatter as Record<string, unknown>,
    document: doc,
  };

  // Process synchronously (blocking)
  try {
    await processTask(event, { ... } as any, pulse, embeddingStore, memory);
    // Read result from file
    const resultText = await fsp.readFile(filePath, "utf8");
    const answer = extractResponse(resultText) || resultText;
    const evidence = extractEvidence(resultText);

    const resp: ApiSearchResponse = {
      query: body.query,
      answer,
      evidence,
      citations: [], // parse from [E#] if needed
      trace_id: id,
    };

    return jsonResponse(resp, 200, req);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500, req);
  }
}

// ── Helpers ────────────────────────────────────────────────────────

import { promises as fsp } from "fs";

function resolveVaultFromEnv(): { vaultPath: string } {
  const vp = process.env.VAULT_PATH;
  if (!vp) throw new Error("VAULT_PATH not set");
  return { vaultPath: vp };
}

function extractResponse(body: string): string {
  const idx = body.indexOf("## GZMO Response");
  if (idx >= 0) return body.slice(idx + "## GZMO Response".length).trim();
  return body;
}

function extractEvidence(body: string): string | undefined {
  const idx = body.indexOf("## Evidence Packet");
  const end = body.indexOf("## GZMO Response");
  if (idx >= 0) {
    const raw = end > idx ? body.slice(idx, end) : body.slice(idx);
    return raw.trim();
  }
  return undefined;
}

function buildHealthResponse(
  pulse?: PulseLoop,
  embeddingStore?: EmbeddingStore,
): ApiHealthResponse {
  // Basic health; extend with Ollama ping if desired
  return {
    status: "healthy",
    version: "0.4.0-api",
    ollama_connected: true, // TODO: real check
    model_loaded: process.env.OLLAMA_MODEL ?? "unknown",
    embedding_model: "nomic-embed-text",
    pending_tasks: 0,       // TODO: scan inbox
    processing_tasks: 0,
    uptime_seconds: process.uptime(),
  };
}
```

### 3.3 File: `gzmo-daemon/src/atomic_write.ts`

If `atomicWriteFile` does not already exist in your tree:

```typescript
/**
 * atomic_write.ts — Cross-platform atomic file write.
 */
import { promises as fsp } from "fs";
import path from "path";
import crypto from "crypto";

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`);
  await fsp.writeFile(tmp, content, "utf8");
  await fsp.rename(tmp, filePath);
}
```

### 3.4 Patch `gzmo-daemon/index.ts`

In the boot section, after the watcher starts, add:

```typescript
import { startApiServer } from "./src/api_server";
import { readBoolEnv } from "./src/pipelines/helpers";

// ... inside boot sequence, after watcher.start() ...

let apiServer: any;
if (readBoolEnv("GZMO_API_ENABLED", false)) {
  apiServer = startApiServer({ watcher, pulse, embeddingStore, memory });
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[SHUTDOWN] SIGTERM received");
  daemonAbort.abort();
  if (apiServer) {
    console.log("[API] Stopping server...");
    apiServer.stop(true);
  }
  await watcher.stop();
  if (pulse) pulse.stop();
  // ... other cleanup
  process.exit(0);
});
```

### 3.5 Patch `gzmo-daemon/src/engine.ts`

At the end of `processTask()`, broadcast completion:

```typescript
import { broadcastEvent } from "./api_server";

// Inside processTask(), in the finally block or after completion:
if (frontmatter?.api_id) {
  broadcastEvent({
    type: finalStatus === "completed" ? "task_completed" : "task_failed",
    task_id: String(frontmatter.api_id),
    data: { filePath, duration_ms: Date.now() - startTime },
    timestamp: new Date().toISOString(),
  });
}
```

Also update frontmatter handling to preserve `api_id` during status transitions.

### 3.6 Test Phase 1

```bash
cd gzmo-daemon
bun run summon

# In another terminal:
curl -s http://127.0.0.1:12700/api/v1/health | jq .

# Submit task
curl -X POST http://127.0.0.1:12700/api/v1/task \
  -H "Content-Type: application/json" \
  -d '{"action":"think","body":"Say hello"}' | jq .

# Stream events
curl -N http://127.0.0.1:12700/api/v1/stream
```

---

## 4. Phase 2 — Pi Extension 2.0

**Goal:** Replace file-only communication with API-first, keep file-system as fallback.

### 4.1 File: `.pi/extensions/gzmo-tinyfolder.ts` (Refactored)

The existing extension gets two new layers:
1. **ApiClient** class wrapping all HTTP calls
2. **LifecycleManager** for start/stop/status

#### ApiClient

Add inside the extension file (or as a separate module):

```typescript
/* ── API Client ─────────────────────────────────────────────────── */

class GzmoApiClient {
  private baseUrl: string;
  private abortCtrl = new AbortController();

  constructor() {
    // Try Unix socket first, then TCP
    const socket = process.env.GZMO_API_SOCKET ?? "/tmp/gzmo.sock";
    const port = process.env.GZMO_API_PORT ?? "12700";
    const host = process.env.GZMO_API_HOST ?? "127.0.0.1";

    // Bun fetch supports unix: protocol
    if (existsSync(socket)) {
      this.baseUrl = `http://unix:${socket}`;
    } else {
      this.baseUrl = `http://${host}:${port}`;
    }
  }

  private async fetch(path: string, init?: RequestInit) {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, { ...init, signal: this.abortCtrl.signal });
  }

  async health(): Promise<{ ok: boolean; data?: any }> {
    try {
      const r = await this.fetch("/api/v1/health", { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return { ok: false };
      return { ok: true, data: await r.json() };
    } catch {
      return { ok: false };
    }
  }

  async submitTask(action: string, body: string): Promise<{ ok: boolean; id?: string; path?: string; error?: string }> {
    try {
      const r = await this.fetch("/api/v1/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, body }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: data.error ?? `HTTP ${r.status}` };
      return { ok: true, id: data.id, path: data.path };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  async getTask(id: string): Promise<{ ok: boolean; data?: any }> {
    try {
      const r = await this.fetch(`/api/v1/task/${id}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false };
      return { ok: true, data: await r.json() };
    } catch {
      return { ok: false };
    }
  }

  async search(query: string, maxSec = 120): Promise<{ ok: boolean; answer?: string; error?: string }> {
    try {
      const r = await this.fetch("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(maxSec * 1000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: data.error ?? `HTTP ${r.status}` };
      return { ok: true, answer: data.answer };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  connectSSE(onEvent: (ev: any) => void): () => void {
    const es = new EventSource(`${this.baseUrl}/api/v1/stream`);
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        onEvent(parsed);
      } catch {}
    };
    es.onerror = () => {};
    return () => es.close();
  }

  abort() {
    this.abortCtrl.abort();
    this.abortCtrl = new AbortController();
  }
}
```

#### Lifecycle Manager

```typescript
/* ── Lifecycle Manager ──────────────────────────────────────────── */

async function ensureDaemonRunning(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
  const client = new GzmoApiClient();
  const h = await client.health();
  if (h.ok) return true;

  // Not running — prompt user to start
  const start = await ctx.ui.confirm(
    "GZMO Daemon Offline",
    "Start GZMO daemon now? (runs `bun run summon` in gzmo-daemon/)"
  );
  if (!start) return false;

  // Resolve repo root
  let repoRoot = process.cwd();
  while (repoRoot !== "/" && !(await fileExists(path.join(repoRoot, "gzmo-daemon", "package.json")))) {
    repoRoot = path.dirname(repoRoot);
  }
  if (repoRoot === "/") {
    ctx.ui.notify("Could not find gzmo-daemon/ from cwd", "error");
    return false;
  }

  // Spawn daemon in background
  const daemonDir = path.join(repoRoot, "gzmo-daemon");
  const proc = Bun.spawn(["bun", "run", "summon"], {
    cwd: daemonDir,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  ctx.ui.notify("Starting GZMO daemon...", "info");

  // Wait for health endpoint (max 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const check = await client.health();
    if (check.ok) {
      ctx.ui.notify("GZMO daemon is live", "success");
      return true;
    }
  }
  ctx.ui.notify("GZMO daemon failed to start within 30s", "warning");
  return false;
}
```

#### New/Updated Tools

**`gzmo_api_search` — Direct synchronous search (replaces slow file-based query)**

```typescript
pi.registerTool({
  name: "gzmo_api_search",
  label: "GZMO API search",
  description: "Direct synchronous vault search via GZMO HTTP API. Returns answer in < 5 seconds.",
  parameters: Type.Object({
    query: Type.String(),
  }),
  async execute(_id, params, signal, _onUpdate, ctx) {
    const client = new GzmoApiClient();
    const result = await client.search(params.query, 120);
    if (!result.ok) {
      // Fallback to file-based search
      return fileBasedQueryContextFallback(params.query, signal, ctx);
    }
    return {
      content: [{ type: "text", text: result.answer ?? "(no answer)" }],
      details: { answer: result.answer, via: "api" },
    };
  },
});
```

**`gzmo_api_think` — Streaming think via SSE**

```typescript
pi.registerTool({
  name: "gzmo_api_think",
  label: "GZMO API think",
  description: "Submit a think task and stream back progress via SSE.",
  parameters: Type.Object({
    body: Type.String(),
  }),
  async execute(_id, params, signal, onUpdate, ctx) {
    const client = new GzmoApiClient();
    const sub = await client.submitTask("think", params.body);
    if (!sub.ok) {
      return { content: [{ type: "text", text: `Submit failed: ${sub.error}` }], details: {} };
    }

    // Stream UI updates
    const unsubscribe = client.connectSSE((ev) => {
      if (ev.task_id === sub.id && ev.type === "task_completed") {
        onUpdate?.({ content: [{ type: "text", text: "Task finished. Fetching result..." }] });
      }
    });

    // Poll until done (max 5 min)
    const status = await waitForTerminalTaskStatusApi(client, sub.id!, 300, 2);
    unsubscribe();

    const task = await client.getTask(sub.id!);
    const text = task.ok ? task.data.output ?? task.data.body : "(unavailable)";
    return {
      content: [{ type: "text", text }],
      details: { task_id: sub.id, status },
    };
  },
});
```

### 4.2 Auto-Discover Extension

Ensure pi loads the extension. The file already lives at `.pi/extensions/gzmo-tinyfolder.ts`, so if you run pi from the repo root, it auto-discovers.

If you want it global:
```bash
mkdir -p ~/.pi/agent/extensions
ln -s /home/mw/tinyFolder/.pi/extensions/gzmo-tinyfolder.ts ~/.pi/agent/extensions/
```

### 4.3 Test Phase 2

```bash
# In repo root
pi

# In pi chat:
/gzmo           # Should show dashboard with live data
/gzmo-start     # Should start daemon if not running

# Submit via API tool (if LLM chooses it)
# Or manually:
> Use gzmo_api_search to find vault info about "chaos engine"
```

---

## 5. Phase 3 — Performance Stack

**Goal:** Apply the `pi-search` research to make inference fast on local hardware.

### 5.1 Multi-Model Routing (already partially in engine)

The `inference.ts` file already exports `inferDetailed`. Extend it:

```typescript
// gzmo-daemon/src/inference_router.ts
import { inferDetailed, OLLAMA_MODEL } from "./inference";

export type ModelRole = "fast" | "reason" | "judge" | "embed";

export function resolveModel(role: ModelRole): string {
  if (!readBoolEnv("GZMO_ENABLE_MODEL_ROUTING", false)) return OLLAMA_MODEL;
  switch (role) {
    case "fast": return process.env.GZMO_FAST_MODEL ?? OLLAMA_MODEL;
    case "reason": return process.env.GZMO_REASON_MODEL ?? OLLAMA_MODEL;
    case "judge": return process.env.GZMO_JUDGE_MODEL ?? OLLAMA_MODEL;
    default: return OLLAMA_MODEL;
  }
}

export async function inferRouted(
  prompt: string,
  role: ModelRole,
  opts?: { temperature?: number; maxTokens?: number }
) {
  const model = resolveModel(role);
  return inferDetailed(prompt, model, opts);
}
```

**Usage in engine:**
- Query rewrite → `inferRouted(body, "fast")` using 0.5B model
- Deep reasoning → `inferRouted(body, "reason")` using 32B model
- Shadow judge → `inferRouted(body, "judge")` using 32B model

### 5.2 Ollama Launch Flags (Put into a script)

Create `scripts/start-ollama-optimized.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# KV-Cache half-precision + Flash Attention
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KEEP_ALIVE=-1

# Optional: speculative draft config (when Ollama natively supports it)
# export OLLAMA_DRAFT_MODEL=qwen2.5:0.5b
# export OLLAMA_DRAFT_NUM_PREDICTIONS=16

# For RTX 50-series: try FP8 if supported by Ollama build
# export OLLAMA_CUDA_FP16=0

echo "[OLLAMA] Starting with KV_CACHE_TYPE=$OLLAMA_KV_CACHE_TYPE, FLASH_ATTENTION=1"
ollama serve "$@"
```

Make it the default via systemd:
```bash
mkdir -p ~/.config/systemd/user
cp gzmo-daemon/ollama.service.template ~/.config/systemd/user/ollama.service
systemctl --user daemon-reload
systemctl --user enable --now ollama
```

### 5.3 Reranker Integration

Add a rerank step in `search.ts` or `pipelines/search_pipeline.ts`:

```typescript
// After initial retrieval, before evidence compilation:
const enableRerank = readBoolEnv("GZMO_RERANK_LLM", true);
if (enableRerank && results.length > 0) {
  const rerank = await rerankWithLLM(query, results, getOllamaUrl());
  results = rerank.slice(0, topK);
}
```

The `rerank_llm.ts` module already exists in the codebase. Ensure it uses the dedicated reranker model if configured, otherwise falls back to the main model.

### 5.4 KV-Cache Quantization Roadmap

Short term (today with Ollama):
- `OLLAMA_KV_CACHE_TYPE=q8_0` halves KV-cache footprint.
- `OLLAMA_FLASH_ATTENTION=1` reduces memory pressure further.

Medium term (migrate to llama.cpp direct or custom framework):
- Implement TurboQuant-inspired KV compression (3-bit Keys + 4-bit Values).
- Use Triton kernels to avoid FP16 dequantization overhead.
- Boundary-V Protection (keep first/last 2 layers in FP16).

### 5.5 Speculative Decoding Setup

For Ollama (when supported) or llama.cpp directly:

```bash
# llama.cpp example (reference for future migration)
./llama-server \
  -m models/qwen3-32b-q4_k_m.gguf \
  --model-draft models/qwen2.5-0.5b-q8_0.gguf \
  --draft 16 \
  -ngl 99 -ngld 99 \
  -ctk q8_0 -ctv q8_0 \
  -c 32768
```

In Ollama, speculative decoding is model-dependent. Monitor Ollama releases for `--draft` support.

---

## 6. Phase 4 — UI/UX Polish

### 6.1 Unified Footer Status

Modify `updateUiStatus()` in the extension to show richer data from `/api/v1/health`:

```typescript
async function updateUiStatus(ctx: ExtensionContext) {
  const client = new GzmoApiClient();
  const h = await client.health();

  if (!h.ok) {
    ctx.ui.setStatus("gzmo", "GZMO: offline");
    return;
  }

  const d = h.data;
  const vram = d.vram_total_mb && d.vram_used_mb
    ? `${Math.round(d.vram_used_mb/1024)}/${Math.round(d.vram_total_mb/1024)}GB`
    : "?";

  ctx.ui.setStatus("gzmo", `GZMO ${d.status} ● ${d.pending_tasks}p/${d.processing_tasks}a ● VRAM ${vram}`);

  // Widget with live stream tail + mini VRAM bar
  const lines = [
    `GZMO ${d.status} | Model: ${d.model_loaded}`,
    `Pending: ${d.pending_tasks} | Active: ${d.processing_tasks}`,
    `VRAM: ${vram}`,
    "──",
    ...(await fetchLiveStreamTail()),
  ];
  ctx.ui.setWidget("gzmo", lines, { placement: "belowEditor" });
}
```

### 6.2 Task Notifications via SSE

In the extension `session_start`, subscribe to SSE once:

```typescript
pi.on("session_start", async (_event, ctx) => {
  const sid = ctx.sessionManager.getSessionId();
  await reconstructTrackedTasks(ctx);
  await attachGzmoWatchers(pi, ctx, sid);

  // NEW: API SSE listener
  const client = new GzmoApiClient();
  const unsub = client.connectSSE((ev) => {
    if (ev.type === "task_completed" || ev.type === "task_failed") {
      pi.sendMessage({
        customType: "gzmo-task-api",
        content: `GZMO task ${ev.type}: ${ev.task_id}`,
        display: true,
        details: { task_id: ev.task_id },
      }, { triggerTurn: false });
      updateUiStatus(ctx);
    }
  });
  // Store unsub for cleanup
});
```

### 6.3 `/gzmo-trace` Command

```typescript
pi.registerCommand("gzmo-trace", {
  description: "Display reasoning trace for a task ID.",
  handler: async (args, ctx) => {
    const { vaultPath } = await resolveVaultPath();
    const traceDir = path.join(vaultPath, "GZMO", "Reasoning_Traces");
    // Find trace JSON by partial ID match
    const files = await fsp.readdir(traceDir).catch(() => [] as string[]);
    const match = files.find((f) => f.includes(String(args).trim()));
    if (!match) { ctx.ui.notify("Trace not found", "error"); return; }
    const text = await fsp.readFile(path.join(traceDir, match), "utf8");
    const trace = JSON.parse(text);
    // Pretty-print as tree
    const lines = renderTraceTree(trace);
    ctx.ui.notify(lines.join("\n"), "info");
  },
});
```

### 6.4 Model Selector Command

```typescript
pi.registerCommand("gzmo-model", {
  description: "Switch Ollama model for GZMO.",
  handler: async (_args, ctx) => {
    const res = await fetch("http://localhost:11434/api/tags");
    const data = (await res.json()) as { models: Array<{ name: string }> };
    const names = data.models.map((m) => m.name);
    const chosen = await ctx.ui.select("Choose model", names);
    if (!chosen) return;
    // Write to .env or set in-memory
    ctx.ui.notify(`Model switched to ${chosen}`, "info");
  },
});
```

---

## 7. Phase 5 — Local-Only Distribution

### 7.1 Airgapped Mode Enforcement

In `api_server.ts` (already shown above):
- `GZMO_LOCAL_ONLY=1` restricts CORS to loopback origins.
- Bind to `127.0.0.1` only.
- Unix socket preferred over TCP.

In the pi extension:
```typescript
// In before_agent_start or session_start
if (process.env.GZMO_LOCAL_ONLY === "1") {
  // Warn if pi provider is not localhost
  const providerUrl = process.env.OPENAI_BASE_URL ?? "";
  if (providerUrl && !providerUrl.includes("localhost") && !providerUrl.includes("127.")) {
    pi.sendMessage({
      customType: "local-only-warning",
      content: "⚠️ GZMO_LOCAL_ONLY=1 is set, but pi LLM provider points to external URL. Switch pi provider to Ollama (localhost:11434) for full local mode.",
      display: true,
    }, { triggerTurn: false });
  }
}
```

### 7.2 One-Click Installer

Create `scripts/install-local-stack.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:-$HOME/vault}"
PROFILE="${2:-core}"

echo "═══════════════════════════════════════════════════"
echo "  tinyFolder + pi — Local Stack Installer"
echo "═══════════════════════════════════════════════════"

# 1. Check Bun
if ! command -v bun &> /dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# 2. Check Ollama
if ! command -v ollama &> /dev/null; then
  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

# 3. Pull models based on profile
case "$PROFILE" in
  minimal)
    ollama pull phi3:mini
    MODEL="phi3:mini"
    ;;
  core)
    ollama pull hermes3:8b
    ollama pull nomic-embed-text
    MODEL="hermes3:8b"
    ;;
  standard|full)
    ollama pull qwen3:32b
    ollama pull nomic-embed-text
    ollama pull qwen2.5:0.5b
    MODEL="qwen3:32b"
    ;;
  *)
    echo "Unknown profile: $PROFILE"
    exit 1
    ;;
esac

# 4. Create vault scaffold
mkdir -p "$VAULT/GZMO"/{Inbox,Subtasks,Thought_Cabinet,Quarantine,Reasoning_Traces}
mkdir -p "$VAULT/wiki"

# 5. Write .env
cat > "$REPO_ROOT/gzmo-daemon/.env" <<EOF
VAULT_PATH="$VAULT"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="$MODEL"
GZMO_API_ENABLED="1"
GZMO_PROFILE="$PROFILE"
GZMO_LOCAL_ONLY="1"
GZMO_MULTIQUERY="on"
GZMO_RERANK_LLM="on"
EOF

# 6. Install deps
cd "$REPO_ROOT/gzmo-daemon"
bun install

# 7. Symlink pi extension globally
mkdir -p "$HOME/.pi/agent/extensions"
ln -sf "$REPO_ROOT/.pi/extensions/gzmo-tinyfolder.ts" "$HOME/.pi/agent/extensions/"

# 8. Systemd user service for daemon
if command -v systemctl &> /dev/null; then
  cp "$REPO_ROOT/gzmo-daemon/gzmo-daemon.service.template" "$HOME/.config/systemd/user/gzmo-daemon.service" 2>/dev/null || true
  systemctl --user daemon-reload 2>/dev/null || true
fi

# 9. Health check
bun run doctor || true

echo ""
echo "✅ Installation complete!"
echo "   Vault:    $VAULT"
echo "   Profile:  $PROFILE"
echo "   Model:    $MODEL"
echo ""
echo "Start now:"
echo "   cd $REPO_ROOT/gzmo-daemon && bun run summon"
echo "   pi"
```

### 7.3 pi `settings.json` for Local-Only

Guide the user to create `~/.pi/settings.json`:

```json
{
  "provider": "ollama",
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen3:32b",
  "extensions": [
    "/home/mw/tinyFolder/.pi/extensions/gzmo-tinyfolder.ts"
  ]
}
```

---

## 8. Troubleshooting Matrix

| Symptom | Root Cause | Fix |
|---|---|---|
| `Connection refused` on :12700 | Daemon not running | Run `./scripts/install-local-stack.sh` or `bun run summon` |
| `GZMO: env missing` in pi | VAULT_PATH not absolute | Ensure `.env` has `VAULT_PATH="/absolute/path"` |
| Slow search response | File-based fallback active | Check `GZMO_API_ENABLED=1` in daemon `.env` |
| OOM at 32K context | KV cache too large | Set `OLLAMA_KV_CACHE_TYPE=q8_0` |
| pi extension not loading | Not in discovery path | Symlink to `~/.pi/agent/extensions/` |
| SSE stream drops after 60s | Idle timeout | Normal; client auto-reconnects. Or adjust Bun.serve idleTimeout. |
| Model hallucinates after 4-bit quant | Quantization loss too high | Switch from GGUF Q4_K_S to AWQ-4 or EXL2 @ 4.65 bpw |
| Draft model mismatches target | Different tokenizer | Use same model family (e.g., Qwen2.5 draft for Qwen3 target) |

---

## 9. Environment Reference

### Daemon Variables (`gzmo-daemon/.env`)

| Variable | Values | Default | Phase |
|----------|--------|---------|-------|
| `VAULT_PATH` | Absolute path | — | All |
| `OLLAMA_MODEL` | Model tag | `hermes3:8b` | All |
| `GZMO_API_ENABLED` | `1`/`0` | `0` | 1 |
| `GZMO_API_HOST` | IP | `127.0.0.1` | 1 |
| `GZMO_API_PORT` | Port | `12700` | 1 |
| `GZMO_API_SOCKET` | Path | — | 1 |
| `GZMO_LOCAL_ONLY` | `1`/`0` | `0` | 5 |
| `GZMO_FAST_MODEL` | Model tag | — | 3 |
| `GZMO_REASON_MODEL` | Model tag | — | 3 |
| `GZMO_JUDGE_MODEL` | Model tag | — | 3 |
| `GZMO_ENABLE_MODEL_ROUTING` | `on`/`off` | `off` | 3 |
| `GZMO_ENABLE_TOT` | `on`/`off` | `off` | 3 |
| `GZMO_ENABLE_TOOLS` | `on`/`off` | `off` | 3 |
| `GZMO_VERIFY_SAFETY` | `1`/`0` | `1` | All |
| `GZMO_ENABLE_SELF_EVAL` | `1`/`0` | `1` | All |

### pi Extension Environment

| Variable | Purpose |
|----------|---------|
| `GZMO_ENV_FILE` | Path to `gzmo-daemon/.env` (optional) |
| `VAULT_PATH` | Fallback if no `.env` found |

---

## 10. Migration Path (from File-Only to API Hybrid)

If you have an existing tinyFolder deployment and want to migrate without downtime:

1. **Additive:** Deploy the API layer (Phase 1) alongside the file watcher. Existing file-based workflows continue to work.
2. **Parallel:** Update pi extension to prefer API tools but keep file tools as fallback.
3. **Switch:** Once API is verified stable, mark file tools as `deprecated` in prompt guidelines.
4. **Cleanup:** After 2 weeks of stable API usage, remove legacy file-polling loops from the extension.

The daemon's dual-entry design (file + API → same `processTask()`) makes this zero-risk.

---

## Appendix A: File Manifest (New & Modified)

### New Files
- `gzmo-daemon/src/api_types.ts`
- `gzmo-daemon/src/api_server.ts`
- `gzmo-daemon/src/inference_router.ts`
- `scripts/start-ollama-optimized.sh`
- `scripts/install-local-stack.sh`

### Modified Files
- `gzmo-daemon/index.ts` (add API server start/stop)
- `gzmo-daemon/src/engine.ts` (broadcast API events)
- `.pi/extensions/gzmo-tinyfolder.ts` (add ApiClient, API tools, lifecycle)
- `gzmo-daemon/.env` (add API and routing variables)

---

## Appendix B: Quick Start (Summary)

For someone who just cloned the repo:

```bash
# 1. Install everything (Bun, Ollama, models, vault, systemd)
./scripts/install-local-stack.sh ~/vault full

# 2. Start Ollama (in one terminal)
OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 ollama serve

# 3. Start daemon (in another terminal)
cd gzmo-daemon && bun run summon

# 4. Start pi (configures itself from .env)
cd ~/tinyFolder && pi

# 5. Done. Chat with your local agent.
> Search my vault for chaos engine details.
```

---

*This guide is a living document. Iterate as pi-search research advances (TurboQuant KV compression, EAGLE-3 feature drafting, etc.).*
