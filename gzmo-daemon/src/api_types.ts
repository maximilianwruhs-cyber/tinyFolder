/**
 * api_types.ts — Shared contract between GZMO daemon HTTP API and pi extension.
 *
 * These types define the local-only HTTP surface exposed by the daemon when
 * `GZMO_API_ENABLED=1`. They are intentionally kept dependency-free so the pi
 * extension can copy them verbatim if needed.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Async Search Flow (recommended for production use):
 *
 *   1. POST /api/v1/search       → 202 Accepted { id, status, stream_url, task_url, path }
 *   2. GET  /api/v1/stream       → SSE connection (persistent, multi-task)
 *   3. Wait for: event: task_completed { task_id, data: { duration_ms } }
 *      (or task_failed / task_unbound for the same task_id)
 *   4. GET  /api/v1/task/:id     → 200 OK { status: "completed", output, evidence, body }
 *
 * Fallback when SSE is unavailable:
 *   Poll GET /api/v1/task/:id every N seconds until status ∈ {completed, failed, unbound}.
 *
 * Legacy synchronous form (POST /api/v1/task with action="search") still works,
 * but it does not block: the response is also 202, and clients consume the
 * same SSE / polling backstop.
 * ──────────────────────────────────────────────────────────────────────────
 */

export type ApiTaskAction = "think" | "search" | "chain";

export type ApiTaskStatus = "pending" | "processing" | "completed" | "failed" | "unbound";

export interface ApiTaskRequest {
  /** Optional client-supplied ID. If omitted, the server mints a UUID. */
  id?: string;
  action: ApiTaskAction;
  body: string;
  /** Required when action="chain"; filename for the next step (under GZMO/Subtasks). */
  chain_next?: string;
  /** If true, /api/v1/task returns immediately and clients consume /api/v1/stream. */
  stream?: boolean;
}

export interface ApiTaskResponse {
  id: string;
  status: ApiTaskStatus;
  action: string;
  body: string;
  output?: string;
  /** Pre-extracted "## Evidence Packet" block, when present in body. */
  evidence?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  trace_id?: string;
  /** Absolute path of the markdown file backing this task. */
  path?: string;
}

/**
 * 202 Accepted shape for `POST /api/v1/search` (and any other async-submit
 * endpoint). Clients should wait for the matching `task_completed` /
 * `task_failed` event on `stream_url`, then GET `task_url` for the answer.
 */
export interface ApiSearchAcceptedResponse {
  id: string;
  status: ApiTaskStatus;
  action: "search";
  /** Absolute path of the markdown task file backing this submission. */
  path: string;
  /** SSE endpoint that emits task_created / task_started / task_completed. */
  stream_url: string;
  /** Convenience: GET this URL once a terminal event arrives to fetch the answer. */
  task_url: string;
}

export interface ApiSearchRequest {
  query: string;
  top_k?: number;
  /** Optional max wait in seconds before giving up. Defaults to 120. */
  max_seconds?: number;
}

export interface ApiSearchCitation {
  id: string;
  file: string;
  text: string;
}

export interface ApiSearchResponse {
  query: string;
  answer: string;
  evidence?: string;
  citations: ApiSearchCitation[];
  trace_id: string;
  task_path?: string;
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

export type ApiEventType =
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_unbound"
  | "token"
  | "log";

export interface ApiEvent {
  type: ApiEventType;
  task_id?: string;
  data?: unknown;
  timestamp: string;
}
