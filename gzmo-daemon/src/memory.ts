/**
 * memory.ts — Episodic Task Memory
 *
 * Rolling log of the last N completed tasks.
 * Injected into system prompt for cross-task continuity.
 * The daemon remembers what it did.
 */

import { existsSync } from "fs";
import { atomicWriteJson } from "./vault_fs";
import { readIntEnv } from "./pipelines/helpers";

export interface MemoryEntry {
  task: string;
  summary: string;
  time: string;
  /** Optional vault-relative paths detected in completion output */
  artifacts?: string[];
}

function maxEntriesCap(): number {
  return readIntEnv("GZMO_MEMORY_MAX_ENTRIES", 5, 1, 50);
}

function summaryCharCap(): number {
  return readIntEnv("GZMO_MEMORY_SUMMARY_CHARS", 120, 40, 500);
}

/** Extract plausible vault-relative markdown paths mentioned in completions. */
export function extractMemoryArtifactHints(text: string, max = 12): string[] {
  const out: string[] = [];
  const s = String(text ?? "");
  const re = /\b(?:GZMO\/|wiki\/)[A-Za-z0-9_\-./]+\.md\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const p = m[0]!;
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  const tick = /\B`([^`\n]+\.md)`/g;
  while ((m = tick.exec(s)) !== null) {
    const inner = String(m[1] ?? "").replace(/\\/g, "/").trim();
    if (!/^((GZMO\/|wiki\/)[^`]*)$/.test(inner)) continue;
    if (!out.includes(inner)) out.push(inner);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export class TaskMemory {
  private entries: MemoryEntry[] = [];
  private filePath: string;
  private vaultPath: string;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.vaultPath = filePath.split(/[/\\]GZMO[/\\]/)[0] ?? "";
    this.loadPromise = this.loadAsync();
  }

  /** Record a completed task. */
  record(taskFile: string, response: string): void {
    const cap = summaryCharCap();
    const summary = (
      response
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 10 && !l.startsWith("# ") && !l.startsWith("---") && !l.startsWith("```"))[0] ??
      response.slice(0, Math.min(cap, 100))
    ).slice(0, cap);

    const artifacts = extractMemoryArtifactHints(response);

    const entry: MemoryEntry = {
      task: taskFile,
      summary,
      time: new Date().toISOString(),
      ...(artifacts.length > 0 ? { artifacts } : {}),
    };

    this.entries.push(entry);

    const n = maxEntriesCap();
    if (this.entries.length > n) {
      this.entries = this.entries.slice(-n);
    }

    this.save();
  }

  /** Format memory for system prompt injection. */
  toPromptContext(): string {
    if (this.entries.length === 0) return "";

    const lines = this.entries.map((e) => {
      const art =
        Array.isArray(e.artifacts) && e.artifacts.length > 0
          ? ` (paths: ${e.artifacts.slice(0, 4).join(", ")}${e.artifacts.length > 4 ? "…" : ""})`
          : "";
      return `- ${e.task}: ${e.summary}${art}`;
    });

    return `\nRecent tasks:\n${lines.join("\n")}`;
  }

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
        const n = maxEntriesCap();
        const sanitized: MemoryEntry[] = [];
        for (const raw of parsed) {
          if (!raw || typeof raw !== "object") continue;
          const r = raw as Record<string, unknown>;
          const task = typeof r.task === "string" ? r.task : "";
          const summary = typeof r.summary === "string" ? r.summary : "";
          const time = typeof r.time === "string" ? r.time : "";
          if (!task || !summary) continue;
          const artifacts = Array.isArray(r.artifacts)
            ? (r.artifacts as unknown[])
                .filter((x): x is string => typeof x === "string")
                .slice(0, 12)
            : undefined;
          sanitized.push({
            task,
            summary: summary.slice(0, summaryCharCap()),
            time: time || new Date().toISOString(),
            ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
          });
        }
        const merged = [...sanitized, ...this.entries];
        this.entries = merged.slice(-n);
      }
    } catch {
      // keep entries
    }
  }

  private save(): void {
    try {
      if (!this.vaultPath) return;
      void this.loadPromise;
      atomicWriteJson(this.vaultPath, this.filePath, this.entries, 2).catch(() => {});
    } catch {}
  }
}
