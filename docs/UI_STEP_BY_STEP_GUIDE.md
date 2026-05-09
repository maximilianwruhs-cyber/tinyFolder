# tinyFolder + pi — Step-by-Step UI Implementation Guide

## What This Guide Covers

This document is a **file-by-file, line-by-line** recipe for implementing the remaining UI features on top of the already-working pi extension (`gzmo-tinyfolder.ts`).

**Prerequisites** — these are already working and will NOT be modified:
- `GzmoApiClient` (all methods: health, search, submitTask, getTask, connectSSE)
- `waitForApiTaskTerminal` (SSE + poll hybrid)
- `sessionSseClose` cleanup
- File-watcher fallback (`attachGzmoWatchers`)
- `/gzmo` custom TUI component (cached render)
- All existing tools and commands

**What we add:**
1. **VRAM usage bar** in footer + dashboard
2. **Live dashboard refresh** when SSE reports task completion
3. **`/gzmo-start` and `/gzmo-stop` commands** (safe, notify-only)
4. **Model name display** inside the dashboard

---

## Overview of All Files Changed

| File | Purpose |
|---|---|
| `gzmo-daemon/src/api_types.ts` | Add `vram_used_mb` / `vram_total_mb` to `ApiHealthResponse` |
| `gzmo-daemon/src/api_server.ts` | Populate those fields from env vars (`GZMO_VRAM_USED_MB`, `GZMO_VRAM_TOTAL_MB`) |
| `.pi/extensions/gzmo-tinyfolder.ts` | Everything else: VRAM bar, dashboard refresh, lifecycle commands |

---

## Part 1 — Backend: Expose VRAM Fields in Health Response

### 1.1 `gzmo-daemon/src/api_types.ts`

**Location:** The `ApiHealthResponse` interface (last few fields).

**BEFORE:**
```typescript
export interface ApiHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  ollama_connected: boolean;
  model_loaded: string;
  embedding_model: string;
  pending_tasks: number;
  processing_tasks: number;
  uptime_seconds: number;
  vault_path?: string;
}
```

**AFTER:**
```typescript
export interface ApiHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  ollama_connected: boolean;
  model_loaded: string;
  embedding_model: string;
  pending_tasks: number;
  processing_tasks: number;
  uptime_seconds: number;
  vault_path?: string;
  /** GPU memory currently used, in megabytes. Optional until a live metrics module lands. */
  vram_used_mb?: number;
  /** Total GPU memory, in megabytes. Optional until a live metrics module lands. */
  vram_total_mb?: number;
}
```

> **Why optional?** We don't want the frontend to break if the backend is on an older version or if the env vars are missing. The frontend must treat these as `maybe undefined`.

---

### 1.2 `gzmo-daemon/src/api_server.ts`

**Location:** Inside `buildHealthResponse()`, immediately before the final `return { ... }` statement.

**BEFORE:**
```typescript
  const status: ApiHealthResponse["status"] = ollamaConnected ? "healthy" : "degraded";
  return {
    status,
    version: API_VERSION,
    ollama_connected: ollamaConnected,
    model_loaded: process.env.OLLAMA_MODEL ?? "hermes3:8b",
    embedding_model: process.env.GZMO_EMBED_MODEL ?? "nomic-embed-text",
    pending_tasks: pending,
    processing_tasks: processing,
    uptime_seconds: Math.round((Date.now() - startedAtMs) / 1000),
    vault_path: vaultPath,
  };
```

**AFTER:**
```typescript
  const status: ApiHealthResponse["status"] = ollamaConnected ? "healthy" : "degraded";
  return {
    status,
    version: API_VERSION,
    ollama_connected: ollamaConnected,
    model_loaded: process.env.OLLAMA_MODEL ?? "hermes3:8b",
    embedding_model: process.env.GZMO_EMBED_MODEL ?? "nomic-embed-text",
    pending_tasks: pending,
    processing_tasks: processing,
    uptime_seconds: Math.round((Date.now() - startedAtMs) / 1000),
    vault_path: vaultPath,
    vram_used_mb: Number.parseInt(process.env.GZMO_VRAM_USED_MB ?? "0", 10) || undefined,
    vram_total_mb: Number.parseInt(process.env.GZMO_VRAM_TOTAL_MB ?? "0", 10) || undefined,
  };
```

> **Note:** These env vars are a temporary bridge. A future iteration can replace them with live `nvidia-smi` parsing or Ollama metrics scraping. For now, the user can set them in `.env`.
>
> Example `.env` additions:
> ```bash
> GZMO_VRAM_TOTAL_MB="32768"
> GZMO_VRAM_USED_MB="18432"
> ```

**Verify backend typecheck:**
```bash
cd /home/mw/tinyFolder/gzmo-daemon && bun run typecheck
```
You should see `0 errors`.

---

## Part 2 — Frontend Extension (`.pi/extensions/gzmo-tinyfolder.ts`)

This file is ~1850 lines. We make **12 discrete edits**. Each edit is shown with enough surrounding context that you can locate the exact spot.

### 2.1 Add VRAM Fields to `ApiHealthShape`

**Search for:** The `ApiHealthShape` type definition.

**BEFORE:**
```typescript
type ApiHealthShape = {
  status: string;
  version: string;
  ollama_connected: boolean;
  model_loaded: string;
  embedding_model?: string;
  pending_tasks: number;
  processing_tasks: number;
  uptime_seconds: number;
  vault_path?: string;
};
```

**AFTER:**
```typescript
type ApiHealthShape = {
  status: string;
  version: string;
  ollama_connected: boolean;
  model_loaded: string;
  embedding_model?: string;
  pending_tasks: number;
  processing_tasks: number;
  uptime_seconds: number;
  vault_path?: string;
  vram_used_mb?: number;
  vram_total_mb?: number;
};
```

---

### 2.2 Add `formatVramBar()` Helper

**Insert location:** Immediately **before** the `updateUiStatus()` function definition.

Find this line:
```typescript
async function updateUiStatus(ctx: ExtensionContext): Promise<void> {
```

Insert **directly above** it:

```typescript
function formatVramBar(used?: number, total?: number): string {
  if (!used || !total || total <= 0) return "";
  const ratio = used / total;
  const filled = Math.round(ratio * 16);
  const bar = "█".repeat(filled) + "░".repeat(16 - filled);
  const u = Math.round(used / 1024);
  const t = Math.round(total / 1024);
  return `VRAM ${bar} ${u}/${t}GB`;
}
```

---

### 2.3 Add Module-Level `dashboardRenderer` State

**Search for:** The `sessionSseClose` declaration block.

**BEFORE:**
```typescript
const sessionLiveWatch = new Map<string, SessionUiHandles>();
const sessionNotifyPaths = new Map<string, Set<string>>();
const sessionSseClose = new Map<string, () => void>();
```

**AFTER:**
```typescript
const sessionLiveWatch = new Map<string, SessionUiHandles>();
const sessionNotifyPaths = new Map<string, Set<string>>();
const sessionSseClose = new Map<string, () => void>();

/** If the dashboard is currently open, its external refresh handle lives here. */
let dashboardRenderer: { requestRender: () => void; refresh: () => Promise<void> } | null = null;
```

---

### 2.4 Update `updateUiStatus()` — Compact Counts + VRAM Bar

**Search for:** The existing `apiBadge` and `summary` construction inside `updateUiStatus()`.

**BEFORE:**
```typescript
    const apiHealth = await new GzmoApiClient().health(800);
    const apiBadge = apiHealth.ok
      ? `API ${apiHealth.data.status} ● ${apiHealth.data.model_loaded}`
      : "API offline";
    const summary = `GZMO: ${pending} pending, ${processing} processing ● ${apiBadge}`;
```

**AFTER:**
```typescript
    const apiHealth = await new GzmoApiClient().health(800);
    let summary: string;
    if (apiHealth.ok) {
      const vram = formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb);
      const badge = `API ${apiHealth.data.status} ● ${apiHealth.data.model_loaded}`;
      summary = `GZMO: ${pending}p/${processing}a ● ${badge}` + (vram ? ` ● ${vram}` : "");
    } else {
      summary = `GZMO: ${pending}p/${processing}a ● API offline`;
    }
```

> **What changed:**
> - `pending, processing` → `p/a` (pending/active) for compactness
> - Added `formatVramBar()` call when API is healthy
> - Whole summary is now conditional so we don't show "API offline ● undefined" when the API is down

---

### 2.5 Update `DashboardState` Type

**Search for:** The `DashboardState` type definition.

**BEFORE:**
```typescript
type DashboardState = {
  pending: number;
  processing: number;
  vaultName: string;
  tasks: TaskRow[];
  liveLines: string[];
  healthText: string;
};
```

**AFTER:**
```typescript
type DashboardState = {
  pending: number;
  processing: number;
  vaultName: string;
  tasks: TaskRow[];
  liveLines: string[];
  healthText: string;
  model: string;
  vram: string;
};
```

---

### 2.6 Update `fetchDashboardState()` — Fetch API Health + Model/VRAM

**Search for:** The end of `fetchDashboardState()` where `healthText` is assigned and the final `return` is.

**BEFORE:**
```typescript
  const hp = path.join(vaultPath, "GZMO", "health.md");
  let healthText: string;
  try {
    healthText = await tailLines(hp, 12);
  } catch {
    healthText = "(health not available)";
  }
  return { pending, processing, vaultName, tasks, liveLines, healthText };
```

**AFTER:**
```typescript
  const hp = path.join(vaultPath, "GZMO", "health.md");
  let healthText: string;
  try {
    healthText = await tailLines(hp, 12);
  } catch {
    healthText = "(health not available)";
  }

  const client = new GzmoApiClient();
  let model = "(API offline)";
  let vram = "";
  try {
    const apiHealth = await client.health(1000);
    if (apiHealth.ok) {
      model = apiHealth.data.model_loaded;
      vram = formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb);
    }
  } catch { /* ignore */ }

  return { pending, processing, vaultName, tasks, liveLines, healthText, model, vram };
```

---

### 2.7 Add `_renderModelVram()` to Dashboard Component

**Search for:** The `_renderCounts()` method in `GzmoDashboardComponent`.

Insert **a new method** between `_renderHeader()` and `_renderCounts()`.

**BEFORE:**
```typescript
  private _renderHeader(lines: string[], th: Theme, width: number) {
    // ...
  }

  private _renderCounts(lines: string[], th: Theme, width: number) {
```

**AFTER:**
```typescript
  private _renderHeader(lines: string[], th: Theme, width: number) {
    // ... (unchanged)
  }

  private _renderModelVram(lines: string[], th: Theme, width: number) {
    lines.push(truncateToWidth(
      `  ${th.fg("muted", "model:")} ${th.fg("text", this.state.model)}  ${th.fg("accent", this.state.vram)}`,
      width,
    ));
    lines.push("");
  }

  private _renderCounts(lines: string[], th: Theme, width: number) {
```

---

### 2.8 Wire `_renderModelVram()` into `render()`

**Search for:** The `render()` method of `GzmoDashboardComponent`.

**BEFORE:**
```typescript
  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const th = this.theme;
    const lines: string[] = [];
    this._renderHeader(lines, th, width);
    this._renderCounts(lines, th, width);
    this._renderTasks(lines, th, width);
    this._renderLive(lines, th, width);
    this._renderHealth(lines, th, width);
    this._renderFooter(lines, th, width);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
```

**AFTER:**
```typescript
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
```

---

### 2.9 Update the `/gzmo` Command Handler — Register `dashboardRenderer`

**Search for:** The `pi.registerCommand("gzmo", { ... })` block.

**BEFORE:**
```typescript
      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        component = new GzmoDashboardComponent(state, theme, () => done());

        return {
          render: (width: number) => component!.render(width),
          invalidate: () => component!.invalidate(),
          handleInput: (data: string) => {
            if (matchesKey(data, "r")) {
              fetchDashboardState()
                .then((s) => {
                  state = s;
                  component?.setState(s);
                  _tui.requestRender();
                })
                .catch(() => {
                  /* ignore refresh errors */
                });
              return;
            }
            component!.handleInput(data);
          },
        };
      });
```

**AFTER:**
```typescript
      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        component = new GzmoDashboardComponent(state, theme, () => {
          dashboardRenderer = null;
          done();
        });

        dashboardRenderer = {
          requestRender: () => _tui.requestRender(),
          refresh: async () => {
            try {
              const s = await fetchDashboardState();
              state = s;
              component?.setState(s);
              _tui.requestRender();
            } catch {
              /* ignore refresh errors */
            }
          },
        };

        return {
          render: (width: number) => component!.render(width),
          invalidate: () => component!.invalidate(),
          handleInput: (data: string) => {
            if (matchesKey(data, "r")) {
              fetchDashboardState()
                .then((s) => {
                  state = s;
                  component?.setState(s);
                  _tui.requestRender();
                })
                .catch(() => {
                  /* ignore refresh errors */
                });
              return;
            }
            component!.handleInput(data);
          },
        };
      });
```

> **Important:** The close callback `() => { dashboardRenderer = null; done(); }` guarantees that if the dashboard is dismissed (Escape, Ctrl+C, or any other close path), the global `dashboardRenderer` is nulled. Without this, stale closures would continue to call `requestRender()` on a dead TUI instance.

---

### 2.10 Update `attachApiSseListener()` — Trigger Dashboard Refresh

**Search for:** The body of `attachApiSseListener()` where `client.connectSSE()` is called.

**BEFORE:**
```typescript
  const close = client.connectSSE((ev) => {
    if (ev.type !== "task_completed" && ev.type !== "task_failed") return;
    pi.sendMessage(
      {
        customType: "gzmo-task-api",
        content: `GZMO API task ${ev.type.replace("task_", "")}: ${ev.task_id ?? "(no id)"}`,
        display: true,
        details: { task_id: ev.task_id, event: ev },
      },
      { triggerTurn: false },
    );
    void updateUiStatus(ctx);
  });
```

**AFTER:**
```typescript
  const close = client.connectSSE((ev) => {
    if (ev.type !== "task_completed" && ev.type !== "task_failed") return;
    void updateUiStatus(ctx);
    if (dashboardRenderer) {
      void dashboardRenderer.refresh();
    }
    pi.sendMessage(
      {
        customType: "gzmo-task-api",
        content: `GZMO API task ${ev.type.replace("task_", "")}: ${ev.task_id ?? "(no id)"}`,
        display: true,
        details: { task_id: ev.task_id, event: ev },
      },
      { triggerTurn: false },
    );
  });
```

> **Rationale:** `updateUiStatus()` and `dashboardRenderer.refresh()` are called **before** the chat message so that the UI updates appear instantly, even if the chat message render is slightly queued.

---

### 2.11 Add `/gzmo-start` Command

**Search for:** The end of the `gzmo-model` command handler (the last command in the file).

Insert **after** the closing `});` of `gzmo-model` and **before** the final `}` that closes the extension function.

**INSERT:**
```typescript
  pi.registerCommand("gzmo-start", {
    description: "Show the shell command to start the GZMO daemon (user must run it in a separate terminal).",
    handler: async (_args, ctx) => {
      // Walk from the extension file up to the repo root
      const repoRoot = path.resolve(extensionDir, "..", "..");
      const daemonDir = path.join(repoRoot, "gzmo-daemon");
      if (!(await fileExists(path.join(daemonDir, "package.json")))) {
        ctx.ui.notify("Could not locate gzmo-daemon/ relative to the extension. Start it manually.", "warning");
        return;
      }

      // Read GZMO_PROFILE from the nearest .env
      let profile = "core";
      try {
        const envFile = await walkForEnv(process.cwd());
        if (envFile) {
          const parsed = await parseDotEnvFile(envFile);
          profile = asNonEmptyString(parsed["GZMO_PROFILE"]) ?? "core";
        }
      } catch { /* ignore */ }

      const cmd = `cd ${daemonDir} && GZMO_PROFILE=${profile} bun run summon`;
      ctx.ui.notify(
        `To start the GZMO daemon, run the following command in a separate terminal:\n\n${cmd}\n\nOnce started, the extension will auto-detect the API within a few seconds. Press 'r' inside /gzmo to force a refresh.`,
        "info",
      );
    },
  });
```

---

### 2.12 Add `/gzmo-stop` Command

Insert **directly after** the `/gzmo-start` block you just added.

**INSERT:**
```typescript
  pi.registerCommand("gzmo-stop", {
    description: "Show instructions to stop the GZMO daemon.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "To stop the GZMO daemon:\n" +
        "  systemctl --user stop gzmo-daemon   (if you installed the systemd user unit)\n" +
        "  or press Ctrl+C in the terminal running `bun run summon`",
        "info",
      );
    },
  });
```

---

## Part 3 — Verification

### 3.1 Typecheck the Daemon

```bash
cd /home/mw/tinyFolder/gzmo-daemon && bun run typecheck
```
Expected: `0 errors`

### 3.2 Typecheck the Extension (if possible)

The extension is loaded by pi at runtime; there is no separate `tsc` step for it. However, if you have a local TypeScript check setup:

```bash
cd /home/mw/tinyFolder/.pi/extensions && npx tsc --noEmit gzmo-tinyfolder.ts 2>/dev/null || echo "No standalone check available — rely on runtime pi loading"
```

### 3.3 Manual Testing Order

| Step | Action | Expected Result |
|---|---|---|
| 1 | Set `GZMO_VRAM_TOTAL_MB=32768` in `gzmo-daemon/.env` | Env var ready |
| 2 | Start daemon: `cd gzmo-daemon && bun run summon` | Daemon boots, API healthy |
| 3 | Open pi, run `/gzmo-api-health` | Response includes `model:` and (if set) `vram_total_mb` |
| 4 | Look at pi footer | Shows `GZMO: 0p/0a ● API healthy ● qwen3:32b ● VRAM ░░░░░░░░░░░░░░░░ 0/32GB` (or with real values once you set `GZMO_VRAM_USED_MB`) |
| 5 | Run `/gzmo` | Dashboard shows `model:` line with VRAM bar |
| 6 | Submit a search task via `gzmo_api_search` | Dashboard should update automatically (within 1 second of SSE event) without pressing `r` |
| 7 | Press `Escape` to close dashboard | Dashboard closes cleanly; no error on next SSE event |
| 8 | Run `/gzmo-start` | Notification shows exact `cd ... && GZMO_PROFILE=... bun run summon` command |
| 9 | Run `/gzmo-stop` | Notification shows systemd / Ctrl+C instructions |

---

## Part 4 — Troubleshooting

### Dashboard does not auto-refresh when a task completes

1. Check that `attachApiSseListener()` was called on session start. Look for SSE connection logs in the daemon console.
2. Verify the SSE event actually fires: add a `console.log("SSE event:", ev)` inside `connectSSE` callback.
3. Check that `dashboardRenderer` is non-null when the event arrives: add `console.log("dashboardRenderer is", dashboardRenderer)` before the refresh call.

### VRAM bar is blank

1. Check `apiHealth.data.vram_total_mb` is present in `/gzmo-api-health` output.
2. If using env vars, ensure they are exported (no quotes around numbers) in `.env`:
   ```bash
   GZMO_VRAM_TOTAL_MB=32768
   GZMO_VRAM_USED_MB=18432
   ```
3. `formatVramBar()` returns `""` when `used` or `total` is falsy. Ensure both are > 0.

### "Could not locate gzmo-daemon/" from `/gzmo-start`

The command walks from `extensionDir` (`.pi/extensions/`) up two levels. If your repo layout is different, adjust `path.resolve(extensionDir, "..", "..")` to match your actual `tinyFolder/` root.

---

## Part 5 — Future Extensions (Not Yet Implemented)

These are documented here so they don't surprise you later:

1. **Live VRAM via `nvidia-smi`:** Replace the env var bridge with periodic `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits` parsing inside the daemon.
2. **API Soft-Shutdown:** Add `POST /api/v1/shutdown` to the daemon (returns 200 then calls `process.exit(0)` after a 100ms timeout). Then `/gzmo-stop` can actually trigger shutdown instead of just showing instructions.
3. **Token rate (tok/s):** If Ollama metrics are exposed, add `tok_per_sec` to `ApiHealthResponse` and show it in the footer.

---

## Appendix: Full Diff Summary

For quick reference, here is every block that changes, listed in file order.

### `gzmo-daemon/src/api_types.ts`
- Add `vram_used_mb?: number;` and `vram_total_mb?: number;` to `ApiHealthResponse`

### `gzmo-daemon/src/api_server.ts`
- Add `vram_used_mb` / `vram_total_mb` fields (read from env) to `buildHealthResponse()` return object

### `.pi/extensions/gzmo-tinyfolder.ts`
1. Extend `ApiHealthShape` with `vram_used_mb?` / `vram_total_mb?`
2. Add `formatVramBar()` helper function
3. Add module-level `let dashboardRenderer`
4. Replace `apiBadge` + `summary` construction in `updateUiStatus()`
5. Extend `DashboardState` with `model` / `vram`
6. Fetch API health in `fetchDashboardState()` and return new fields
7. Add `_renderModelVram()` method to `GzmoDashboardComponent`
8. Insert `this._renderModelVram(...)` into `render()` call chain
9. Register `dashboardRenderer` + null-on-close inside `/gzmo` handler
10. Trigger `dashboardRenderer?.refresh()` inside SSE callback
11. Add `pi.registerCommand("gzmo-start", ...)`
12. Add `pi.registerCommand("gzmo-stop", ...)`
