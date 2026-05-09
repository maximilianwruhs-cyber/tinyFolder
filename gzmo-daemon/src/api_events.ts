/**
 * api_events.ts — Lightweight event bus for the GZMO HTTP API.
 *
 * Lives in its own module so `engine.ts` can broadcast lifecycle events
 * without depending on (and circularly importing) `api_server.ts`.
 *
 * If the API is disabled, this is effectively a no-op: emit() with no
 * subscribers just iterates an empty set.
 */

import type { ApiEvent } from "./api_types";

type Handler = (ev: ApiEvent) => void;

class ApiEventEmitter {
  private handlers = new Set<Handler>();

  on(fn: Handler): void {
    this.handlers.add(fn);
  }

  off(fn: Handler): void {
    this.handlers.delete(fn);
  }

  emit(ev: ApiEvent): void {
    for (const h of this.handlers) {
      try {
        h(ev);
      } catch {
        // Subscribers must not be able to crash producers.
      }
    }
  }

  size(): number {
    return this.handlers.size;
  }
}

export const apiEventEmitter = new ApiEventEmitter();

export function broadcastEvent(ev: ApiEvent): void {
  apiEventEmitter.emit(ev);
}
