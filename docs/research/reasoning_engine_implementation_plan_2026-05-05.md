# GZMO Reasoning Engine — Comprehensive Implementation Plan

**Status:** Ready for implementation  
**Date:** 2026-05-05  
**Prerequisites:** Review `reasoning_engine_proposal_2026-05-05.md` and `why_gzmo_needs_reasoning_engine_2026-05-05.md`

---

## How to Read This Document

Each phase has:
- **Goal** — what is built and why
- **Files changed / created** — exact paths
- **Data structures** — TypeScript interfaces
- **Step-by-step** — ordered implementation tasks
- **Acceptance criteria** — "done when..."
- **Risk register** — what could go wrong
- **Rollback path** — how to disable if needed

**Total estimated effort:** 2.5–3 weeks (one developer, focused)  
**Can run incrementally** — each phase is independently valuable and can ship alone.

---

## Pre-Flight: Development Environment

Before any code changes:

1. **Create a feature branch:**
   ```bash
   cd /home/mw/tinyFolder
   git checkout -b reasoning-engine
   ```

2. **Verify current eval harness passes:**
   ```bash
   cd gzmo-daemon
   bun run eval:quality
   # Expect: ok=true, details=[]
   ```

3. **Copy current `engine.ts` as reference:**
   ```bash
   cp gzmo-daemon/src/engine.ts gzmo-daemon/src/engine.ts.baseline
   ```

4. **Create reasoning trace directory:**
   ```bash
   mkdir -p gzmo-vault-example/GZMO/Reasoning_Traces
   ```

---

## Phase 1: Thinking Infrastructure (Days 1–3)

### Goal
Make reasoning **visible, structured, and persistent**. This is the foundation everything else builds on. Zero risk to existing behavior.

### 1.1 Define Trace Node Schema

**New file:** `gzmo-daemon/src/reasoning_trace.ts`

```typescript
/**
 * Reasoning Trace — structured internal reasoning for every task.
 *
 * Core invariant: EVERY task produces a trace, even if the model
 * does not emit explicit thinking blocks. The trace captures:
 * - What the engine did (retrieve, reason, verify, etc.)
 * - What evidence it used
 * - What it concluded and with what confidence
 * - Where it failed or abstained
 */

export type ReasoningNodeType =
  | "task_start"        // root node: task metadata
  | "analyze"           // decompose user intent into sub-goals
  | "retrieve"          // search vault / read files / run tools
  | "reason"            // derive claims from evidence
  | "verify"            // check claims against safety / evidence
  | "tool_call"         // external tool execution (Phase 2)
  | "answer"            // final output synthesis
  | "retry"             // reflection → adjusted retry
  | "abstain";          // explicit "insufficient evidence"

export interface ReasoningNode {
  node_id: string;           // "n0", "n1" ... or UUID
  trace_id: string;          // UUID per task
  parent_id: string | null;  // tree structure
  type: ReasoningNodeType;
  depth: number;             // tree depth (0 = root)

  // What was the engine thinking at this step?
  prompt_summary: string;    // 100-char max description of input
  raw_thinking?: string;     // verbatim <thinking> block if present

  // Evidence used at this step
  evidence_cited?: string[]; // ["E1", "E2"]
  tools_used?: string[];     // ["vault_read", "fs_grep"] (Phase 2)

  // Claims produced
  claims?: Array<{
    text: string;
    confidence: number;      // 0..1, NaN = not scored
    sources: string[];       // evidence IDs backing this claim
  }>;

  // Outcome
  outcome: "success" | "failure" | "abstain" | "partial";

  // Metadata
  model?: string;            // which model produced this
  tokens_used?: number;      // if available from ai-sdk
  elapsed_ms: number;
  timestamp: string;         // ISO 8601
}

export interface ReasoningTrace {
  trace_id: string;
  task_file: string;         // e.g. "GZMO/Inbox/000_task.md"
  action: "think" | "search" | "chain";
  model: string;
  total_tokens?: number;
  total_elapsed_ms: number;
  nodes: ReasoningNode[];
  final_answer: string;
  status: "completed" | "failed";
}

// ── Persistence ─────────────────────────────────────────────────

import { atomicWriteJson, safeAppendJsonl } from "./vault_fs";
import { join } from "path";

const TRACES_SUBDIR = "GZMO/Reasoning_Traces";

export async function persistTrace(
  vaultPath: string,
  trace: ReasoningTrace,
): Promise<string> {
  const filename = `${trace.trace_id}.json`;
  const filepath = join(vaultPath, TRACES_SUBDIR, filename);
  await atomicWriteJson(vaultPath, filepath, trace);
  return filepath;
}

// Append lightweight index entry for fast scanning without loading every trace
export async function appendTraceIndex(
  vaultPath: string,
  trace: ReasoningTrace,
): Promise<void> {
  const indexPath = join(vaultPath, TRACES_SUBDIR, "index.jsonl");
  const entry = {
    trace_id: trace.trace_id,
    task_file: trace.task_file,
    action: trace.action,
    status: trace.status,
    node_count: trace.nodes.length,
    total_elapsed_ms: trace.total_elapsed_ms,
    timestamp: new Date().toISOString(),
  };
  await safeAppendJsonl(vaultPath, indexPath, entry);
}

// Query: find traces by task file
export async function findTracesForTask(
  vaultPath: string,
  taskFile: string,
): Promise<ReasoningTrace[]> {
  const dir = join(vaultPath, TRACES_SUBDIR);
  // Naive scan — adequate for <1000 traces; add index later if needed
  const files = await fsp.readdir(dir).catch(() => [] as string[]);
  const traces: ReasoningTrace[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await Bun.file(join(dir, f)).text();
      const t = JSON.parse(raw) as ReasoningTrace;
      if (t.task_file === taskFile) traces.push(t);
    } catch {
      continue;
    }
  }
  // Newest first
  traces.sort((a, b) => new Date(b.nodes[0]?.timestamp ?? 0).getTime() - new Date(a.nodes[0]?.timestamp ?? 0).getTime());
  return traces;
}
```

### 1.2 Modify `infer()` to Return Both Thinking and Answer

**File:** `gzmo-daemon/src/engine.ts` (function `infer()`)

Current behavior: strips `<thinking>` blocks, returns only visible output.

New behavior: return structured result with both.

```typescript
// Add to engine.ts
export interface InferenceResult {
  answer: string;          // visible output (what user sees)
  thinking?: string;       // reasoning block if model emitted one
  raw: string;             // complete raw output (for debugging)
  tokens_used?: number;    // if ai-sdk exposes this
  elapsed_ms: number;
}

export async function inferDetailed(
  system: string,
  prompt: string,
): Promise<InferenceResult> {
  const t0 = Date.now();

  // Apply MIND filter (existing behavior)
  let inferPrompt = prompt;
  const mindEnabled = String(process.env.GZMO_MIND_FILTER ?? "on").toLowerCase() !== "off";
  if (mindEnabled) {
    const mind = applyMindFilter(prompt);
    if (mind.applied) inferPrompt = mind.filtered;
  }

  const result = streamText({
    model: ollama(OLLAMA_MODEL),
    system,
    prompt: inferPrompt,
  });

  let raw = "";
  for await (const chunk of result.textStream) raw += chunk;
  raw = raw.trim();

  // Extract thinking blocks (support Qwen3 and <thinking> formats)
  let thinking: string | undefined;
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>\n?/i);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
  }
  const thinkingMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>\n?/i);
  if (thinkingMatch) {
    thinking = thinkingMatch[1].trim();
  }

  // Answer = raw with thinking blocks removed (existing behavior)
  const answer = raw
    .replace(/<think>[\s\S]*?<\/think>\n?/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>\n?/gi, "")
    .trim();

  return {
    answer,
    thinking,
    raw,
    elapsed_ms: Date.now() - t0,
  };
}

// Keep backward-compatible `infer()` wrapper
export async function infer(system: string, prompt: string): Promise<string> {
  const res = await inferDetailed(system, prompt);
  return res.answer;
}
```

### 1.3 Integrate Trace Creation into `processTask()`

**File:** `gzmo-daemon/src/engine.ts` (function `processTask()`)

Wrap `processTask` with trace creation. The trace accumulates as the pipeline runs.

```typescript
// At the top of processTask(), after variable declarations:
const traceId = crypto.randomUUID();
const nodes: ReasoningNode[] = [];

function addNode(node: Omit<ReasoningNode, "trace_id" | "elapsed_ms" | "timestamp">): ReasoningNode {
  const n: ReasoningNode = {
    ...node,
    trace_id: traceId,
    elapsed_ms: 0, // filled later
    timestamp: new Date().toISOString(),
  };
  nodes.push(n);
  return n;
}

// Root node
addNode({
  node_id: "n0",
  parent_id: null,
  type: "task_start",
  depth: 0,
  prompt_summary: `${fileName} (${action}): ${body.slice(0, 80)}...`,
  outcome: "success",
  elapsed_ms: 0,
});

// After pipeline.prepare():
addNode({
  node_id: "n1",
  parent_id: "n0",
  type: "analyze",
  depth: 1,
  prompt_summary: `Pipeline ${action} prepared`,
  outcome: "success",
  elapsed_ms: nodes[0].elapsed_ms, // approximate
});

// Replace the existing LLM call in processTask():
let inferResult: InferenceResult;
if (!usedDeterministic) {
  const mind = applyMindFilter(body);
  const systemPrompt = ctx.systemPrompt;

  inferResult = await inferDetailed(systemPrompt, mind.filtered);
  rawOutput = inferResult.answer;

  if (inferResult.thinking) {
    addNode({
      node_id: `n${nodes.length}`,
      parent_id: "n1",
      type: "reason",
      depth: 2,
      prompt_summary: `LLM reasoning (temp=${temp}, maxTok=${maxTok})`,
      raw_thinking: inferResult.thinking,
      outcome: "success",
      elapsed_ms: inferResult.elapsed_ms,
      model: OLLAMA_MODEL,
    });
  }
} else {
  rawOutput = deterministicAnswer!;
  inferResult = {
    answer: rawOutput,
    raw: rawOutput,
    elapsed_ms: 0,
  };
}

// After validateAndShape():
addNode({
  node_id: `n${nodes.length}`,
  parent_id: "n1",
  type: "verify",
  depth: 2,
  prompt_summary: "Post-processing: citations, safety, shape",
  outcome: "success",
  elapsed_ms: Date.now() - startTime - (inferResult.elapsed_ms ?? 0),
});

// At completion (just before markCompleted):
const trace: ReasoningTrace = {
  trace_id: traceId,
  task_file: relative(resolve(vaultRoot), resolve(filePath)),
  action,
  model: OLLAMA_MODEL,
  total_elapsed_ms: Date.now() - startTime,
  nodes,
  final_answer: fullText,
  status: "completed",
};
await persistTrace(vaultRoot, trace);
await appendTraceIndex(vaultRoot, trace);

// Also in catch block (failed tasks get traces too):
const failTrace: ReasoningTrace = {
  trace_id: traceId,
  task_file: relative(resolve(vaultRoot), resolve(filePath)),
  action,
  model: OLLAMA_MODEL,
  total_elapsed_ms: Date.now() - startTime,
  nodes,
  final_answer: err?.message ?? "Unknown error",
  status: "failed",
};
try {
  await persistTrace(vaultRoot, failTrace);
  await appendTraceIndex(vaultRoot, failTrace);
} catch {}
```

### 1.4 Add `crypto` import and clean up

**File:** `gzmo-daemon/src/engine.ts`

```typescript
// Add at top of engine.ts
import { randomUUID } from "crypto";
```

### 1.5 Create Trace Viewer (Minimal CLI)

**New file:** `gzmo-daemon/src/trace_viewer.ts`

```typescript
/**
 * CLI trace viewer: bun run src/trace_viewer.ts <trace_id_or_task_file>
 *
 * Prints a human-readable tree of reasoning steps.
 */
import { resolve, join } from "path";
import { existsSync } from "fs";
import { findTracesForTask, type ReasoningTrace } from "./reasoning_trace";

function renderTrace(trace: ReasoningTrace): void {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Trace: ${trace.trace_id}`);
  console.log(`  Task:  ${trace.task_file} (${trace.action})`);
  console.log(`  Model: ${trace.model} | Status: ${trace.status}`);
  console.log(`  Nodes: ${trace.nodes.length} | Time: ${trace.total_elapsed_ms}ms`);
  console.log(`═══════════════════════════════════════════════\n`);

  for (const node of trace.nodes) {
    const indent = "  ".repeat(node.depth);
    const icon = {
      task_start: "📋",
      analyze: "🔍",
      retrieve: "📚",
      reason: "🧠",
      verify: "✅",
      tool_call: "🔧",
      answer: "💬",
      retry: "🔄",
      abstain: "⚠️",
    }[node.type] ?? "•";

    console.log(`${indent}${icon} [${node.type}] ${node.prompt_summary}`);
    if (node.outcome !== "success") {
      console.log(`${indent}   → outcome: ${node.outcome}`);
    }
    if (node.raw_thinking && process.argv.includes("--thinking")) {
      const lines = node.raw_thinking.split("\n").slice(0, 6);
      for (const line of lines) {
        console.log(`${indent}   │ ${line.slice(0, 100)}`);
      }
      if (node.raw_thinking.split("\n").length > 6) {
        console.log(`${indent}   │ ... (${node.raw_thinking.split("\n").length - 6} more lines)`);
      }
    }
  }

  console.log(`\n── Final answer ──\n${trace.final_answer.slice(0, 400)}${trace.final_answer.length > 400 ? "..." : ""}\n`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: bun run src/trace_viewer.ts <trace_id_or_task_file> [--thinking]");
    process.exit(1);
  }

  const vaultPath = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../../vault");
  const tracesDir = join(vaultPath, "GZMO", "Reasoning_Traces");

  if (!existsSync(tracesDir)) {
    console.error(`No traces directory: ${tracesDir}`);
    process.exit(1);
  }

  // Try loading by trace_id
  const byId = join(tracesDir, `${arg}.json`);
  if (existsSync(byId)) {
    const trace = JSON.parse(await Bun.file(byId).text()) as ReasoningTrace;
    renderTrace(trace);
    return;
  }

  // Try finding by task file
  const traces = await findTracesForTask(vaultPath, arg);
  if (traces.length === 0) {
    console.error(`No trace found for: ${arg}`);
    process.exit(1);
  }

  for (const trace of traces.slice(0, 5)) {
    renderTrace(trace);
  }
}

if (import.meta.main) main();
```

### 1.6 Register in package.json

**File:** `gzmo-daemon/package.json` — add script:

```json
"trace:view": "bun run src/trace_viewer.ts"
```

### 1.7 Acceptance Criteria (Phase 1)

- [ ] `bun run eval:quality` passes with 0 regressions
- [ ] Dropping a golden minimal task produces a JSON trace in `GZMO/Reasoning_Traces/`
- [ ] `bun run trace:view <trace_id>` renders a readable tree
- [ ] `--thinking` flag shows reasoning blocks
- [ ] Failed tasks also produce traces with `status: failed`
- [ ] Trace index (`index.jsonl`) is append-only and queryable
- [ ] No change to user-visible output format in completed tasks

### 1.8 Rollback Path

```bash
# Disable trace persistence
export GZMO_ENABLE_TRACES=0
```

Wrap all trace operations in:
```typescript
const tracesEnabled = String(process.env.GZMO_ENABLE_TRACES ?? "on").toLowerCase() !== "off";
if (tracesEnabled) { /* trace ops */ }
```

---

## Phase 2: Tool System (Days 4–7)

### Goal
Give the engine **read access** to the actual filesystem outside the embedding simulation.

### 2.1 Define Tool Interface

**New file:** `gzmo-daemon/src/tools/types.ts`

```typescript
/**
 * Tool System — structured external capability execution.
 *
 * Every tool is deterministic code (no LLM). Results feed into
 * the evidence packet as new snippets.
 *
 * Safety invariant: tool results are marked as DETERMINISTIC in
 * the evidence packet, making them safe for the safety verifier.
 */

export interface ToolResult {
  ok: boolean;
  output: string;           // human-readable result
  structured?: unknown;     // typed result if applicable
  error?: string;
  elapsed_ms: number;
}

export interface Tool {
  name: string;
  description: string;
  schema: JSONSchema;
  deterministic: boolean;   // always true in GZMO
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  vaultPath: string;
  taskFilePath: string;     // for path resolution
  // Future: abort signal, timeout, rate limiter
}

// Minimal JSON Schema subset for argument validation
export interface JSONSchema {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required: string[];
}

// Tool call record (for traces and LLM context)
export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResult;
  timestamp: string;
}
```

### 2.2 Implement Core Tools

**New file:** `gzmo-daemon/src/tools/vault_read.ts`

```typescript
/**
 * Tool: vault_read — read a file from the vault or project.
 */
import { resolve, relative } from "path";
import { existsSync } from "fs";
import type { Tool, ToolContext, ToolResult } from "./types";

export const vaultReadTool: Tool = {
  name: "vault_read",
  description: "Read the contents of a file in the vault.",
  deterministic: true,
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative path from vault root, e.g. wiki/overview.md" },
      max_chars: { type: "number", description: "Maximum characters to read (default: 8000)" },
    },
    required: ["path"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const t0 = Date.now();
    const relPath = String(args.path ?? "").replace(/^\//, "").replace(/\.\./g, "");
    if (!relPath) {
      return { ok: false, output: "", error: "Missing path argument", elapsed_ms: Date.now() - t0 };
    }

    const absPath = resolve(ctx.vaultPath, relPath);
    const vaultRoot = resolve(ctx.vaultPath);

    // Security: must be inside vault or project
    if (!absPath.startsWith(vaultRoot) && !absPath.startsWith(resolve(vaultRoot, ".."))) {
      return { ok: false, output: "", error: `Path escapes vault: ${relPath}`, elapsed_ms: Date.now() - t0 };
    }

    if (!existsSync(absPath)) {
      return { ok: false, output: "", error: `File not found: ${relPath}`, elapsed_ms: Date.now() - t0 };
    }

    try {
      const text = await Bun.file(absPath).text();
      const maxChars = Number(args.max_chars ?? 8000);
      const clipped = text.length > maxChars ? text.slice(0, maxChars) + "\n..." : text;
      return {
        ok: true,
        output: clipped,
        elapsed_ms: Date.now() - t0,
      };
    } catch (err: any) {
      return { ok: false, output: "", error: err?.message ?? "Read error", elapsed_ms: Date.now() - t0 };
    }
  },
};
```

**New file:** `gzmo-daemon/src/tools/fs_grep.ts`

```typescript
/**
 * Tool: fs_grep — search file contents via regex (deterministic).
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

export const fsGrepTool: Tool = {
  name: "fs_grep",
  description: "Search file contents for a regex pattern. Returns matching lines with file paths.",
  deterministic: true,
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Directory to search relative to vault root (default: '.')" },
      max_results: { type: "number", description: "Max matches to return (default: 20)" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const t0 = Date.now();
    const pattern = String(args.pattern ?? "");
    const searchDir = resolve(ctx.vaultPath, String(args.path ?? ".").replace(/^\//, ""));
    const maxResults = Math.min(Number(args.max_results ?? 20), 100);
    const vaultRoot = resolve(ctx.vaultPath);

    if (!searchDir.startsWith(vaultRoot)) {
      return { ok: false, output: "", error: "Search path escapes vault", elapsed_ms: Date.now() - t0 };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      return { ok: false, output: "", error: "Invalid regex pattern", elapsed_ms: Date.now() - t0 };
    }

    const matches: string[] = [];

    function walk(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (!e.name.startsWith(".") && !e.name.startsWith("node_modules")) walk(full);
        } else if (e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".ts") || e.name.endsWith(".json"))) {
          try {
            const text = readFileSync(full, "utf-8");
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i]!)) {
                const rel = relative(vaultRoot, full);
                matches.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 120)}`);
                if (matches.length >= maxResults) return;
              }
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    }

    try {
      walk(searchDir);
    } catch (err: any) {
      return { ok: false, output: "", error: err?.message ?? "Walk error", elapsed_ms: Date.now() - t0 };
    }

    return {
      ok: true,
      output: matches.length > 0 ? matches.join("\n") : "(no matches)",
      elapsed_ms: Date.now() - t0,
    };
  },
};
```

**New file:** `gzmo-daemon/src/tools/dir_list.ts`

```typescript
/**
 * Tool: dir_list — list files in a directory.
 */
import { readdirSync, statSync } from "fs";
import { resolve, relative, join } from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

export const dirListTool: Tool = {
  name: "dir_list",
  description: "List files and directories at a given path.",
  deterministic: true,
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative path from vault root" },
      recursive: { type: "boolean", description: "List recursively (default: false)" },
    },
    required: ["path"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const t0 = Date.now();
    const relPath = String(args.path ?? "").replace(/^\//, "");
    const dir = resolve(ctx.vaultPath, relPath);
    const vaultRoot = resolve(ctx.vaultPath);
    const recursive = Boolean(args.recursive);

    if (!dir.startsWith(vaultRoot)) {
      return { ok: false, output: "", error: "Path escapes vault", elapsed_ms: Date.now() - t0 };
    }

    const lines: string[] = [];
    function walk(d: string, prefix = "") {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const rel = relative(vaultRoot, join(d, e.name));
        const stat = statSync(join(d, e.name));
        const size = stat.isFile() ? `${(stat.size / 1024).toFixed(1)}KB` : "dir";
        lines.push(`${prefix}${e.name} (${size})`);
        if (recursive && e.isDirectory()) walk(join(d, e.name), prefix + "  ");
      }
    }

    try {
      walk(dir);
      return { ok: true, output: lines.join("\n") || "(empty directory)", elapsed_ms: Date.now() - t0 };
    } catch (err: any) {
      return { ok: false, output: "", error: err?.message ?? "List error", elapsed_ms: Date.now() - t0 };
    }
  },
};
```

### 2.3 Tool Dispatcher & Registry

**New file:** `gzmo-daemon/src/tools/registry.ts`

```typescript
import type { Tool, ToolContext, ToolResult, ToolCallRecord } from "./types";
import { vaultReadTool } from "./vault_read";
import { fsGrepTool } from "./fs_grep";
import { dirListTool } from "./dir_list";

export const TOOL_REGISTRY: Tool[] = [
  vaultReadTool,
  fsGrepTool,
  dirListTool,
];

export function getTool(name: string): Tool | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: ToolResult; record: ToolCallRecord }> {
  const tool = getTool(name);
  if (!tool) {
    const result: ToolResult = { ok: false, output: "", error: `Unknown tool: ${name}`, elapsed_ms: 0 };
    return { result, record: { tool: name, args, result, timestamp: new Date().toISOString() } };
  }

  const result = await tool.execute(args, ctx);
  const record: ToolCallRecord = { tool: name, args, result, timestamp: new Date().toISOString() };
  return { result, record };
}
```

### 2.4 Integrate Tools into Search Pipeline

**File:** `gzmo-daemon/src/pipelines/search_pipeline.ts`

Add an optional tool-usage pass before evidence compilation.

```typescript
// In SearchPipeline.prepare(), after retrieval:

const enableTools = readBoolEnv("GZMO_ENABLE_TOOLS", false);
let toolResults: ToolCallRecord[] = [];

if (enableTools && results.length === 0) {
  // Retrieval found nothing — try fs_grep for exact patterns
  const { dispatchTool } = await import("../tools/registry");
  const ctx: ToolContext = { vaultPath: vaultRoot, taskFilePath: filePath };

  // Extract potential file paths or keywords from the query
  const keywords = body.split(/\s+/).filter((w) => w.length > 4).slice(0, 3);
  for (const kw of keywords) {
    const { record } = await dispatchTool("fs_grep", { pattern: kw, max_results: 5 }, ctx);
    if (record.result.ok && record.result.output !== "(no matches)") {
      toolResults.push(record);
    }
  }
}

// Tool results become "local_facts" snippets in the evidence packet
const toolFacts = toolResults
  .map((r) => `[tool:${r.tool}]\n${r.result.output}`)
  .join("\n\n");

// Update evidence packet to include tool results
const evidencePacket = compileEvidencePacket({
  localFacts: [localFacts, vaultIndex, explicitFacts, toolFacts].filter(Boolean).join("\n"),
  results,
  maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 10, 1, 20),
  maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
});

// Store tool results in trace (Phase 1 trace already exists, just append nodes)
```

### 2.5 Update Safety Verifier for Tool Paths

**File:** `gzmo-daemon/src/verifier_safety.ts`

Tool results are deterministic — paths mentioned in tool outputs are safe. Extend the verifier to recognize tool-generated paths:

```typescript
// Add to verifySafety():
// Tool outputs are safe sources — paths found in tool results are pre-validated
const toolPaths = extractBacktickedPaths(
  params.packet.snippets
    .filter((s) => s.kind === "local_facts" && s.text.includes("[tool:"))
    .map((s) => s.text)
    .join("\n")
);
for (const p of toolPaths) {
  evidenced.add(normalize(p));
}
```

### 2.6 Acceptance Criteria (Phase 2)

- [ ] `vault_read` returns exact file contents for any vault-relative path
- [ ] `fs_grep` finds patterns in `.md`, `.ts`, `.json` files
- [ ] `dir_list` produces clean directory listings
- [ ] Tool calls appear as `tool_call` nodes in reasoning traces
- [ ] Tool results feed into evidence packets as `local_facts` snippets
- [ ] Safety verifier accepts paths found in tool outputs
- [ ] `bun run eval:quality` still passes
- [ ] Tool permissions are gated by env (default: off)

### 2.7 Rollback Path

```bash
export GZMO_ENABLE_TOOLS=0
```
When disabled, the search pipeline skips the tool pass entirely and behaves exactly like Phase 1.

---

## Phase 3: Tree-of-Thought Controller (Days 8–14)

### Goal
Enable **structured multi-step reasoning** with explicit branching, evaluation, and pruning.

### 3.1 Reasoning Controller Design

**New file:** `gzmo-daemon/src/reasoning/controller.ts`

```typescript
/**
 * Tree-of-Thought Controller
 *
 * A task enters as a tree. The controller expands nodes of type
 * "expandable" (analyze, retrieve, reason) into child nodes.
 * Non-expandable nodes (verify, answer, abstain) are terminal.
 *
 * Budget constraints:
 * - max_depth: controlled by chaos energy
 * - max_branches_per_node: controlled by valence
 * - max_total_nodes: hard cap (default 15) to prevent runaway tokens
 */

import type { ReasoningNode, ReasoningTrace } from "../reasoning_trace";
import type { ChaosSnapshot, Phase } from "../types";

export interface ToTConfig {
  maxDepth: number;
  maxBranchesPerNode: number;
  maxTotalNodes: number;
  evaluationThreshold: number; // 0..1, prune below this
  enableRetry: boolean;
}

export function budgetFromChaos(snap: ChaosSnapshot): ToTConfig {
  // High energy & Build phase → deeper exploration
  const baseDepth = Math.floor(snap.energy / 25); // 0–4
  const phaseBonus = snap.phase === Phase.Build ? 1 : snap.phase === Phase.Drop ? -1 : 0;
  const maxDepth = Math.max(1, Math.min(5, baseDepth + phaseBonus));

  // Valence drives branching: negative = skeptical (fewer branches), positive = exploratory
  const maxBranches = snap.llmValence < -0.3 ? 1 : snap.llmValence > 0.3 ? 3 : 2;

  return {
    maxDepth,
    maxBranchesPerNode: maxBranches,
    maxTotalNodes: 15,
    evaluationThreshold: 0.5,
    enableRetry: snap.energy > 40,
  };
}

export interface ToTNode extends ReasoningNode {
  children: ToTNode[];
  score?: number;       // shadow judge evaluation
  explored: boolean;    // has this node been expanded?
  pruned: boolean;      // cut from active tree
}

export class ToTController {
  private config: ToTConfig;
  private nodes: ToTNode[] = [];
  private traceId: string;

  constructor(config: ToTConfig, traceId: string) {
    this.config = config;
    this.traceId = traceId;
  }

  get root(): ToTNode | undefined {
    return this.nodes.find((n) => n.parent_id === null);
  }

  get activeNodes(): ToTNode[] {
    return this.nodes.filter((n) => !n.pruned);
  }

  get totalNodes(): number {
    return this.nodes.length;
  }

  canExpand(node: ToTNode): boolean {
    if (node.depth >= this.config.maxDepth) return false;
    if (this.totalNodes >= this.config.maxTotalNodes) return false;
    if (node.pruned) return false;
    const expandable: ReasoningNodeType[] = ["analyze", "retrieve", "reason"];
    return expandable.includes(node.type);
  }

  addChild(parent: ToTNode, node: Omit<ToTNode, "children" | "explored" | "pruned">): ToTNode {
    const child: ToTNode = {
      ...node,
      children: [],
      explored: false,
      pruned: false,
    };
    parent.children.push(child);
    this.nodes.push(child);
    return child;
  }

  prune(node: ToTNode): void {
    node.pruned = true;
    // Prune subtree
    for (const child of node.children) this.prune(child);
  }

  // Select the best path from root to a terminal node
  bestPath(): ToTNode[] {
    const terminals = this.activeNodes.filter((n) => !this.canExpand(n));
    if (terminals.length === 0) return [];

    // Score path = min node score along path (weakest link)
    const scorePath = (path: ToTNode[]): number => {
      const scores = path.map((n) => n.score ?? 0.5);
      return Math.min(...scores);
    };

    const paths = terminals.map((t) => this.pathTo(t));
    paths.sort((a, b) => scorePath(b) - scorePath(a)); // highest first
    return paths[0] ?? [];
  }

  private pathTo(node: ToTNode): ToTNode[] {
    const path: ToTNode[] = [];
    let current: ToTNode | undefined = node;
    while (current) {
      path.unshift(current);
      current = current.parent_id
        ? (this.nodes.find((n) => n.node_id === current!.parent_id) as ToTNode | undefined)
        : undefined;
    }
    return path;
  }
}
```

### 3.2 Node Expansion Logic

**New file:** `gzmo-daemon/src/reasoning/expand.ts`

```typescript
/**
 * Node expansion — turn an abstract reasoning node into concrete actions.
 */

import type { ToTNode, ToTController } from "./controller";
import type { InferenceResult } from "../engine";
import type { ToolCallRecord } from "../tools/types";

export interface ExpansionResult {
  children: Array<{
    type: ReasoningNodeType;
    prompt_summary: string;
    claims?: Array<{ text: string; confidence: number; sources: string[] }>;
  }>;
}

/**
 * Expand an "analyze" node: ask the model to decompose the task.
 */
export async function expandAnalyze(
  node: ToTNode,
  systemPrompt: string,
  userPrompt: string,
  inferDetailed: (s: string, p: string) => Promise<InferenceResult>,
): Promise<ExpansionResult> {
  const decompositionPrompt = [
    "Decompose the following task into 2–4 concrete sub-tasks.",
    "Each sub-task should be independently verifiable.",
    "Output as a numbered list. Be concise.",
    "",
    "Task:",
    userPrompt,
  ].join("\n");

  const result = await inferDetailed(systemPrompt, decompositionPrompt);
  const lines = result.answer.split("\n").filter((l) => /^\d+\)/.test(l.trim()));

  const children = lines.slice(0, 4).map((line, i) => ({
    type: "retrieve" as ReasoningNodeType,
    prompt_summary: `Sub-task ${i + 1}: ${line.trim().replace(/^\d+\)\s*/, "").slice(0, 80)}`,
  }));

  return { children };
}

/**
 * Expand a "retrieve" node: perform vault search or tool calls.
 */
export async function expandRetrieve(
  node: ToTNode,
  store: EmbeddingStore | undefined,
  ollamaUrl: string,
  userPrompt: string,
  toolEnabled: boolean,
  toolCtx: ToolContext,
): Promise<{ children: ExpansionResult["children"]; evidence: SearchResult[]; toolRecords: ToolCallRecord[] }> {
  // Use existing hybrid search
  const results = store
    ? await searchVaultHybrid(userPrompt, store, ollamaUrl, { topK: 6, mode: "fast" })
    : [];

  const toolRecords: ToolCallRecord[] = [];
  let toolOutput = "";

  if (toolEnabled && results.length === 0) {
    const { dispatchTool } = await import("../tools/registry");
    const keywords = userPrompt.split(/\s+/).filter((w) => w.length > 4).slice(0, 3);
    for (const kw of keywords) {
      const { record } = await dispatchTool("fs_grep", { pattern: kw, max_results: 5 }, toolCtx);
      toolRecords.push(record);
    }
  }

  const children: ExpansionResult["children"] = [
    {
      type: "reason",
      prompt_summary: `Reason over ${results.length + toolRecords.length} evidence sources`,
    },
  ];

  return { children, evidence: results, toolRecords };
}

/**
 * Expand a "reason" node: synthesize claims from evidence.
 */
export async function expandReason(
  node: ToTNode,
  systemPrompt: string,
  evidenceContext: string,
  userPrompt: string,
  inferDetailed: (s: string, p: string) => Promise<InferenceResult>,
): Promise<ExpansionResult> {
  const reasoningPrompt = [
    evidenceContext,
    "",
    "Based ONLY on the evidence above, derive concrete claims.",
    "Each claim should be a single sentence.",
    "Assign a confidence level: High, Medium, Low.",
    "If evidence is insufficient, say 'insufficient evidence'.",
    "",
    "Task:",
    userPrompt,
  ].join("\n");

  const result = await inferDetailed(systemPrompt, reasoningPrompt);

  // Parse claims (simple heuristic)
  const claimLines = result.answer.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 15 && (t.startsWith("-") || /^\d+\)/.test(t));
  });

  const children = claimLines.slice(0, 3).map((line) => {
    const text = line.replace(/^[-\d\)]\s*/, "").trim();
    const conf = /high/i.test(text) ? 0.9 : /medium/i.test(text) ? 0.6 : /low/i.test(text) ? 0.35 : 0.5;
    return {
      type: "verify" as ReasoningNodeType,
      prompt_summary: text.slice(0, 80),
      claims: [{ text, confidence: conf, sources: [] }],
    };
  });

  return { children };
}
```

### 3.3 Shadow Judge Integration (Per-Node Evaluation)

**New file:** `gzmo-daemon/src/reasoning/evaluate.ts`

```typescript
/**
 * Evaluate a reasoning node using the existing shadow judge.
 */

import { shadowJudge, type ShadowJudgeResult } from "../shadow_judge";
import type { ToTNode } from "./controller";

export async function evaluateNode(
  node: ToTNode,
  model: any, // ai-sdk model handle
  userPrompt: string,
  evidenceContext: string,
): Promise<number> {
  if (!node.claims || node.claims.length === 0) return 0.5;

  const answer = node.claims.map((c) => `- ${c.text} (confidence: ${c.confidence})`).join("\n");

  const judge = await shadowJudge({
    model,
    userPrompt,
    answer,
    evidenceContext,
    maxTokens: 200,
  });

  // Combine judge score with internal confidence
  const internalConfidence = node.claims.reduce((sum, c) => sum + c.confidence, 0) / node.claims.length;
  return Math.min(1, (judge.score + internalConfidence) / 2);
}
```

### 3.4 Integrate ToT into `processTask()`

**File:** `gzmo-daemon/src/engine.ts`

Replace or augment the existing single-call path with an optional ToT path:

```typescript
// After pipeline.prepare():

const useToT = readBoolEnv("GZMO_ENABLE_TOT", false);
let finalAnswer: string;

if (useToT && action === "search" && embeddingStore) {
  // Tree-of-Thought path
  const { budgetFromChaos, ToTController } = await import("./reasoning/controller");
  const { expandAnalyze, expandRetrieve, expandReason } = await import("./reasoning/expand");
  const { evaluateNode } = await import("./reasoning/evaluate");

  const budget = budgetFromChaos(snap ?? defaultSnapshot());
  const tot = new ToTController(budget, traceId);

  // Create root analyze node
  const root = tot.root!;
  root.explored = true;

  // Expand analyze → sub-tasks
  const analyzeResult = await expandAnalyze(root, ctx.systemPrompt, body, inferDetailed);
  for (const child of analyzeResult.children) {
    tot.addChild(root, {
      node_id: `n${nodes.length + tot.totalNodes}`,
      parent_id: root.node_id,
      type: child.type,
      depth: 1,
      prompt_summary: child.prompt_summary,
      outcome: "success",
      elapsed_ms: 0,
    });
  }

  // Expand each retrieve node
  for (const retrieveNode of tot.activeNodes.filter((n) => n.type === "retrieve")) {
    if (!tot.canExpand(retrieveNode)) continue;
    retrieveNode.explored = true;

    const { children, evidence, toolRecords } = await expandRetrieve(
      retrieveNode,
      embeddingStore,
      getOllamaUrl(),
      retrieveNode.prompt_summary,
      toolEnabled,
      { vaultPath: vaultRoot, taskFilePath: filePath },
    );

    // Convert evidence to packet and pass to reason node
    const packet = compileEvidencePacket({ localFacts: "", results: evidence, maxSnippets: 8, maxSnippetChars: 900 });
    const evidenceCtx = renderEvidencePacket(packet);

    for (const child of children) {
      const reasonNode = tot.addChild(retrieveNode, {
        node_id: `n${nodes.length + tot.totalNodes}`,
        parent_id: retrieveNode.node_id,
        type: child.type,
        depth: retrieveNode.depth + 1,
        prompt_summary: child.prompt_summary,
        evidence_cited: evidence.map((e, i) => `E${i + 1}`),
        outcome: "success",
        elapsed_ms: 0,
      });

      // Immediately expand reason → verify
      if (tot.canExpand(reasonNode)) {
        reasonNode.explored = true;
        const reasonResult = await expandReason(reasonNode, ctx.systemPrompt, evidenceCtx, retrieveNode.prompt_summary, inferDetailed);

        for (const verifyChild of reasonResult.children) {
          const verifyNode = tot.addChild(reasonNode, {
            node_id: `n${nodes.length + tot.totalNodes}`,
            parent_id: reasonNode.node_id,
            type: verifyChild.type,
            depth: reasonNode.depth + 1,
            prompt_summary: verifyChild.prompt_summary,
            claims: verifyChild.claims,
            outcome: "success",
            elapsed_ms: 0,
          });

          // Evaluate verify node
          verifyNode.score = await evaluateNode(verifyNode, ollama(OLLAMA_MODEL), body, evidenceCtx);

          // Prune low-score nodes
          if ((verifyNode.score ?? 0) < budget.evaluationThreshold) {
            tot.prune(verifyNode);
          }
        }
      }
    }
  }

  // Select best path and synthesize answer
  const bestPath = tot.bestPath();
  const bestClaims = bestPath.flatMap((n) => n.claims ?? []);

  if (bestClaims.length === 0) {
    finalAnswer = shapePreservingFailClosed({
      userPrompt: body,
      packet: undefined,
      lead: "insufficient evidence to produce a reasoned answer.",
      detailLines: ["Exploration produced no verifiable claims."],
    });
  } else {
    finalAnswer = bestClaims
      .map((c) => `- ${c.text} (confidence: ${c.confidence >= 0.7 ? "High" : c.confidence >= 0.4 ? "Medium" : "Low"})`)
      .join("\n");
  }

  // Merge ToT nodes into the trace
  // (Recursively flatten tot.nodes into trace nodes)
} else {
  // ── Existing single-shot path ──
  // ... keep current behavior exactly ...
}
```

### 3.5 Acceptance Criteria (Phase 3)

- [ ] Complex multi-part search tasks produce structured reasoning trees in traces
- [ ] Each reasoning node has a score from shadow judge evaluation
- [ ] Low-score branches are pruned before answer synthesis
- [ ] Chaos state controls reasoning depth (test: Drop phase → shallower trees)
- [ ] Single-shot path is unchanged when `GZMO_ENABLE_TOT=0`
- [ ] `bun run eval:quality` passes
- [ ] A task with no retrievable evidence correctly falls back to `insufficient evidence`

### 3.6 Rollback Path

```bash
export GZMO_ENABLE_TOT=0
```
When disabled, `processTask()` takes the existing single-shot path exclusively.

---

## Phase 4: Belief Tracking (Days 15–17)

### Goal
Replace binary pass/fail with **probabilistic claim confidence** and **conflict detection**.

### 4.1 Claim Store

**New file:** `gzmo-daemon/src/belief/claim_store.ts`

```typescript
/**
 * Claim Store — persistent belief tracking across tasks.
 *
 * Every claim produced by reasoning is stored with:
 * - Source trace and node
 * - Confidence (0..1)
 * - Contradictions (linked claim IDs)
 * - Retractions (if later disproven)
 */

import { join } from "path";
import { safeAppendJsonl } from "../vault_fs";

export interface ClaimRecord {
  claim_id: string;          // UUID
  trace_id: string;
  node_id: string;
  text: string;              // normalized claim text
  confidence: number;        // 0..1
  sources: string[];         // evidence IDs
  created_at: string;
  contradicted_by?: string[]; // claim_ids
  retracted?: boolean;
  retraction_reason?: string;
}

const CLAIMS_JSONL = "GZMO/Reasoning_Traces/claims.jsonl";

export async function recordClaim(
  vaultPath: string,
  claim: Omit<ClaimRecord, "claim_id" | "created_at">,
): Promise<ClaimRecord> {
  const full: ClaimRecord = {
    ...claim,
    claim_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  await safeAppendJsonl(vaultPath, CLAIMS_JSONL, full);
  return full;
}

/**
 * Detect contradiction between two claim texts.
 * Lightweight: keyword overlap + negation detection.
 */
export function detectContradiction(a: string, b: string): { contradiction: boolean; strength: number } {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const overlapRatio = overlap / Math.max(wordsA.size, wordsB.size);

  // Same topic + opposite polarity = contradiction
  const negA = /\b(not|never|no|none|cannot|doesn't|isn't)\b/i.test(a);
  const negB = /\b(not|never|no|none|cannot|doesn't|isn't)\b/i.test(b);
  const oppositePolarity = negA !== negB;

  if (overlapRatio > 0.3 && oppositePolarity) {
    return { contradiction: true, strength: overlapRatio };
  }
  return { contradiction: false, strength: 0 };
}
```

### 4.2 Integrate Claims into ToT

After a verify node is scored, record its claims:

```typescript
import { recordClaim, detectContradiction } from "../belief/claim_store";

// In expandReason or after evaluateNode:
for (const claim of verifyNode.claims ?? []) {
  const record = await recordClaim(vaultRoot, {
    trace_id: traceId,
    node_id: verifyNode.node_id,
    text: claim.text,
    confidence: claim.confidence,
    sources: claim.sources,
  });

  // Check for contradictions with recent claims
  // (In practice, load recent claims from index; simplified here)
}
```

### 4.3 Acceptance Criteria (Phase 4)

- [ ] Every reasoning claim is recorded in `claims.jsonl`
- [ ] Contradictory claims are flagged (test: two claims about same topic with opposite polarity)
- [ ] Retractions are supported and tracked

### 4.4 Rollback Path

```bash
export GZMO_ENABLE_BELIEFS=0
```

---

## Phase 5: Integration, Polish, and Ship (Days 18–19)

### 5.1 Unified Env Configuration

**New file (or add to existing .env handling):** document all new toggles.

```bash
# Reasoning Engine Configuration
gzmo-daemon/.env additions:

# Phase 1: Thinking Infrastructure
GZMO_ENABLE_TRACES=on           # default: on

# Phase 2: Tools
GZMO_ENABLE_TOOLS=off           # default: off (safe-by-default)
GZMO_MAX_TOOL_CALLS=3           # per task

# Phase 3: Tree-of-Thought
GZMO_ENABLE_TOT=off             # default: off
GZMO_TOT_MAX_NODES=15           # hard cap
GZMO_TOT_MIN_SCORE=0.5          # pruning threshold

# Phase 4: Beliefs
GZMO_ENABLE_BELIEFS=off         # default: off
```

### 5.2 Eval Harness Extension

**File:** `gzmo-daemon/src/eval_harness.ts`

Add ToT-specific scenarios:

```typescript
// Add to eval scenarios:
{
  name: "tot_multi_hop",
  query: "According to the chaos engine docs and the health system docs, how does energy depletion affect health reporting frequency?",
  expectAnyOfFiles: ["chaos.ts", "health.ts"], // or wherever these topics exist
  expectReasoningDepth: 2, // verify trace has at least 2 levels
},
```

### 5.3 Performance Regression Guard

```bash
# Before/after benchmark:
cd gzmo-daemon

# Baseline (single-shot):
GZMO_ENABLE_TOT=0 GZMO_ENABLE_TOOLS=0 time bun run eval:quality

# With ToT:
GZMO_ENABLE_TOT=1 GZMO_ENABLE_TOOLS=0 time bun run eval:quality

# Acceptable: <2× slowdown for ToT-enabled scenarios
# If >2×: optimize or reduce default max_nodes
```

### 5.4 Update README

Add a "Reasoning Engine" section under Advanced, documenting:
- What phases exist and how to enable them
- How to view traces
- Performance implications
- Safety model (tools are off by default)

---

## Testing Strategy

### Unit Tests (per phase)

**Phase 1:**
- Trace schema round-trip (create → persist → load)
- `inferDetailed()` parses thinking blocks correctly
- Trace Viewer renders tree without crashing

**Phase 2:**
- `vault_read` returns correct content
- `vault_read` rejects path escapes
- `fs_grep` handles invalid regex gracefully
- Tool dispatcher returns correct records

**Phase 3:**
- ToTController respects max_depth and max_nodes
- Pruning removes low-score subtrees
- Best-path selection picks highest-scoring terminal
- Budget from chaos produces reasonable depths

**Phase 4:**
- `detectContradiction` finds true contradictions
- `detectContradiction` allows compatible claims
- Claim store append works

### Integration Tests

1. **Golden task with traces enabled:** Verify trace JSON is written and valid.
2. **Search with tools enabled:** Verify tool results appear in evidence packet.
3. **Multi-part search with ToT:** Verify trace has >3 nodes, best path is selected.
4. **Eval harness with all toggles on:** Should still pass.

### Manual Verification Checklist

```text
□ Drop golden minimal task → status: completed, trace exists
□ Run trace viewer → readable tree rendered
□ Run trace viewer --thinking → thinking blocks visible
□ Submit action:search with no matching vault content → tools try fs_grep
□ Submit complex search → ToT produces multi-node trace
□ Set GZMO_PROFILE=minimal → reasoning features degrade gracefully
```

---

## Dependencies Between Phases

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
(Traces)   (Tools)    (ToT)      (Beliefs)
   │          │          │
   └──────────┴──────────┘
           ↓
     All depend on Phase 1
     (trace nodes store tool calls, ToT nodes, claims)
```

**Parallelization possible:** Phase 1 + Phase 2 can be developed simultaneously by two people. Phase 3 depends on both. Phase 4 depends on Phase 3.

---

## Risk Register

| Risk | Impact | Mitigation | Owner |
|------|--------|-----------|-------|
| Token costs explode with ToT | High | Hard cap 15 nodes, budget from chaos, env gate | Phase 3 |
| Tool use enables path traversal | Critical | Path normalization + `startsWith(vaultRoot)` check | Phase 2 |
| Thinking blocks contain prompt injection | Medium | Thinking is stored, never re-sent to LLM | Phase 1 |
| Eval harness regressions | High | Run before/after each phase; rollback env gates | All |
| Belief store grows unbounded | Medium | JSONL append; future: compaction job | Phase 4 |
| Performance degradation | Medium | Benchmark gate; accept <2× slowdown | Phase 5 |
| Code complexity increases | Medium | Modular files; env gates; rollback paths | All |

---

## Success Criteria (End of Phase 5)

GZMO can now answer this prompt truthfully and verifiably:

```yaml
---
status: pending
action: search
---
Find all references to "ollama" in the gzmo-daemon source code.
For each reference, determine if it's a configuration value (env var, .env file)
or a runtime usage (API call, model name).
List your findings with exact file paths in backticks and cite evidence.
```

**Old GZMO:** Would retrieve a few chunks, maybe mention `engine.ts`, probably miss some files. Answer would be a guess.

**New GZMO:**
1. Would use `fs_grep` tool to find all `.ts` files mentioning "ollama"
2. Would `vault_read` key files to classify references
3. Would build a reasoning tree: retrieve → reason per file → verify classification
4. Would produce a structured answer with exact paths, classified, cited
5. Would store the full reasoning trace for audit

That's the difference between a lookup tool and a reasoning assistant.

---

*Implementation plan complete. Ready to begin Phase 1.*
