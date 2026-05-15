/**
 * gzmo_dashboard.ts — TUI dashboard component, status-bar updater, and the
 * VRAM bar formatter. Lives separately from the entry so the 1900-line
 * `gzmo-tinyfolder.ts` shrinks to the orchestration / command-registration
 * layer it should be.
 *
 * The `dashboardRenderer` reference is module-local with getter/setter
 * accessors so the entry's SSE handler can nudge a redraw without exposing a
 * mutable variable across files.
 */

import path from "node:path";
import fsp from "node:fs/promises";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

import {
  fileExists,
  listInbox,
  readTaskStatus,
  resolveVaultPath,
  tailLineArray,
  tailLines,
  type TaskRow,
} from "./gzmo_shared";
import { GzmoApiClient } from "./gzmo_api_client";

/**
 * Render a 16-cell VRAM usage bar like `VRAM ███████░░░░░░░░░ 18/32GB`.
 * Returns an empty string only when telemetry is genuinely missing
 * (`used`/`total` undefined or `total <= 0`). Explicit `used=0` renders a
 * full empty bar — useful for the "model not loaded yet" state on first boot.
 */
export function formatVramBar(used?: number, total?: number): string {
  if (used === undefined || used === null || total === undefined || total === null || total <= 0) {
    return "";
  }
  const ratio = Math.min(1, Math.max(0, used) / total);
  const filled = Math.round(ratio * 16);
  const bar = "█".repeat(filled) + "░".repeat(16 - filled);
  const u = Math.round(used / 1024);
  const t = Math.round(total / 1024);
  return `VRAM ${bar} ${u}/${t}GB`;
}

/**
 * Refresh the Pi status bar + below-editor widget with current GZMO state.
 * Failure (e.g. unresolved vault) is non-fatal: we replace the widget with a
 * single-line error so the TUI never goes stale.
 */
export async function updateUiStatus(ctx: ExtensionContext): Promise<void> {
  try {
    const { vaultPath } = await resolveVaultPath();
    const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
    let pending = 0;
    let processing = 0;
    let unbound = 0;
    if (await fileExists(inboxDir)) {
      const entries = await fsp.readdir(inboxDir);
      for (const e of entries) {
        if (!e.endsWith(".md")) continue;
        const p = path.join(inboxDir, e);
        try {
          const s = await readTaskStatus(p);
          if (s === "pending") pending++;
          if (s === "processing") processing++;
          if (s === "unbound") unbound++;
        } catch {
          // ignore unreadable tasks
        }
      }
    }
    const vaultName = path.basename(vaultPath);
    const apiHealth = await new GzmoApiClient().health(800);
    let summary: string;
    if (apiHealth.ok) {
      const vram = formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb);
      const badge = `API ${apiHealth.data.status} ● ${apiHealth.data.model_loaded}`;
      const ub = unbound > 0 ? `/${unbound}u` : "";
      summary = `GZMO: ${pending}p/${processing}a${ub} ● ${badge}` + (vram ? ` ● ${vram}` : "");
    } else {
      const ub = unbound > 0 ? `/${unbound}u` : "";
      summary = `GZMO: ${pending}p/${processing}a${ub} ● API offline`;
    }
    ctx.ui.setStatus("gzmo", summary);

    const liveStreamPath = path.join(vaultPath, "GZMO", "Live_Stream.md");
    let tail: string[] = await fileExists(liveStreamPath)
      ? tailLineArray(await fsp.readFile(liveStreamPath, "utf8"), 5).map((l) =>
          l.length > 240 ? `${l.slice(0, 237)}…` : l,
        )
      : [];

    if (tail.length === 0) tail = ["(Live_Stream idle or not created yet)"];

    const widgetLines = [summary, `vault: ${vaultName}`, "── live ──", ...tail];
    ctx.ui.setWidget("gzmo", widgetLines, { placement: "belowEditor" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.setStatus("gzmo", `GZMO: env missing (${msg})`);
    ctx.ui.setWidget("gzmo", [`GZMO: env missing`, msg], { placement: "belowEditor" });
  }
}

export type DashboardState = {
  pending: number;
  processing: number;
  vaultName: string;
  tasks: TaskRow[];
  liveLines: string[];
  healthText: string;
  /** Currently loaded model (e.g. "qwen3:32b") or "(API offline)" when unreachable. */
  model: string;
  /** Pre-formatted VRAM bar string, or "" when no VRAM telemetry is available. */
  vram: string;
};

export class GzmoDashboardComponent {
  private state: DashboardState;
  private theme: Theme;
  private onClose: () => void;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(state: DashboardState, theme: Theme, onClose: () => void) {
    this.state = state;
    this.theme = theme;
    this.onClose = onClose;
  }

  setState(state: DashboardState) {
    this.state = state;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const th = this.theme;
    const lines: string[] = [];
    this._renderHeader(lines, th, width);
    this._renderModelVram(lines, th, width);
    this._renderCounts(lines, th, width);
    this._renderTasks(lines, th, width);
    this._renderLive(lines, th, width);
    this._renderHealth(lines, th, width);
    this._renderFooter(lines, th, width);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private _renderHeader(lines: string[], th: Theme, width: number) {
    const title = th.fg("accent", " GZMO ");
    const headerLine =
      th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
    lines.push("");
    lines.push(truncateToWidth(headerLine, width));
    lines.push("");
  }

  private _renderModelVram(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(
      `  ${th.fg("muted", "model:")} ${th.fg("text", this.state.model)}  ${th.fg("accent", this.state.vram)}`,
      width,
    ));
    lines.push("");
  }

  private _renderCounts(lines: string[], th: Theme, width: number) {
    lines.push(
      truncateToWidth(
        `  ${th.fg("muted", "vault:")} ${th.fg("text", this.state.vaultName)}  ${th.fg("warning", `${this.state.pending} pending`)}  ${th.fg("accent", `${this.state.processing} processing`)}`,
        width,
      ),
    );
    lines.push("");
  }

  private _renderTasks(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("muted", "Recent Inbox (newest first)")}`, width));
    if (this.state.tasks.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "(no tasks)")}`, width));
    } else {
      for (const t of this.state.tasks) {
        const st = t.status ?? "?";
        const col =
          st === "completed"
            ? th.fg("success", st)
            : st === "failed"
              ? th.fg("error", st)
              : st === "unbound"
                ? th.fg("warning", st)
                : th.fg("muted", st);
        const base = path.basename(t.path);
        lines.push(truncateToWidth(`  ${col} ${th.fg("dim", String(t.action ?? "?"))}  ${base}`, width));
      }
    }
    lines.push("");
  }

  private _renderLive(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("muted", "Live_Stream (tail)")}`, width));
    for (const ln of this.state.liveLines) {
      lines.push(truncateToWidth(`  ${th.fg("dim", ln)}`, width));
    }
    lines.push("");
  }

  private _renderHealth(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("muted", "health.md (tail)")}`, width));
    for (const ln of this.state.healthText.split("\n").slice(0, 8)) {
      lines.push(truncateToWidth(`  ${th.fg("text", ln)}`, width));
    }
    lines.push("");
  }

  private _renderFooter(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(`  ${th.fg("dim", "r = refresh  |  Escape = close")}`, width));
    lines.push("");
  }
}

export async function fetchDashboardState(): Promise<DashboardState> {
  const { vaultPath } = await resolveVaultPath();
  const vaultName = path.basename(vaultPath);
  const inboxDir = path.join(vaultPath, "GZMO", "Inbox");
  let pending = 0;
  let processing = 0;
  if (await fileExists(inboxDir)) {
    for (const e of await fsp.readdir(inboxDir)) {
      if (!e.endsWith(".md")) continue;
      const p = path.join(inboxDir, e);
      try {
        const s = await readTaskStatus(p);
        if (s === "pending") pending++;
        if (s === "processing") processing++;
      } catch { /* */ }
    }
  }
  const tasks = await listInbox(null, 10);
  const liveStreamPath = path.join(vaultPath, "GZMO", "Live_Stream.md");
  const liveLines = await fileExists(liveStreamPath)
    ? tailLineArray(await fsp.readFile(liveStreamPath, "utf8"), 8).map((l) =>
        l.length > 120 ? `${l.slice(0, 117)}…` : l,
      )
    : ["(no Live_Stream yet)"];
  const hp = path.join(vaultPath, "GZMO", "health.md");
  let healthText: string;
  try {
    healthText = await tailLines(hp, 12);
  } catch {
    healthText = "(health not available)";
  }

  // Best-effort API probe: dashboard renders even when the daemon is down.
  const client = new GzmoApiClient();
  let model = "(API offline)";
  let vram = "";
  try {
    const apiHealth = await client.health(1000);
    if (apiHealth.ok) {
      model = apiHealth.data.model_loaded;
      vram = formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb);
    }
  } catch { /* ignore — keep "(API offline)" defaults */ }

  return { pending, processing, vaultName, tasks, liveLines, healthText, model, vram };
}

/* ── dashboard-renderer accessor ──
 *
 * The entry's SSE handler nudges the dashboard to redraw on `task_completed`
 * / `task_failed` events. To avoid exposing a mutable cross-module variable,
 * we expose a getter/setter pair. The `/gzmo` command in the entry calls
 * `setDashboardRenderer({ requestRender, refresh })` on open and
 * `setDashboardRenderer(null)` on close.
 */

export type DashboardRenderer = {
  requestRender: () => void;
  refresh: () => Promise<void>;
};

let _dashboardRenderer: DashboardRenderer | null = null;

export function setDashboardRenderer(r: DashboardRenderer | null): void {
  _dashboardRenderer = r;
}

export function getDashboardRenderer(): DashboardRenderer | null {
  return _dashboardRenderer;
}
