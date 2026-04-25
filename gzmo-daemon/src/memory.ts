/**
 * memory.ts — Episodic Task Memory
 *
 * Rolling log of the last N completed tasks.
 * Injected into system prompt for cross-task continuity.
 * The daemon remembers what it did.
 */

import { existsSync } from "fs";
import { atomicWriteJson } from "./vault_fs";

export interface MemoryEntry {
  task: string;       // task filename
  summary: string;    // first 100 chars of response
  time: string;       // ISO timestamp
}

const MAX_ENTRIES = 5;

export class TaskMemory {
  private entries: MemoryEntry[] = [];
  private filePath: string;
  private vaultPath: string;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    // memory.json is written inside the vault under GZMO/ by index.ts
    this.vaultPath = filePath.split(/[/\\]GZMO[/\\]/)[0] ?? "";
    // Load asynchronously to avoid blocking daemon boot.
    this.loadPromise = this.loadAsync();
  }

  /** Record a completed task. */
  record(taskFile: string, response: string): void {
    // Extract first meaningful line as summary
    const summary = response
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 10 && !l.startsWith("# ") && !l.startsWith("---") && !l.startsWith("```"))
      [0] ?? response.slice(0, 100);

    this.entries.push({
      task: taskFile,
      summary: summary.slice(0, 120),
      time: new Date().toISOString(),
    });

    // Keep only last N
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }

    this.save();
  }

  /** Format memory for system prompt injection (~100 tokens). */
  toPromptContext(): string {
    if (this.entries.length === 0) return "";

    const lines = this.entries.map(
      (e) => `- ${e.task}: ${e.summary}`
    );

    return `\nRecent tasks:\n${lines.join("\n")}`;
  }

  /** Get entry count. */
  get count(): number {
    return this.entries.length;
  }

  private async loadAsync(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = await Bun.file(this.filePath).json().catch(() => null);
      if (Array.isArray(parsed)) {
        // If entries were already recorded before load finished, merge and keep last N.
        const merged = [...parsed, ...this.entries] as MemoryEntry[];
        this.entries = merged.slice(-MAX_ENTRIES);
      }
    } catch {
      // keep empty
    }
  }

  private save(): void {
    try {
      if (!this.vaultPath) return;
      atomicWriteJson(this.vaultPath, this.filePath, this.entries, 2).catch(() => {});
    } catch {}
  }
}
