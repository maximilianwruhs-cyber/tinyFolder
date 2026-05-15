/**
 * frontmatter.ts — Lossless YAML frontmatter state machine.
 *
 * Uses ./yaml_frontmatter (yaml-package wrapper) for symmetrical read/write so the daemon
 * can update `status: pending` → `processing` → `completed`
 * without corrupting the user's markdown body.
 *
 * All I/O uses native Bun.file() / Bun.write() for zero-copy
 * read/write via io_uring — no event loop blocking.
 */

import matter from "./yaml_frontmatter";
import { write } from "bun";
import { copyFile, lstat, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { readBoolEnv } from "./pipelines/helpers";

export type TaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled" | "unbound";

const CLARIFICATION_HEADER = "## ⏸️ GZMO Needs Clarification";

export interface TaskFrontmatter {
  status: TaskStatus;
  started_at?: string;
  completed_at?: string;
  attachments?: string[];
  [key: string]: unknown;
}

// Removed ParsedTask interface

export class TaskDocument {
  private constructor(
    public readonly filePath: string,
    public frontmatter: TaskFrontmatter,
    public body: string,
    public rawContent: string
  ) {}

  static async load(filePath: string): Promise<TaskDocument | null> {
    try {
      // T4-H: refuse to follow symlinks. The watcher already passes
      // `followSymlinks: false` to chokidar, but the HTTP API path bypasses
      // chokidar entirely, so this lstat guard is the second line of defense.
      try {
        const st = await lstat(filePath);
        if (st.isSymbolicLink()) {
          console.warn(`[FRONTMATTER] Refusing to load symlink: ${filePath}`);
          return null;
        }
      } catch {
        // Stat error → let Bun.file() report the underlying problem below.
      }

      const raw = await Bun.file(filePath).text();
      const parsed = matter(raw);

      if (!parsed.data || typeof parsed.data.status !== "string") {
        return null;
      }

      return new TaskDocument(
        filePath,
        parsed.data as TaskFrontmatter,
        parsed.content.trim(),
        raw
      );
    } catch {
      return null;
    }
  }

  get status(): TaskStatus {
    return this.frontmatter.status;
  }

  get action(): string | undefined {
    return this.frontmatter.action as string | undefined;
  }

  async markProcessing(): Promise<void> {
    this.frontmatter.status = "processing";
    this.frontmatter.started_at = new Date().toISOString();
    await this.save();
  }

  async markCompleted(output: string): Promise<void> {
    this.frontmatter.status = "completed";
    this.frontmatter.completed_at = new Date().toISOString();
    // Append the output cleanly
    this.body = this.body.trimEnd() + "\n" + output;
    await this.save();
  }

  async markFailed(errorMessage: string): Promise<void> {
    this.frontmatter.status = "failed";
    this.frontmatter.completed_at = new Date().toISOString();
    const formattedError = `\n---\n\n## ❌ Error\n\`\`\`\n${errorMessage}\n\`\`\``;
    this.body = this.body.trimEnd() + "\n" + formattedError;
    await this.save();
  }

  /**
   * Halt execution — awaiting user clarification. User edits the file and sets
   * `status: pending`; the watcher's `change` handler re-dispatches.
   */
  async markUnbound(clarification: string, opts?: { haltReason?: string; issueType?: string }): Promise<void> {
    this.frontmatter.status = "unbound";
    this.frontmatter.unbound_at = new Date().toISOString();
    if (opts?.haltReason) this.frontmatter.halt_reason = opts.haltReason;
    if (opts?.issueType) this.frontmatter.type = opts.issueType;

    const block = [
      "\n---\n",
      CLARIFICATION_HEADER,
      clarification.trim(),
      "",
      "> To resume: edit this file, address the questions above,",
      "> then change `status: unbound` → `status: pending` and save.",
    ].join("\n");

    const headerIdx = this.body.indexOf(CLARIFICATION_HEADER);
    if (headerIdx >= 0) {
      this.body = this.body.slice(0, headerIdx).trimEnd() + "\n" + block;
    } else {
      this.body = this.body.trimEnd() + "\n" + block;
    }
    await this.save();

    if (readBoolEnv("GZMO_ISSUES_MIRROR", false)) {
      try {
        const vaultRoot = this.filePath.split(/[\\\/]GZMO[\\\/]/)[0];
        if (vaultRoot) {
          const issuesDir = join(vaultRoot, "GZMO", "Issues");
          await mkdir(issuesDir, { recursive: true });
          const base = this.filePath.split(/[\\\/]/).pop() ?? "issue.md";
          await copyFile(this.filePath, join(issuesDir, base));
        }
      } catch {
        // Non-fatal mirror for human triage
      }
    }
  }

  /**
   * Reset a task that was left in `processing` after an unclean shutdown back
   * to `pending`, clearing `started_at` and recording when the recovery ran.
   * Used by boot-time recovery; the watcher's initial scan will then redispatch.
   * Leaves `unbound` tasks alone — they await user input.
   */
  async markPendingRecovered(now: Date = new Date()): Promise<void> {
    if (this.frontmatter.status === "processing") {
      this.frontmatter.status = "pending";
      delete this.frontmatter.started_at;
      this.frontmatter.recovered_at = now.toISOString();
      await this.save();
    }
  }

  private async save(): Promise<void> {
    const output = matter.stringify(this.body, this.frontmatter);
    await write(this.filePath, output);
    this.rawContent = output;
  }
}

// EOF
