# tinyFolder + pi — UI / Frontend Implementation Plan

## Status: Phase 2 (Extension) — Partially Complete

The prior agent implemented a robust base:
- ✅ `GzmoApiClient` with `health`, `search`, `submitTask`, `getTask`, `connectSSE`
- ✅ API tools: `gzmo_api_health`, `gzmo_api_search`, `gzmo_api_think`
- ✅ Commands: `/gzmo` (dashboard), `/gzmo-last`, `/gzmo-api-health`, `/gzmo-trace`, `/gzmo-model`
- ✅ SSE listener for task notifications
- ✅ `maybeWarnLocalOnly()` for airgap mode
- ✅ `updateUiStatus()` with basic API badge

**What remains to close the loop:** VRAM display, live dashboard refresh, and safe daemon lifecycle commands.

---

## 1. VRAM Bar in Footer / Widget (Priority: High)

### Problem
`updateUiStatus()` only shows:
`GZMO: 2 pending, 1 processing ● API healthy ● qwen3:32b`
There is **no GPU memory indicator**.

### Goal
Show a compact VRAM usage bar when the API is healthy:
```
GZMO: 2p/1a ● qwen3:32b ● VRAM ████████████░░░░ 18/32GB
```

### Step 1.1 — Extend `ApiHealthShape` in the extension

**File:** `.pi/extensions/gzmo-tinyfolder.ts`

Add new fields to `ApiHealthShape` type:
```typescript
type ApiHealthShape = {
  // ... existing fields ...
  vram_used_mb?: number;
  vram_total_mb?: number;
};
```

*(Note: The backend `buildHealthResponse()` in `api_server.ts` does **not** yet emit VRAM. The extension should gracefully handle missing fields.)*

### Step 1.2 — Render helper for VRAM bar

Add a `formatVramBar(used_mb?: number, total_mb?: number)` helper:
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

### Step 1.3 — Update `updateUiStatus()`

In the existing function, replace the summary construction:
```typescript
// OLD:
const apiBadge = apiHealth.ok
  ? `API ${apiHealth.data.status} ● ${apiHealth.data.model_loaded}`
  : "API offline";
const summary = `GZMO: ${pending} pending, ${processing} processing ● ${apiBadge}`;

// NEW:
let summary: string;
if (apiHealth.ok) {
  const vram = formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb);
  const badge = `API ${apiHealth.data.status} ● ${apiHealth.data.model_loaded}`;
  summary = `GZMO: ${pending}p/${processing}a ● ${badge}` + (vram ? ` ● ${vram}` : "");
} else {
  summary = `GZMO: ${pending}p/${processing}a ● API offline`;
}
```

### Step 1.4 — Optional: Backend exposes VRAM

**File:** `gzmo-daemon/src/api_server.ts` — `buildHealthResponse()`

This requires calling the Ollama API for VRAM stats or parsing `nvidia-smi`. Keep it simple: read from an env fallback or skip until a dedicated metrics module exists.

**Recommended:** Use environment variable as bridge:
```bash
# In .env
GZMO_VRAM_TOTAL_MB="32768"
```

Then in `buildHealthResponse()`:
```typescript
vram_used_mb: Number.parseInt(process.env.GZMO_VRAM_USED_MB ?? "0", 10) || undefined,
vram_total_mb: Number.parseInt(process.env.GZMO_VRAM_TOTAL_MB ?? "0", 10) || undefined,
```

A future agent can replace this with live `nvidia-smi` parsing.

---

## 2. Live Dashboard Refresh via SSE (Priority: High)

### Problem
User opens `/gzmo` dashboard. A task completes. The dashboard still shows old counts until the user presses `r`.

### Goal
When an SSE `task_completed`/`task_failed` event arrives, automatically refresh the dashboard **if it is currently open**.

### Step 2.1 — Track open dashboard state

Add module-level state in the extension:
```typescript
let dashboardRenderer: { requestRender: () => void; refresh: () => Promise<void> } | null = null;
```

### Step 2.2 — Modify `attachApiSseListener()`

Current SSE handler only sends chat messages. Also trigger dashboard refresh:
```typescript
const close = client.connectSSE((ev) => {
  if (ev.type === "task_completed" || ev.type === "task_failed") {
    // existing chat message...
    void updateUiStatus(ctx);

    // NEW: refresh dashboard if open
    if (dashboardRenderer) {
      void dashboardRenderer.refresh();
    }
  }
});
```

### Step 2.3 — Modify `/gzmo` command handler

When the custom UI component is created, register it in `dashboardRenderer`:

```typescript
await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
  component = new GzmoDashboardComponent(state, theme, () => {
    dashboardRenderer = null;
    done();
  });

  // Register for external refresh
  dashboardRenderer = {
    requestRender: () => _tui.requestRender(),
    refresh: async () => {
      try {
        const s = await fetchDashboardState();
        state = s;
        component?.setState(s);
        _tui.requestRender();
      } catch { /* ignore */ }
    },
  };

  return {
    render: (width: number) => component!.render(width),
    invalidate: () => component!.invalidate(),
    handleInput: (data: string) => { /* ... existing ... */ },
  };
});
```

### Step 2.4 — Cleanup on close

On `Escape` or close, `dashboardRenderer` must be nulled:
```typescript
component = new GzmoDashboardComponent(state, theme, () => {
  dashboardRenderer = null;
  done();
});
```

---

## 3. `/gzmo-start` and `/gzmo-stop` Commands (Priority: Medium)

### Context
The prior agent **skipped** `ensureDaemonRunning()` because spawning a long-lived `bun run summon` subprocess from the extension risks a process leak if pi crashes. This is a valid concern.

### Approach — Notify-Only (Safe)
Instead of auto-spawning, provide **commands that the user runs intentionally**:

### Step 3.1 — `/gzmo-start` (User-Initiated)

```typescript
pi.registerCommand("gzmo-start", {
  description: "Show the shell command to start the GZMO daemon. Does NOT spawn it automatically.",
  handler: async (_args, ctx) => {
    const repoRoot = process.cwd(); // or walk up to find gzmo-daemon/
    const cmd = `cd ${repoRoot}/gzmo-daemon && GZMO_PROFILE=core bun run summon`;
    ctx.ui.notify(
      `To start GZMO daemon, run in a separate terminal:\n\n${cmd}\n\nThen press 'r' in /gzmo or wait for auto-detection.`,
      "info"
    );
  },
});
```

### Step 3.2 — `/gzmo-stop` (Signal-based, safe)

Because the extension does **not** own the daemon process, it cannot directly kill it. However, the extension **can** send a message telling the user how to stop:

```typescript
pi.registerCommand("gzmo-stop", {
  description: "Show instructions to stop the GZMO daemon.",
  handler: async (_args, ctx) => {
    ctx.ui.notify(
      "To stop the daemon:\n" +
      "  systemctl --user stop gzmo-daemon   (if systemd)\n" +
      "  or press Ctrl+C in the terminal running 'bun run summon'",
      "info"
    );
  },
});
```

### Alternative: API Soft-Shutdown (Future)
Add `POST /api/v1/shutdown` to the daemon that calls `process.exit(0)` gracefully. The extension can then call it:
```typescript
// In extension handler for /gzmo-stop:
await new GzmoApiClient().fetchJson("/api/v1/shutdown", { method: "POST", timeoutMs: 2000 });
ctx.ui.notify("Daemon shutdown requested.", "info");
```
This requires backend changes (add shutdown route + signal handling in `index.ts`).

---

## 4. Dashboard Enhancements

### Step 4.1 — Add Model + VRAM Line to Dashboard

In `fetchDashboardState()`, also fetch API health:
```typescript
async function fetchDashboardState(): Promise<DashboardState> {
  // ... existing ...

  const client = new GzmoApiClient();
  const apiHealth = await client.health(1000);

  return {
    // ... existing fields ...
    model: apiHealth.ok ? apiHealth.data.model_loaded : "(API offline)",
    vram: formatVramBar(apiHealth.data.vram_used_mb, apiHealth.data.vram_total_mb),
  };
}
```

Update `DashboardState`:
```typescript
type DashboardState = {
  // ... existing ...
  model: string;
  vram: string;
};
```

Add `_renderModelVram()` in `GzmoDashboardComponent`:
```typescript
private _renderModelVram(lines: string[], th: Theme, width: number) {
  lines.push(truncateToWidth(
    `  ${th.fg("muted", "model:")} ${th.fg("text", this.state.model)}  ${th.fg("accent", this.state.vram)}`,
    width
  ));
  lines.push("");
}
```

Call it from `render()` between `_renderHeader()` and `_renderCounts()`.

### Step 4.2 — Add Token Rate to Dashboard

If the API ever exposes `tok/s` (Ollama metrics), add it here.

---

## 5. Summary: What Files Change

| File | What Changes |
|---|---|
| `.pi/extensions/gzmo-tinyfolder.ts` | Add VRAM helpers, update `updateUiStatus`, add model/vram to DashboardState, add `_renderModelVram()`, add SSE-triggered dashboard refresh, add `/gzmo-start` and `/gzmo-stop` commands |
| `gzmo-daemon/src/api_server.ts` | Optionally add `vram_used_mb`/`vram_total_mb` to `ApiHealthResponse` (env-based for now) |
| `gzmo-daemon/src/api_types.ts` | Add `vram_used_mb`/`vram_total_mb` to `ApiHealthResponse` type |

---

## 6. Testing Checklist

1. **VRAM Bar:** Set `GZMO_VRAM_TOTAL_MB=32768` in daemon `.env`, start daemon, open pi. Footer shows bar.
2. **Dashboard Refresh:** Open `/gzmo`, submit a search via `gzmo_api_search`. When task completes, dashboard updates within 1s without pressing `r`.
3. **`/gzmo-start`:** Run command. Shows shell command in notification. Run it in another terminal. Extension auto-detects API within 5s.
4. **`/gzmo-stop`:** After backend adds shutdown route, command gracefully exits daemon.
5. **Airgap Warning:** Set `GZMO_LOCAL_ONLY=1` and `PI_BASE_URL=https://...`. On session start, pi shows warning.

---

## Appendix: Existing Extension State (Do Not Break)

The following are already working and must be preserved:
- `GzmoApiClient` (all methods)
- `waitForApiTaskTerminal` (SSE + poll hybrid)
- `sessionSseClose` cleanup
- File-watcher fallback (`attachGzmoWatchers`)
- `/gzmo` custom TUI component (cached render)
- All existing tools: `gzmo_submit_task`, `gzmo_read_task`, `gzmo_watch_task`, `gzmo_query_context`, `gzmo_list_tasks`, `gzmo_last_tasks`, `gzmo_health`, `gzmo_api_health`, `gzmo_api_search`, `gzmo_api_think`
- All existing commands: `/gzmo`, `/gzmo-last`, `/gzmo-api-health`, `/gzmo-trace`, `/gzmo-model`
