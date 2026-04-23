/**
 * frontmatter.ts — Lossless YAML frontmatter state machine.
 *
 * Uses gray-matter for symmetrical read/write so the daemon
 * can update `status: pending` → `processing` → `completed`
 * without corrupting the user's markdown body.
 *
 * All I/O uses native Bun.file() / Bun.write() for zero-copy
 * read/write via io_uring — no event loop blocking.
 */

import matter from "gray-matter";

export type TaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface TaskFrontmatter {
  status: TaskStatus;
  started_at?: string;
  completed_at?: string;
  attachments?: string[];
  [key: string]: unknown;
}

export interface ParsedTask {
  frontmatter: TaskFrontmatter;
  body: string;
  rawContent: string;
}

/**
 * Parse a markdown file and extract its frontmatter + body.
 * Returns null if the file has no valid frontmatter.
 */
export async function parseTask(filePath: string): Promise<ParsedTask | null> {
  try {
    const raw = await Bun.file(filePath).text();
    const parsed = matter(raw);

    if (!parsed.data || typeof parsed.data.status !== "string") {
      return null; // Not a valid task file
    }

    return {
      frontmatter: parsed.data as TaskFrontmatter,
      body: parsed.content.trim(),
      rawContent: raw,
    };
  } catch {
    return null;
  }
}

/**
 * Update the frontmatter of a task file without touching the body.
 * Uses gray-matter's stringify for lossless round-trip.
 */
export async function updateFrontmatter(
  filePath: string,
  updates: Partial<TaskFrontmatter>
): Promise<void> {
  const raw = await Bun.file(filePath).text();
  const parsed = matter(raw);

  // Merge updates into existing frontmatter
  const merged = { ...parsed.data, ...updates };

  // Reconstruct file: gray-matter.stringify preserves body exactly
  const output = matter.stringify(parsed.content, merged);
  await Bun.write(filePath, output);
}

/**
 * Append markdown content to the end of a task file,
 * preserving the frontmatter and existing body intact.
 */
export async function appendToTask(filePath: string, content: string): Promise<void> {
  const raw = await Bun.file(filePath).text();
  const parsed = matter(raw);

  const newBody = parsed.content.trimEnd() + "\n" + content;
  const output = matter.stringify(newBody, parsed.data);
  await Bun.write(filePath, output);
}
