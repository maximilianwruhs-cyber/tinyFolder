# Async Search via SSE — Implementation Guide
## P3: Non-Blocking `/api/v1/search` with Server-Sent Events

**Status:** Design Document for Future Implementation  
**Priority:** P3 (Medium-Term Architectural Improvement)  
**Estimated Effort:** 30–60 minutes implementation + testing

---

## 1. Problem Statement

The current `/api/v1/search` endpoint is **synchronously blocking**:

```typescript
// api_server.ts — handleSearch()
const doc = await pollUntilTerminal(filePath, maxSec * 1000);
return jsonResponse(resp, 200, req);
```

This means:
- One HTTP worker thread is occupied for the entire search duration (30–120s)
- Parallel requests (`/health`, new `/task` submits) may queue or timeout
- The client connection stays open, vulnerable to proxy/idle timeouts

---

## 2. Desired Behavior

### Current (Synchronous)
```
Client → POST /api/v1/search {query: "..."}
                              ↓
Server → blocks 30–120s      ← waiting for engine
                              ↓
Server → 200 OK {answer, evidence, citations}
```

### Target (Asynchronous via SSE)
```
Client → POST /api/v1/task   {action: "search", body: "...", stream: true}
                              ↓
Server → 202 Accepted {id: "abc-123", status: "pending"}
                              ↓
Client → GET  /api/v1/stream (SSE connection)
                              ↓
Server → event: task_created   {task_id: "abc-123"}
Server → event: task_started   {task_id: "abc-123"}
Server → event: task_completed {task_id: "abc-123", answer: "..."}
                              ↓
Client → closes SSE, shows answer
```

**Key principle:** The existing file-watcher + engine pipeline does the work. The API just **observes and forwards** events.

---

## 3. Step-by-Step Implementation

### Step 1: Remove Synchronous `handleSearch()`

**File:** `gzmo-daemon/src/api_server.ts`

Delete the entire `handleSearch()` function (lines ~340–400) and the `pollUntilTerminal()` helper.

```typescript
// REMOVE: pollUntilTerminal() — no longer needed
// REMOVE: handleSearch() — replaced by generic task flow
```

### Step 2: Extend `ApiTaskRequest` to Support Search

**File:** `gzmo-daemon/src/api_types.ts`

Make `action` optional in the request body and derive it from context:

```typescript
export interface ApiTaskRequest {
  id?: string;
  action?: ApiTaskAction;  // optional when using /search shortcut
  body: string;
  chain_next?: string;
  stream?: boolean;
}
```

*(Note: `action` is already optional in the current type — no change needed.)*

### Step 3: Add `/api/v1/search` → Delegates to `/task`

**File:** `gzmo-daemon/src/api_server.ts`

Replace `handleSearch()` with a thin wrapper that:
1. Creates a task with `action: search`
2. Returns `202 Accepted` immediately
3. Let the client consume `GET /api/v1/stream` for results

```typescript
async function handleSearch(req: Request): Promise<Response> {
  let body: ApiSearchRequest;
  try {
    body = (await req.json()) as ApiSearchRequest;
  } catch {
    return badJson(req);
  }
  const query = (body?.query ?? "").trim();
  if (!query) return jsonResponse({ error: "query is required" }, 400, req);

  // Delegate to standard task submit
  const id = crypto.randomUUID();
  const vaultPath = resolveVaultPath();
  const inboxDir = ensureInboxDir(vaultPath);
  const filename = `api_search_${Date.now()}_${id.slice(0, 8)}.md`;
  const filePath = join(inboxDir, filename);

  const fmLines = ["---", "status: pending", "action: search", `api_id: ${id}`, "---"];
  await atomicWriteFile(filePath, `${fmLines.join("\n")}\n\n${query}\n`);

  taskRegistry.set(id, {
    id,
    status: "pending",
    action: "search",
    body: query,
    started_at: new Date().toISOString(),
    path: filePath,
  });

  apiEventEmitter.emit({
    type: "task_created",
    task_id: id,
    data: { path: filePath, action: "search" },
    timestamp: new Date().toISOString(),
  });

  // Return immediately — result comes via SSE
  return jsonResponse(
    { id, status: "pending", path: filePath, action: "search", stream_url: "/api/v1/stream" },
    202,
    req,
  );
}
```

### Step 4: Update `routeRequest()` Map

**File:** `gzmo-daemon/src/api_server.ts`

Ensure `/api/v1/search` routes to the new non-blocking handler:

```typescript
if (pathname === "/api/v1/search" && req.method === "POST") {
  return await handleSearch(req);  // now returns 202, not 200
}
```

### Step 5: Document the SSE Contract for Clients

**File:** `gzmo-daemon/src/api_types.ts` (or new `docs/API.md`)

Add a comment block for API consumers:

```typescript
/**
 * Async Search Flow (recommended for production use):
 *
 * 1. POST /api/v1/search       → 202 Accepted {id, stream_url}
 * 2. GET  /api/v1/stream       → SSE connection (persistent)
 * 3. Wait for: event: task_completed {task_id, data: {duration_ms}}
 * 4. GET  /api/v1/task/:id     → 200 OK {status: "completed", output, answer}
 *
 * Fallback if SSE unavailable:
 *   Poll GET /api/v1/task/:id every N seconds until status ∈ {completed, failed}
 */
```

### Step 6: Pi Extension — Consume Async Search

**File:** `.pi/extensions/gzmo-tinyfolder.ts` (future addition)

Replace `gzmo_api_search` with an async variant:

```typescript
pi.registerTool({
  name: "gzmo_api_search",
  parameters: Type.Object({ query: Type.String() }),
  async execute(_id, params, signal, onUpdate, ctx) {
    const client = new GzmoApiClient();

    // 1. Submit search task (non-blocking)
    const sub = await client.submitTask("search", params.query);
    if (!sub.ok) return fallback(params.query, signal, ctx);

    // 2. Subscribe to SSE
    let answer: string | null = null;
    const unsubscribe = client.connectSSE((ev) => {
      if (ev.task_id === sub.id && ev.type === "task_completed") {
        onUpdate?.({ content: [{ type: "text", text: "🔍 Search complete. Fetching result..." }] });
      }
    });

    // 3. Poll until done (backstop)
    const status = await waitForTerminalTaskStatusApi(client, sub.id!, 300, 2);
    unsubscribe();

    // 4. Fetch final answer
    const task = await client.getTask(sub.id!);
    answer = task.ok ? task.data.output ?? task.data.body : null;

    return {
      content: [{ type: "text", text: answer ?? "(no answer)" }],
      details: { task_id: sub.id, status },
    };
  },
});
```

---

## 4. Benefits

| Metric | Before | After |
|---|---|---|
| HTTP thread blocking | 100% during search | 0% (returns 202 immediately) |
| Parallel request handling | Queued/blocked | Fully concurrent |
| Proxy timeout risk | High (120s open connection) | Zero (202 response in < 10ms) |
| Real-time progress | None | SSE events: created → started → completed |
| Scalability | 1 search at a time per process | Unlimited (bounded by engine throughput) |

---

## 5. Migration Path

This is a **non-breaking change** if done correctly:

1. **Phase A:** Implement the new async flow alongside the old sync flow
2. **Phase B:** Mark sync `handleSearch()` as deprecated in API docs
3. **Phase C:** After 2 weeks of stable async usage, remove sync path entirely

The file-system watcher guarantees both paths produce the same result — only the transport changes.

---

## 6. Testing Checklist

```bash
# 1. Submit search
➜ curl -X POST http://127.0.0.1:12700/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "chaos engine"}'
← {"id":"...","status":"pending","stream_url":"/api/v1/stream"}

# 2. Open SSE stream
➜ curl -N http://127.0.0.1:12700/api/v1/stream
← event: task_created
← event: task_started
← event: task_completed

# 3. Fetch result
➜ curl http://127.0.0.1:12700/api/v1/task/{id}
← {"status":"completed","output":"..."}

# 4. Concurrent health check should never block
➜ curl http://127.0.0.1:12700/api/v1/health
← (always responds instantly, even during active searches)
```

---

*This design preserves the existing engine architecture and only changes the HTTP transport layer. The canonical task state remains in the vault markdown files — the SSE stream is purely a real-time notification channel.*
