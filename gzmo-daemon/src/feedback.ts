/**
 * GZMO Chaos Engine — Feedback Channel (Daemon Edition)
 *
 * Adapted from feedback.rs for the sovereign daemon context.
 * Removes Telegram-specific events, adds filesystem task events.
 *
 * Key lesson from old build: these events NEVER trigger API calls.
 * They modulate internal chaos state only. Output goes to files.
 */

// ── ChaosEvent ─────────────────────────────────────────────────────

export type ChaosEvent =
  | { type: "task_completed"; fileName: string; action?: string; summary?: string; tokenCount: number; durationMs: number }
  | { type: "task_failed"; fileName: string; action?: string; errorType: string }
  | { type: "task_received"; fileName: string; action?: string; bodyLength: number; title?: string }
  | { type: "heartbeat_fired"; energy: number }
  | { type: "dream_proposed"; dreamText: string }
  | { type: "self_ask_completed"; strategy: string; result: string }
  | { type: "wiki_consolidated"; pageTitle: string }
  | { type: "error_occurred"; errorType: string }
  | { type: "custom"; tensionDelta: number; energyDelta: number; thoughtSeed?: ThoughtSeed };

// ── Thought Seed ───────────────────────────────────────────────────

export interface ThoughtSeed {
  category: string;
  text: string;
}

// ── Event → Tension/Energy/Thought mappings ────────────────────────

export function tensionDelta(event: ChaosEvent): number {
  switch (event.type) {
    case "task_completed":
      return event.tokenCount > 300 ? -1.0 : -2.0;  // Completion is relief
    case "task_failed":
      return 5.0; // Failures are stressful
    case "task_received":
      return Math.min(event.bodyLength / 200, 5.0); // Longer tasks = more tension
    case "heartbeat_fired":
      return -0.5; // Routine is calming
    case "dream_proposed":
      return 3.0; // Identity proposals are intense but less than old build
    case "self_ask_completed":
      return 1.5; // Self-asks are mild stimulus
    case "wiki_consolidated":
      return -1.5; // Consolidation is satisfying
    case "error_occurred":
      return 8.0; // Errors are very stressful
    case "custom":
      return event.tensionDelta;
  }
}

export function energyDelta(event: ChaosEvent): number {
  switch (event.type) {
    case "task_completed":
      return -(event.durationMs / 10000); // Longer tasks drain more
    case "task_failed":
      return -3.0; // Failures cost energy
    case "task_received":
      return 5.0; // Inbox energy injection (like the old inbox_drop)
    case "heartbeat_fired":
      return -0.2; // Minimal drain — lesson from old build: heartbeats MUST be cheap
    case "dream_proposed":
      return -3.0;
    case "self_ask_completed":
      return -1.0; // Cheap — just one LLM call
    case "wiki_consolidated":
      return -2.0; // Wiki synthesis costs moderate energy
    case "error_occurred":
      return -5.0;
    case "custom":
      return event.energyDelta;
  }
}

export function thoughtSeed(event: ChaosEvent): ThoughtSeed | null {
  switch (event.type) {
    case "task_completed":
      // Prefer task-substance as seeds; avoid purely numeric telemetry.
      return {
        category: "task_completed",
        text: [
          `Task completed: ${event.fileName}${event.action ? ` (${event.action})` : ""}`,
          event.summary ? `Outcome: ${event.summary}` : null,
        ].filter(Boolean).join(" — "),
      };
    case "task_failed":
      return {
        category: "task_failed",
        text: `Task failed: ${event.fileName}${event.action ? ` (${event.action})` : ""} — ${event.errorType}`,
      };
    case "task_received":
      // Strict gate: do not internalize task_received. Only internalize after completion/distillation.
      return null;
    case "heartbeat_fired":
      // Heartbeat is state telemetry. Do not internalize it as a thought seed; it floods the cabinet with low-signal noise.
      return null;
    case "dream_proposed":
      return { category: "dream", text: event.dreamText };
    case "self_ask_completed":
      return { category: "self_ask", text: `${event.strategy}: ${event.result.slice(0, 80)}` };
    case "wiki_consolidated":
      return { category: "wiki", text: `Consolidated wiki page: ${event.pageTitle}` };
    case "custom":
      return event.thoughtSeed ?? null;
    default:
      return null;
  }
}
