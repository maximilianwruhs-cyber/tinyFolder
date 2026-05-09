import { safeAppendJsonl } from "./vault_fs";

export type ErrorTier = "fatal" | "degraded" | "retryable";

export interface ErrorEvent {
  type: "error_event";
  created_at: string;
  tier: ErrorTier;
  subsystem: string;
  message: string;
  code?: string;
  task_file?: string;
  trace_id?: string;
  extra?: Record<string, unknown>;
}

export async function appendErrorEvent(
  vaultRoot: string,
  ev: Omit<ErrorEvent, "type" | "created_at">,
): Promise<void> {
  const full: ErrorEvent = {
    type: "error_event",
    created_at: new Date().toISOString(),
    ...ev,
  };
  await safeAppendJsonl(vaultRoot, "GZMO/error-events.jsonl", full);
}

