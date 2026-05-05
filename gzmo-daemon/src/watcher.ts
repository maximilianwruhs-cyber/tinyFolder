/**
 * watcher.ts — Chokidar-based file watcher for the GZMO Inbox.
 *
 * Watches `Obsidian_Vault/GZMO/Inbox/` for new or changed .md files.
 * Debounces rapid save events and emits clean task events.
 */

import { watch, type FSWatcher } from "chokidar";
import { TaskDocument, type TaskStatus } from "./frontmatter";
import { EventEmitter } from "events";
import { basename } from "path";

export interface TaskEvent {
  filePath: string;
  fileName: string;
  status: TaskStatus;
  body: string;
  frontmatter: Record<string, unknown>;
  document: TaskDocument; // The new deep abstraction
}

export class VaultWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, Timer> = new Map();
  private processing: Set<string> = new Set();
  private readonly debounceMs: number;

  constructor(
    private readonly inboxPath: string,
    debounceMs = 500
  ) {
    super();
    this.debounceMs = debounceMs;
  }

  start(): void {
    console.log(`[WATCHER] Watching: ${this.inboxPath}`);

    this.watcher = watch(this.inboxPath, {
      ignored: [
        /(^|[\/\\])\.../,  // dotfiles
        /Subtasks/,       // subagent directory handled separately
      ],
      persistent: true,
      ignoreInitial: false, // Scan existing files on startup
      depth: 0,             // Only watch top-level Inbox, not subdirs
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", (path: string) => this.handleFileEvent(path));
    this.watcher.on("change", (path: string) => this.handleFileEvent(path));

    this.watcher.on("error", (err: unknown) => {
      console.error(`[WATCHER] Error: ${err instanceof Error ? err.message : err}`);
    });
  }

  private handleFileEvent(filePath: string): void {
    if (!filePath.endsWith(".md")) return;

    // Don't re-process files we are currently writing to
    if (this.processing.has(filePath)) return;

    // Debounce: wait for the file to stabilize
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processFile(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  private async processFile(filePath: string): Promise<void> {
    const task = await TaskDocument.load(filePath);
    if (!task) return;

    // Only dispatch tasks that are waiting to be processed
    if (task.status !== "pending") return;

    const event: TaskEvent = {
      filePath,
      fileName: basename(filePath, ".md"),
      status: task.status,
      body: task.body,
      frontmatter: task.frontmatter as Record<string, unknown>,
      document: task,
    };

    console.log(`[WATCHER] New task detected: ${event.fileName}`);
    this.emit("task", event);
  }

  /** Mark a file as being written to by the daemon (prevents re-trigger) */
  lockFile(filePath: string): void {
    this.processing.add(filePath);
  }

  /** Release the write lock so future changes are detected again */
  unlockFile(filePath: string): void {
    this.processing.delete(filePath);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    console.log("[WATCHER] Stopped.");
  }
}
