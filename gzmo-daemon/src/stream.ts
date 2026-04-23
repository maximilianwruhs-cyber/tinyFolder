/**
 * stream.ts — The GZMO Live Stream.
 *
 * Writes a rolling internal monologue to `GZMO/Live_Stream.md`
 * so you can leave it open in Obsidian and watch the daemon breathe.
 *
 * Buffers writes to reduce I/O from 5+/sec to ~1/5sec.
 * Uses native Bun.file() / Bun.write() for zero-copy I/O.
 */

import { join } from "path";
import { safeWriteText } from "./vault_fs";

const MAX_LINES = 200;      // Keep the stream manageable
const FLUSH_INTERVAL = 5000; // Flush every 5 seconds
const FLUSH_THRESHOLD = 10;  // Or after 10 queued entries

export class LiveStream {
  private readonly filePath: string;
  private readonly vaultPath: string;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false; // guard against concurrent flushes

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.filePath = join(vaultPath, "GZMO", "Live_Stream.md");
    this.initialize();

    // Periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL);
  }

  private initialize(): void {
    const file = Bun.file(this.filePath);
    // Bun.file().size is 0 for non-existent files — use this as existence check
    if (file.size === 0) {
      safeWriteText(this.vaultPath, this.filePath, `# GZMO Live Stream\n*Auto-scroll to follow daemon state*\n\n`)
        .catch(() => {}); // fire-and-forget initialization
    }
  }

  /** Append a timestamped log entry (buffered) */
  log(message: string, meta?: { tension?: number; energy?: number; phase?: string }): void {
    const ts = new Date().toLocaleTimeString("de-DE", { hour12: false });
    const metaStr = meta
      ? ` **[T:${meta.tension?.toFixed(1) ?? "—"} | E:${meta.energy?.toFixed(0) ?? "—"}% | ${meta.phase ?? "—"}]**`
      : "";

    this.buffer.push(`**[${ts}]**${metaStr} ${message}\n`);

    // Flush immediately if threshold reached
    if (this.buffer.length >= FLUSH_THRESHOLD) {
      this.flush();
    }
  }

  /** Write buffered entries to disk (non-blocking via Bun.file/Bun.write) */
  private flush(): void {
    if (this.buffer.length === 0 || this.flushing) return;
    this.flushing = true;

    // Capture current buffer and clear it synchronously to avoid races
    const entries = this.buffer;
    this.buffer = [];

    (async () => {
      try {
        let content = await Bun.file(this.filePath).text();
        const lines = content.split("\n");

        // Trim to MAX_LINES to prevent infinite growth
        if (lines.length > MAX_LINES) {
          const header = lines.slice(0, 3).join("\n");
          const tail = lines.slice(-Math.floor(MAX_LINES * 0.8)).join("\n");
          content = header + "\n\n*(earlier entries trimmed)*\n\n" + tail;
        }

        // Append all buffered lines at once
        content += entries.join("");
        await safeWriteText(this.vaultPath, this.filePath, content);
      } catch {
        // If the file was deleted or locked, entries are discarded
      } finally {
        this.flushing = false;
      }
    })();
  }

  /** Write a section break (for major events like task completion) */
  section(title: string): void {
    this.log(`\n---\n### ${title}\n`);
  }

  /** Flush on shutdown */
  destroy(): void {
    // Synchronous final flush — acceptable on SIGTERM
    if (this.buffer.length > 0) {
      try {
        const file = Bun.file(this.filePath);
        // Use Bun.write synchronously for shutdown (fire-and-forget)
        const entries = this.buffer;
        this.buffer = [];
        Bun.file(this.filePath).text().then(content => {
          content += entries.join("");
          safeWriteText(this.vaultPath, this.filePath, content).catch(() => {});
        }).catch(() => {});
      } catch { /* last resort */ }
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
