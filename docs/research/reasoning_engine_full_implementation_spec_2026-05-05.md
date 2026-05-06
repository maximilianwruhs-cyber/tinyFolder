# Reasoning Engine — Full Five-Phase Implementation Spec

**Status:** Ready for implementation  
**Date:** 2026-05-05  
**Estimated total effort:** 5 weeks (one developer, focused)  
**Prerequisites:** GZMO v0.3.0 with ToT controller already merged (verified present)

---

## How to Read This Document

Each phase has:
- **Goal** — the architectural gap being closed
- **Files changed / created** — exact paths
- **Data structures** — TypeScript interfaces
- **Step-by-step** — ordered implementation tasks
- **Integration** — where new code hooks into existing code
- **Acceptance criteria** — "done when..."
- **Rollback path** — env toggle or revert strategy
- **Risk register** — what could go wrong

**Every phase is gated by an environment variable and defaults to off.**

---

## Phase A: Close the Learning Loop (Week 1)

### Goal
Make fitness scores and reasoning traces **consumable** by future tasks. GZMO currently writes `perf.jsonl` and trace JSONs but never reads them. This phase adds a `StrategyLedger` that extracts winning strategies from historical data and injects them into the analyze prompt.

### A.1 Define Strategy Ledger Schema

**New file:** `gzmo-daemon/src/learning/ledger.ts`

```typescript
/**
 * Strategy Ledger — learn from past task performance.
 *
 * Core invariant: every completed task contributes a ledger entry.
 * Entries are queryable by task type + decomposition fingerprint.
 */

import { join } from "path";
import { readFile } from "fs/promises";
import { safeAppendJsonl, atomicWriteJson } from "../vault_fs";
import type { TaskPerfEvent } from "../perf";

export type TaskTypeFingerprint =
  | "path_query"       // asks for file paths
  | "synthesis"        // asks for summary/synthesis
  | "comparison"       // asks to compare two things
  | "how_to"           // asks how something works
  | "fact_check"       // asks whether a claim is true
  | "unknown";         // default, when no pattern matches

export interface StrategyEntry {
  entry_id: string;              // UUID
  task_type: TaskTypeFingerprint;
  task_file: string;
  decomposition_style: string;   // e.g. "broad_subtasks" | "narrow_scope"
  used_tools: boolean;           // did any tool run?
  used_tot: boolean;             // was ToT enabled?
  model: string;
  ok: boolean;
  z_score: number;               // fitness if computed, else 0
  citation_rate: number;         // from route_judge if available
  total_ms: number;
  timestamp: string;
  trace_id?: string;
}

export interface StrategyTip {
  kind: "positive" | "negative";
  style: string;
  reason: string;
  z_score: number;
  task_count: number;
}

const LEDGER_PATH = "GZMO/strategy_ledger.jsonl";

export function learningEnabled(): boolean {
  return String(process.env.GZMO_ENABLE_LEARNING ?? "off").toLowerCase() === "on";
}

export async function appendStrategyEntry(
  vaultPath: string,
  entry: Omit<StrategyEntry, "entry_id" | "timestamp">,
): Promise<void> {
  const full: StrategyEntry = {
    ...entry,
    entry_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  await safeAppendJsonl(vaultPath, LEDGER_PATH, full);
}

/**
 * Read recent ledger entries. Best-effort: tolerates missing / corrupt lines.
 */
export async function loadLedger(vaultPath: string, maxLines = 200): Promise<StrategyEntry[]> {
  const abs = join(vaultPath, LEDGER_PATH);
  const raw = await readFile(abs, "utf-8").catch(() => "");
  const entries: StrategyEntry[] = [];
  const lines = raw.split("\n").filter(Boolean).slice(-maxLines);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as StrategyEntry;
      if (obj.task_type && typeof obj.z_score === "number") entries.push(obj);
    } catch {
      continue;
    }
  }
  return entries;
}

/**
 * Classify a raw user prompt into a task type fingerprint.
 * Deterministic regex — no LLM call.
 */
export function classifyTaskType(body: string): TaskTypeFingerprint {
  const q = body.toLowerCase();
  if (/\b(?:path|where|location|written to|output to|file\b.*\blist)/.test(q)) return "path_query";
  if (/\b(?:compare|difference|versus|vs|contrast|same as|different from)/.test(q)) return "comparison";
  if (/\b(?:how does|how is|how do|explain|why does|why is|mechanism|works)/.test(q)) return "how_to";
  if (/\b(?:true|false|correct|accurate|verify|check|validate)/.test(q)) return "fact_check";
  if (/\b(?:summarize|overview|summary|synthesize|gist|main points)/.test(q)) return "synthesis";
  return "unknown";
}

/**
 * Extract decomposition style from a trace's analyze node.
 */
function extractDecompositionStyle(traceNodes: Array<{ type: string; prompt_summary: string }>): string {
  const analyze = traceNodes.find((n) => n.type === "analyze");
  if (!analyze) return "unknown";
  const s = analyze.prompt_summary.toLowerCase();
  if (/broad|general|overview/.test(s)) return "broad_scope";
  if (/narrow|specific|exact/.test(s)) return "narrow_scope";
  if (/vault_read|read file/.test(s)) return "direct_read";
  return "default";
}

/**
 * Build strategy tips for a given task type.
 * Returns top-2 positive tips and bottom-1 negative tip.
 */
export function buildStrategyTips(entries: StrategyEntry[], taskType: TaskTypeFingerprint): StrategyTip[] {
  const relevant = entries.filter((e) => e.task_type === taskType && Number.isFinite(e.z_score));
  if (relevant.length < 3) return [];

  // Group by style and compute aggregate z-score average
  const byStyle = new Map<string, { sum: number; count: number }>();
  for (const e of relevant) {
    const cur = byStyle.get(e.decomposition_style) ?? { sum: 0, count: 0 };
    cur.sum += e.z_score;
    cur.count++;
    byStyle.set(e.decomposition_style, cur);
  }

  const scored = [...byStyle.entries()]
    .map(([style, { sum, count }]) => ({
      style,
      avg: sum / count,
      task_count: count,
      kind: sum / count >= 0.7 ? ("positive" as const) : ("negative" as const),
      reason: `avg z=${(sum / count).toFixed(2)} across ${count} task(s)`,
    }))
    .sort((a, b) => b.avg - a.avg);

  const positive = scored.filter((s) => s.kind === "positive").slice(0, 2);
  const negative = scored.filter((s) => s.kind === "negative").slice(-1);

  return [...positive, ...negative].map((s) => ({
    kind: s.kind,
    style: s.style,
    reason: s.reason,
    z_score: s.avg,
    task_count: s.task_count,
  }));
}

/**
 * Format tips for injection into the analyze system prompt.
 */
export function formatStrategyContext(tips: StrategyTip[]): string {
  if (tips.length === 0) return "";
  const lines = ["## Strategy guidance (from past performance)", ""];
  for (const t of tips) {
    const label = t.kind === "positive" ? "✅ Effective" : "❌ Avoid";
    lines.push(`${label}: ${t.style} — ${t.reason}`);
  }
  lines.push("");
  return lines.join("\n");
}
```

### A.2 Build Ledger from Existing Data

**New file:** `gzmo-daemon/src/learning/build_ledger.ts`

```typescript
/**
 * Backfill ledger from existing perf.jsonl and reasoning traces.
 * Runs on daemon startup when ledger is empty or stale.
 */

import { join } from "path";
import { readFile, readdir } from "fs/promises";
import type { TaskPerfEvent } from "../perf";
import type { ReasoningTrace } from "../reasoning_trace";
import { appendStrategyEntry, classifyTaskType, extractDecompositionStyle } from "./ledger";
import { readBoolEnv } from "../pipelines/helpers";

export async function backfillLedgerFromPerf(
  vaultPath: string,
  force = false,
): Promise<number> {
  if (!force && !readBoolEnv("GZMO_LEARNING_BACKFILL", false)) return 0;

  const perfPath = join(vaultPath, "GZMO", "perf.jsonl");
  const raw = await readFile(perfPath, "utf-8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean);

  let added = 0;
  for (const line of lines.slice(-500)) {
    try {
      const perf = JSON.parse(line) as TaskPerfEvent;
      if (!perf.fileName || !perf.action) continue;

      // Try to find the corresponding trace to extract decomposition style
      const tracesDir = join(vaultPath, "GZMO", "Reasoning_Traces");
      const traceFiles = await readdir(tracesDir).catch(() => [] as string[]);
      let decomposition = "unknown";
      for (const tf of traceFiles) {
        if (!tf.endsWith(".json")) continue;
        try {
          const tr = JSON.parse(await readFile(join(tracesDir, tf), "utf-8")) as ReasoningTrace;
          if (tr.task_file.includes(perf.fileName) || perf.fileName.includes(tr.task_file)) {
            decomposition = extractDecompositionStyle(tr.nodes);
            break;
          }
        } catch {
          continue;
        }
      }

      await appendStrategyEntry(vaultPath, {
        task_type: classifyTaskType(perf.fileName),
        task_file: perf.fileName,
        decomposition_style: decomposition,
        used_tools: false, // not tracked in old perf events
        used_tot: false,
        model: "unknown",
        ok: perf.ok,
        z_score: perf.route_judge?.score ?? 0,
        citation_rate: perf.route_judge?.partValidCitationRate ?? 0,
        total_ms: perf.total_ms,
      });
      added++;
    } catch {
      continue;
    }
  }

  console.log(`[LEARNING] Backfilled ${added} ledger entries from perf history`);
  return added;
}
```

### A.3 Integrate Ledger into `processTask()`

**File:** `gzmo-daemon/src/engine.ts` — modify `processTask()`

After the `try` block opens, before `expandAnalyze` (in the ToT path), and also before `pipeline.prepare()` in the single-shot path:

```typescript
// --- Phase A: Strategy Ledger context injection ---
let strategyContext = "";
if (learningEnabled() && vaultRoot) {
  const { loadLedger, classifyTaskType, buildStrategyTips, formatStrategyContext } = await import("./learning/ledger");
  const ledger = await loadLedger(vaultRoot, 200);
  const taskType = classifyTaskType(body);
  const tips = buildStrategyTips(ledger, taskType);
  strategyContext = formatStrategyContext(tips);
}
```

Then in the ToT path, pass `strategyContext` to `runSearchTot`:

```typescript
const totOut = await span("reasoning.tot", async () =>
  runSearchTot({
    vaultRoot,
    filePath,
    body,
    systemPrompt: strategyContext ? ctx.systemPrompt + "\n\n" + strategyContext : ctx.systemPrompt,
    embeddingStore: embeddingStore!,
    snap,
    traceId,
  }),
);
```

For single-shot path, append strategyContext to system prompt:
```typescript
const systemPrompt = strategyContext
  ? ctx.systemPrompt + "\n\n" + strategyContext
  : ctx.systemPrompt;
```

### A.4 Write Ledger Entry on Completion

**File:** `gzmo-daemon/src/engine.ts` — in `processTask()`, after `markCompleted`

```typescript
// After markCompleted, append ledger entry
if (learningEnabled() && vaultRoot) {
  const { appendStrategyEntry, classifyTaskType } = await import("./learning/ledger");

  // Read decomposition style from trace (if trace was written)
  let decomposition = "default";
  const traceFile = traceNodes.find((n) => n.type === "analyze")?.prompt_summary ?? "";
  if (/vault_read/.test(traceFile)) decomposition = "direct_read";
  else if (/broad/.test(traceFile)) decomposition = "broad_scope";

  await appendStrategyEntry(vaultRoot, {
    task_type: classifyTaskType(body),
    task_file: taskRelPath,
    decomposition_style: decomposition,
    used_tools: String(process.env.GZMO_ENABLE_TOOLS ?? "off").toLowerCase() === "on",
    used_tot: useTot,
    model: OLLAMA_MODEL,
    ok: true,
    z_score: 0, // computed offline by ledger/analyze script
    citation_rate: 0, // computed from route judge if available
    total_ms: Date.now() - startTime,
    trace_id: traceId,
  }).catch(() => {});
}
```

### A.5 Ledger Analysis CLI

**New file:** `gzmo-daemon/src/learning/analyze.ts`

```typescript
/**
 * CLI: bun run src/learning/analyze.ts
 *
 * Reads perf.jsonl and strategy_ledger.jsonl, computes z-scores
 * for entries that don't have them, and produces a summary report.
 */

import { resolve, join } from "path";
import { readFile } from "fs/promises";
import type { StrategyEntry } from "./ledger";

interface LedgerReport {
  total: number;
  perTaskType: Record<string, { count: number; avgZ: number; bestStyle: string }>;
  tips: string[];
}

async function main() {
  const vault = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../../../vault");
  const ledgerPath = join(vault, "GZMO", "strategy_ledger.jsonl");
  const raw = await readFile(ledgerPath, "utf-8").catch(() => "");
  const entries: StrategyEntry[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    try { entries.push(JSON.parse(line) as StrategyEntry); } catch {}
  }

  const perType: LedgerReport["perTaskType"] = {};
  for (const e of entries) {
    const p = perType[e.task_type] ?? { count: 0, avgZ: 0, bestStyle: "" };
    p.count++;
    if (Number.isFinite(e.z_score) && e.z_score > 0) p.avgZ += e.z_score;
    perType[e.task_type] = p;
  }

  for (const [type, p] of Object.entries(perType)) {
    if (p.count > 0) p.avgZ = Math.round((p.avgZ / p.count) * 100) / 100;
    // Find best style for this type
    const byStyle = new Map<string, number>();
    for (const e of entries.filter((x) => x.task_type === type)) {
      const cur = byStyle.get(e.decomposition_style) ?? 0;
      byStyle.set(e.decomposition_style, cur + (e.ok ? 1 : -1));
    }
    const best = [...byStyle.entries()].sort((a, b) => b[1] - a[1])[0];
    p.bestStyle = best?.[0] ?? "unknown";
  }

  const report: LedgerReport = {
    total: entries.length,
    perTaskType: perType,
    tips: [],
  };

  // Generate human-readable tips
  for (const [type, p] of Object.entries(perType)) {
    if (p.count < 3) continue;
    report.tips.push(`${type}: best style = "${p.bestStyle}" (avg z=${p.avgZ}, n=${p.count})`);
  }

  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) main();
```

**Add to package.json:** `"ledger:analyze": "bun run src/learning/analyze.ts"`

### A.6 Acceptance Criteria

- [ ] `GZMO_ENABLE_LEARNING=on` enables ledger writing and context injection
- [ ] Completing a task appends an entry to `GZMO/strategy_ledger.jsonl`
- [ ] Entries include task_type, decomposition_style, model, ok, total_ms
- [ ] `bun run ledger:analyze` produces a JSON report with per-type statistics
- [ ] Strategy tips appear in analyze prompt after ≥3 entries of same task type
- [ ] When ledger is empty, behavior is identical to `learningEnabled() === false`
- [ ] `bun run eval:quality` passes with zero regressions

### A.7 Rollback

```bash
export GZMO_ENABLE_LEARNING=off    # default
export GZMO_LEARNING_BACKFILL=0    # skip backfill
```

When disabled, `processTask()` skips all ledger imports and behaves identically to pre-Phase-A.

---

## Phase B: Cross-Task Trace Memory (Week 2)

### Goal
Past reasoning traces become **retrievable knowledge**. Embed trace summaries into the embedding store and surface them when a new task is semantically similar.

### B.1 Trace Chunk Generator

**New file:** `gzmo-daemon/src/learning/trace_chunks.ts`

```typescript
/**
 * Convert reasoning traces into embeddable chunks.
 * Each trace produces 1–3 chunks: task summary, best claims, and discarded claims.
 */

import type { ReasoningTrace } from "../reasoning_trace";
import type { EmbeddingChunk } from "../embeddings";
import { createHash } from "crypto";

export interface TraceChunk {
  file: string;         // original trace file path (relative)
  heading: string;      // task_type + status, e.g. "path_query completed"
  text: string;
  hash: string;
  metadata: {
    pathBucket: "traces";
    type: "trace";
    role: "reasoning";
    tags: string[];
    task_type?: string;
    status?: string;
    model?: string;
    strategy?: string;
  };
}

export function traceToChunks(trace: ReasoningTrace): TraceChunk[] {
  const baseTags = ["trace", trace.action, trace.status];
  const taskType = trace.nodes[0]?.prompt_summary.slice(0, 60).replace(/\s+/g, "_") ?? "task";

  // Chunk 1: task-level summary
  const summaryChunk: TraceChunk = {
    file: trace.task_file,
    heading: `${taskType} — ${trace.status}`,
    text: [
      `Task: ${trace.nodes[0]?.prompt_summary ?? "unknown"}`,
      `Action: ${trace.action}`,
      `Model: ${trace.model}`,
      `Nodes: ${trace.nodes.length}`,
      `Outcome: ${trace.status}`,
      trace.final_answer.slice(0, 800),
    ].join("\n"),
    hash: "",
    metadata: {
      pathBucket: "traces",
      type: "trace",
      role: "reasoning",
      tags: [...baseTags, "summary"],
      task_type: taskType,
      status: trace.status,
      model: trace.model,
    },
  };

  // Chunk 2: best claims (from verify/answer nodes with scores >= threshold 0.5)
  const bestClaims = trace.nodes
    .filter((n) => (n.score ?? 0) >= 0.5 && n.claims && n.claims.length > 0)
    .flatMap((n) => n.claims!)
    .map((c) => c.text)
    .join("\n– ");

  if (bestClaims.length > 30) {
    const claimsChunk: TraceChunk = {
      file: trace.task_file,
      heading: `${taskType} — claims`,
      text: `Claims from successful reasoning:\n– ${bestClaims}`,
      hash: "",
      metadata: {
        pathBucket: "traces",
        type: "trace",
        role: "reasoning",
        tags: [...baseTags, "claims"],
        task_type: taskType,
        status: trace.status,
        model: trace.model,
      },
    };
    return [summaryChunk, claimsChunk].map(hashChunk);
  }

  return [hashChunk(summaryChunk)];
}

function hashChunk(c: TraceChunk): TraceChunk {
  const hash = createHash("sha256").update(c.text).digest("hex").slice(0, 16);
  return { ...c, hash };
}
```

### B.2 Trace Sync Service

**New file:** `gzmo-daemon/src/learning/sync_traces.ts`

```typescript
/**
 * Sync reasoning traces into the embedding store.
 * Called on daemon boot (if embeddings sync is enabled) and periodically.
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { EmbeddingStore, EmbeddingChunk } from "../embeddings";
import { traceToChunks } from "./trace_chunks";
import type { ReasoningTrace } from "../reasoning_trace";

export async function syncTracesIntoStore(
  vaultPath: string,
  store: EmbeddingStore,
  ollamaUrl: string,
): Promise<number> {
  const tracesDir = join(vaultPath, "GZMO", "Reasoning_Traces");
  const files = await readdir(tracesDir).catch(() => [] as string[]);

  let added = 0;
  const existingHashes = new Set(store.chunks.map((c) => c.hash));

  for (const f of files) {
    if (!f.endsWith(".json") || f === "index.jsonl") continue;
    try {
      const raw = await readFile(join(tracesDir, f), "utf-8");
      const trace = JSON.parse(raw) as ReasoningTrace;
      const chunks = traceToChunks(trace);
      for (const chunk of chunks) {
        if (existingHashes.has(chunk.hash)) continue;

        // Embed via Ollama
        const resp = await fetch(`${ollamaUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "nomic-embed-text", prompt: chunk.text.slice(0, 2000) }),
        });
        if (!resp.ok) continue;
        const data = await resp.json() as { embedding: number[] };

        // Compute magnitude
        let mag = 0;
        for (const v of data.embedding) mag += v * v;
        mag = Math.sqrt(mag);

        store.chunks.push({
          file: chunk.file,
          heading: chunk.heading,
          text: chunk.text,
          hash: chunk.hash,
          vector: data.embedding,
          magnitude: mag,
          updatedAt: new Date().toISOString(),
          metadata: chunk.metadata as any,
        });
        added++;
      }
    } catch {
      continue;
    }
  }

  if (added > 0) store.dirty = true;
  console.log(`[EMBEDDINGS] Synced ${added} trace chunks into store`);
  return added;
}
```

### B.3 Integrate Trace Retrieval into Analyze

**File:** `gzmo-daemon/src/reasoning/expand.ts` — modify `expandAnalyze()`

Before the decomposition prompt, inject past trace context:

```typescript
export async function expandAnalyze(
  _node: ToTNode,
  systemPrompt: string,
  userPrompt: string,
  inferDetailedFn: /* ... */,
  temp: number,
  maxTok: number,
  pastTraceContext?: string,   // ← NEW parameter
): Promise<ExpansionChild[]> {

  const contextBlock = pastTraceContext
    ? `\n\nPast similar tasks succeeded with this approach:\n${pastTraceContext}\n`
    : "";

  const decompositionPrompt = [
    "Decompose the following task into 2–4 concrete sub-tasks.",
    contextBlock,
    "Each sub-task should be independently verifiable.",
    "Output as a numbered list. Be concise.",
    "",
    "Task:",
    userPrompt,
  ].join("\n");

  // ... rest unchanged
}
```

**File:** `gzmo-daemon/src/reasoning/run_tot_search.ts` — retrieve past traces before analyze

```typescript
// After creating tot controller, before expandAnalyze:
let pastTraceContext = "";
if (String(process.env.GZMO_ENABLE_TRACE_MEMORY ?? "off").toLowerCase() === "on" && p.embeddingStore) {
  const traceResults = await searchVaultHybrid(
    p.body,
    p.embeddingStore,
    (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/v1$/, ""),
    { topK: 3, filters: { types: ["trace"] } },
  );

  const relevant = traceResults
    .filter((r) => r.metadata?.type === "trace" && r.metadata?.role === "reasoning")
    .slice(0, 2);

  if (relevant.length > 0) {
    pastTraceContext = relevant
      .map((r) => `- ${r.heading}: ${r.text.slice(0, 200)}`)
      .join("\n");
  }
}
```

### B.4 Acceptance Criteria

- [ ] `GZMO_ENABLE_TRACE_MEMORY=on` syncs trace chunks into `embeddings.json`
- [ ] Trace chunks are tagged with `metadata.type: "trace"` for filtering
- [ ] New tasks retrieve ≤2 past similar traces before decomposition
- [ ] Retrieved traces appear in `expandAnalyze` prompt context
- [ ] Sync is idempotent (re-running doesn't duplicate chunks)
- [ ] Trace memory has zero impact when disabled (no sync, no retrieval)

### B.5 Rollback

```bash
export GZMO_ENABLE_TRACE_MEMORY=off  # default
```

When disabled, `runSearchTot()` skips trace retrieval and passes `undefined` for `pastTraceContext`.

---

## Phase C: Critique + Replanning (Week 3)

### Goal
When `bestPath()` returns empty (all branches failed), generate a **critique** explaining why, then **replan** with adjusted strategy. This is the defining behavior of a system that reasons about its own reasoning.

### C.1 Critique Node Type

**File:** `gzmo-daemon/src/reasoning_trace.ts` — add to `ReasoningNodeType`

```typescript
export type ReasoningNodeType =
  | "task_start"
  | "analyze"
  | "retrieve" | "vault_read" | "dir_list"
  | "reason"
  | "verify"
  | "critique"        // ← NEW
  | "replan"          // ← NEW
  | "tool_call"
  | "answer"
  | "retry"
  | "abstain";
```

### C.2 Critique Generator

**New file:** `gzmo-daemon/src/reasoning/critique.ts`

```typescript
/**
 * Critique generation — when all branches fail, diagnose why.
 */

import type { ToTNode } from "./controller";
import type { InferenceResult } from "../inference";

export interface CritiqueResult {
  problems: string[];
  recommendation: string;
  shouldReplan: boolean;
}

export async function generateCritique(
  allNodes: ToTNode[],
  threshold: number,
  inferDetailedFn: (s: string, p: string, o?: any) => Promise<InferenceResult>,
  model: any,
  systemPrompt: string,
): Promise<CritiqueResult> {
  const verifyNodes = allNodes.filter((n) => n.type === "verify" && n.retryGeneration === 0);
  const scores = verifyNodes.map((n) => n.score ?? 0);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const allPruned = verifyNodes.every((n) => n.pruned || (n.score ?? 0) < threshold);

  // Build failure context
  const contextLines: string[] = [
    "All reasoning branches failed to pass the verification threshold.",
    `Branches attempted: ${verifyNodes.length}`,
    `Average score: ${avgScore.toFixed(2)} (threshold: ${threshold})`,
    "",
    "Per-branch summaries:",
  ];

  for (const n of verifyNodes) {
    const claims = n.claims?.map((c) => `- ${c.text}`).join("\n") ?? "(no claims)";
    contextLines.push(`Branch ${n.node_id}: score=${n.score?.toFixed(2) ?? "?"}\n${claims}`);
  }

  const critiquePrompt = [
    contextLines.join("\n"),
    "",
    "Critique this reasoning process. Identify up to 3 problems.",
    "Then recommend ONE specific change for the next attempt.",
    "",
    "Format:",
    "PROBLEM 1: <concise problem>",
    "PROBLEM 2: <concise problem> (optional)",
    "PROBLEM 3: <concise problem> (optional)",
    "RECOMMENDATION: <specific actionable change>",
    "SHOULD_REPLAN: yes | no",
  ].join("\n");

  const result = await inferDetailedFn(
    systemPrompt,
    critiquePrompt,
    { temperature: 0.2, maxTokens: 300 },
  );

  const text = result.answer;
  const problems = [...text.matchAll(/PROBLEM\s*\d*\s*:\s*(.+)/gi)].map((m) => m[1]!.trim());
  const recMatch = text.match(/RECOMMENDATION:\s*(.+)/i);
  const replanMatch = text.match(/SHOULD_REPLAN:\s*(yes|no)/i);

  return {
    problems: problems.slice(0, 3),
    recommendation: recMatch?.[1]?.trim() ?? "No recommendation. Return insufficient evidence.",
    shouldReplan: replanMatch?.[1]?.toLowerCase() === "yes",
  };
}
```

### C.3 Replan Controller Method

**File:** `gzmo-daemon/src/reasoning/controller.ts` — add method to `ToTController`

```typescript
/**
 * Reset the tree for replanning while preserving the root critique.
 * All non-root nodes are pruned. Root becomes a "replan" node.
 */
replan(rootCritiqueSummary: string): void {
  const root = this.root;
  if (!root) return;

  // Prune all children but keep root
  for (const child of root.children) this.prune(child);
  root.children = [];
  root.type = "replan";
  root.prompt_summary = `Replan: ${rootCritiqueSummary.slice(0, 100)}`;
  root.explored = false;
}
```

### C.4 Integration into `runSearchTot()`

**File:** `gzmo-daemon/src/reasoning/run_tot_search.ts`

After bestPath check, add critique + replan logic:

```typescript
const MAX_REPLANS = 1; // hard cap to prevent loops
let replanCount = 0;

// ... existing pipeline runs ...

let path = tot.bestPath();
let bestClaims = path.flatMap((n) => n.claims ?? []);

// --- CRITIQUE + REPLAN (Phase C) ---
if (
  bestClaims.length === 0 &&
  String(process.env.GZMO_ENABLE_CRITIQUE ?? "off").toLowerCase() === "on" &&
  replanCount < MAX_REPLANS
) {
  const { generateCritique } = await import("./critique");
  const critique = await generateCritique(
    tot.allNodes,
    budget.evaluationThreshold,
    inferDetailed,
    getChatModel(),
    p.systemPrompt,
  );

  // Add critique node to trace
  const critiqueNode = tot.addChild(tot.root!, {
    node_id: tot.nextNodeId(),
    trace_id: p.traceId,
    parent_id: tot.root!.node_id,
    type: "critique",
    depth: 1,
    prompt_summary: critique.recommendation.slice(0, 140),
    outcome: critique.shouldReplan ? "partial" : "abstain",
    elapsed_ms: 0,
    timestamp: new Date().toISOString(),
  });

  if (critique.shouldReplan && tot.totalNodes < budget.maxTotalNodes - 4) {
    tot.replan(critique.recommendation);
    replanCount++;

    // Re-analyze with critique context
    const analyzeSpecs2 = await expandAnalyze(
      tot.root!,
      p.systemPrompt,
      p.body + `\n\nCritique from first attempt: ${critique.recommendation}`,
      inferDetailed,
      temp,
      maxTok,
    );

    // Re-run the exact same pipeline (reuse processRetrievalBranch)
    const branchCap2 = Math.min(budget.maxBranchesPerNode, analyzeSpecs2.length);
    for (let i = 0; i < branchCap2; i++) {
      if (tot.totalNodes >= budget.maxTotalNodes) break;
      tot.addChild(tot.root!, {
        node_id: tot.nextNodeId(), 
        trace_id: p.traceId,
        parent_id: tot.root!.node_id,
        type: analyzeSpecs2[i]!.type,
        depth: 1,
        prompt_summary: analyzeSpecs2[i]!.prompt_summary,
        outcome: "success",
        elapsed_ms: 0,
        timestamp: new Date().toISOString(),
      });
    }
    tot.root!.explored = true;

    // Process new branches
    for (const retrieveNode of tot.activeNodes.filter((n) => isRetrievalNode(n) && !n.explored && !n.pruned)) {
      if (tot.totalNodes >= budget.maxTotalNodes) break;
      await processRetrievalBranch(retrieveNode);
    }

    // Re-evaluate best path
    path = tot.bestPath();
    bestClaims = path.flatMap((n) => n.claims ?? []);
  }
}
```

### C.5 Acceptance Criteria

- [ ] `GZMO_ENABLE_CRITIQUE=on` adds critique node when all branches fail
- [ ] Critique prompt produces PROBLEM + RECOMMENDATION + SHOULD_REPLAN
- [ ] When `shouldReplan: yes` and budget allows, tree resets and re-analyzes
- [ ] Replan is capped at 1 per task (no infinite loops)
- [ ] When `shouldReplan: no`, task fails closed with critique in trace
- [ ] All critique and replan nodes appear in persisted trace
- [ ] Zero behavior change when disabled

### C.6 Rollback

```bash
export GZMO_ENABLE_CRITIQUE=off  # default
```

When disabled, bestPath empty → immediate fail-closed (original behavior).

---

## Phase D: Intermediate Verification Gates (3–4 days)

### Goal
Catch problems at each pipeline stage, not just at the end. This saves tokens and produces better failure signals.

### D.1 Gate Definitions

**New file:** `gzmo-daemon/src/reasoning/gates.ts`

```typescript
/**
 * Intermediate verification gates — check quality at each pipeline stage.
 */

import type { SearchResult } from "../search";
import type { EvidencePacket } from "../evidence_packet";

export interface GateResult {
  passed: boolean;
  reason?: string;
  suggestion?: string;
}

/** Retrieve gate: fail early if evidence is insufficient. */
export function retrieveGate(
  evidence: SearchResult[],
  minScore: number = 0.15,
): GateResult {
  if (evidence.length === 0) {
    return {
      passed: false,
      reason: "No evidence retrieved.",
      suggestion: "Try tools (vault_read, fs_grep) or ask for insufficient evidence.",
    };
  }
  const topScore = evidence[0]?.score ?? 0;
  if (topScore < minScore) {
    return {
      passed: false,
      reason: `Best evidence score too low (${topScore.toFixed(2)} < ${minScore}).`,
      suggestion: "Query may be too specific or vault lacks content. Try broader terms.",
    };
  }
  return { passed: true };
}

/** Analyze gate: check that sub-tasks cover the original query. */
export function analyzeGate(
  subTaskSummaries: string[],
  originalQuery: string,
): GateResult {
  if (subTaskSummaries.length === 0) {
    return { passed: false, reason: "No sub-tasks generated.", suggestion: "Re-analyze with broader scope." };
  }
  // Simple coverage check: do keywords from query appear in any sub-task?
  const queryWords = new Set(
    originalQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4 && !["what", "does", "each", "where", "how"].includes(w)),
  );
  const subTaskText = subTaskSummaries.join(" ").toLowerCase();
  let covered = 0;
  for (const qw of queryWords) {
    if (subTaskText.includes(qw)) covered++;
  }
  const coverage = queryWords.size > 0 ? covered / queryWords.size : 1;
  if (coverage < 0.3) {
    return {
      passed: false,
      reason: `Sub-tasks only cover ${(coverage * 100).toFixed(0)}% of query keywords.`,
      suggestion: "Decomposition may be too narrow or off-topic. Re-analyze.",
    };
  }
  return { passed: true };
}

/** Reason gate: check claim-to-evidence grounding via simple overlap. */
export function reasonGate(
  claims: Array<{ text: string; sources?: string[] }>,
  packet: EvidencePacket,
): GateResult {
  const ungrounded = claims.filter((c) => {
    if (!c.sources || c.sources.length === 0) return true;
    // Check each claimed source actually exists in packet
    return c.sources.some((sid) => !packet.snippets.some((s) => s.id === sid));
  });
  if (ungrounded.length > 0) {
    return {
      passed: false,
      reason: `${ungrounded.length}/${claims.length} claims cite missing or invalid evidence.`,
      suggestion: "Claims must reference evidence IDs present in the Evidence Packet.",
    };
  }
  return { passed: true };
}
```

### D.2 Integrate Gates into Pipeline

**File:** `gzmo-daemon/src/reasoning/run_tot_search.ts`

Gate insertion points:

```typescript
// --- RETRIEVE GATE ---
const { retrieveGate } = await import("./gates");
const retrieveCheck = retrieveGate(evidence, 0.15);
if (!retrieveCheck.passed && String(process.env.GZMO_ENABLE_GATES ?? "off").toLowerCase() === "on") {
  // Mark reason node with gate failure, don't waste tokens on expandReason
  reasonNode.outcome = "failure";
  reasonNode.prompt_summary = `[GATE] ${retrieveCheck.reason}`;
  return; // skip reason + verify for this branch
}
```

```typescript
// --- ANALYZE GATE (after expandAnalyze) ---
const { analyzeGate } = await import("./gates");
const analyzeCheck = analyzeGate(
  analyzeSpecs.map((s) => s.prompt_summary),
  p.body,
);
if (!analyzeCheck.passed && gatesEnabled) {
  // Don't expand any branches — the decomposition itself is bad
  root.outcome = "failure";
  root.prompt_summary = `[GATE] ${analyzeCheck.reason}`;
  // Fall through to empty bestPath → critique or fail-closed
}
```

```typescript
// --- REASON GATE (after expandReason) ---
const { reasonGate } = await import("./gates");
const reasonCheck = reasonGate(verifySpecs.flatMap((v) => v.claims ?? []), packet);
if (!reasonCheck.passed && gatesEnabled) {
  // Lower scores for all verify nodes from this branch
  for (const vn of firstPass) {
    vn.score = Math.min(vn.score ?? 0.5, 0.3); // force below threshold
  }
}
```

### D.3 Acceptance Criteria

- [ ] `GZMO_ENABLE_GATES=on` enables all three gates
- [ ] Retrieve gate triggers when top evidence score < 0.15 → skips reason/verify
- [ ] Analyze gate triggers when sub-task coverage < 30% → blocks all branches
- [ ] Reason gate triggers when claims cite invalid evidence IDs → forces low scores
- [ ] Gates only run when explicitly enabled; default off preserves existing behavior
- [ ] Gate failures appear in traces with outcome="failure" and prompt_summary prefixed

### D.4 Rollback

```bash
export GZMO_ENABLE_GATES=off  # default
```

All gate checks short-circuit to `passed: true` when disabled (or more simply, the import and call sites are skipped).

---

## Phase E: Multi-Model Routing + Tool Chaining (Week 5)

### Goal
Use the right model for the right job, and let tools discover follow-up tools. This is the most hardware-dependent phase.

### E.1 Model Router

**New file:** `gzmo-daemon/src/inference_router.ts`

```typescript
/**
 * Model Router — dispatch inference to appropriate model by task role.
 *
 * Roles:
 *   fast   — decomposition, routing, simple synthesis (8B model)
 *   reason — claim derivation, verification, critique (32B+ or default)
 *   judge  — shadow judge, evaluation (default or dedicated judge model)
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { applyMindFilter } from "./mind_filter";
import type { InferenceResult, InferDetailedOptions } from "./inference";

export type ModelRole = "fast" | "reason" | "judge" | "default";

interface ModelConfig {
  tag: string;
  baseURL: string;
  temperature: number;
  maxTokens: number;
  description: string;
}

function getBaseUrl(): string {
  const raw = process.env.OLLAMA_URL ?? "http://localhost:11434/v1";
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function resolveModel(role: ModelRole): ModelConfig {
  const baseURL = getBaseUrl();
  const fastTag = process.env.GZMO_FAST_MODEL ?? "hermes3:8b";
  const deepTag = process.env.GZMO_REASON_MODEL ?? process.env.OLLAMA_MODEL ?? "hermes3:8b";
  const judgeTag = process.env.GZMO_JUDGE_MODEL ?? process.env.OLLAMA_MODEL ?? "hermes3:8b";

  switch (role) {
    case "fast":
      return { tag: fastTag, baseURL, temperature: 0.5, maxTokens: 300, description: "Fast routing model" };
    case "reason":
      return { tag: deepTag, baseURL, temperature: 0.6, maxTokens: 600, description: "Deep reasoning model" };
    case "judge":
      return { tag: judgeTag, baseURL, temperature: 0.1, maxTokens: 200, description: "Judge/evaluator model" };
    default:
      return { tag: process.env.OLLAMA_MODEL ?? "hermes3:8b", baseURL, temperature: 0.7, maxTokens: 400, description: "Default model" };
  }
}

export async function inferByRole(
  role: ModelRole,
  system: string,
  prompt: string,
  opts?: InferDetailedOptions,
): Promise<InferenceResult> {
  if (String(process.env.GZMO_ENABLE_MODEL_ROUTING ?? "off").toLowerCase() !== "on") {
    // Fallback to default inference when routing disabled
    const { inferDetailed } = await import("./inference");
    return inferDetailed(system, prompt, opts);
  }

  const config = resolveModel(role);
  const ollama = createOpenAICompatible({ name: "ollama", baseURL: config.baseURL });
  const model = ollama(config.tag);

  let inferPrompt = prompt;
  const mindEnabled = String(process.env.GZMO_MIND_FILTER ?? "on").toLowerCase() !== "off";
  if (mindEnabled) {
    const mind = applyMindFilter(prompt);
    if (mind.applied) inferPrompt = mind.filtered;
  }

  const t0 = Date.now();
  const result = streamText({
    model,
    system,
    prompt: inferPrompt,
    temperature: opts?.temperature ?? config.temperature,
    maxTokens: opts?.maxTokens ?? config.maxTokens,
  } as any);

  let raw = "";
  for await (const chunk of result.textStream) raw += chunk;
  raw = raw.trim();

  let thinking: string | undefined;
  const thinkMatch = raw.match(/\<think\>([\s\S]*?)<\/think>\n?/i);
  if (thinkMatch) thinking = thinkMatch[1]!.trim();

  const answer = raw.replace(/\<think\>[\s\S]*?<\/think>\n?/gi, "").trim();

  return {
    answer,
    thinking,
    raw,
    elapsed_ms: Date.now() - t0,
  };
}
```

### E.2 Role Assignment Table

**File:** `gzmo-daemon/src/reasoning/run_tot_search.ts` — replace `inferDetailed` calls

```typescript
// Role assignments:
// expandAnalyze  → "fast" (decomposition is cheap, should be fast)
// expandReason   → "reason" (claim derivation benefits from depth)
// evaluateNode   → "judge" (evaluation should be rigorous)
// generateCritique → "reason" (critique needs depth)

const inferFn = (role: import("../inference_router").ModelRole) =>
  (system: string, prompt: string, opts?: any) =>
    inferByRole(role, system, prompt, opts);

// In expandAnalyze call:
const analyzeSpecs = await expandAnalyze(root, systemPrompt, p.body, inferFn("fast"), temp, maxTok);

// In expandReason call:
const verifySpecs = await expandReason(reasonNode, systemPrompt, evidenceCtx, retrievePrompt, inferFn("reason"), temp, maxTok);

// In evaluateNode call (modify evaluate.ts):
// evaluateNode now accepts an inferByRole("judge") parameter
```

### E.3 Tool Chaining: Auto-Follow Discovery

**New file:** `gzmo-daemon/src/tools/chaining.ts`

```typescript
/**
 * Tool Chaining — discover follow-up tool calls from tool results.
 */

import type { ToolResult } from "./types";

export interface FollowUpTool {
  tool: string;
  args: Record<string, unknown>;
  confidence: number; // 0..1, how strongly the result suggests this follow-up
  reason: string;
}

/**
 * Scan a tool result for explicit references to other files/paths.
 * Returns suggested follow-up tool calls.
 */
export function discoverFollowUps(
  toolName: string,
  result: ToolResult,
): FollowUpTool[] {
  if (!result.ok) return [];
  const text = result.output;
  const followUps: FollowUpTool[] = [];

  if (toolName === "vault_read") {
    // "See details in telemetry.md §3" → vault_read("telemetry.md")
    const refs = text.matchAll(/(?:see|refer to|in|details in)\s+([\w\-./]+\.md)/gi);
    for (const m of refs) {
      followUps.push({
        tool: "vault_read",
        args: { path: m[1], max_chars: 8000 },
        confidence: 0.7,
        reason: `Referenced file in vault_read result: ${m[1]}`,
      });
    }
  }

  if (toolName === "fs_grep") {
    // grep results may show directory structures that suggest listing
    const dirs = new Set<string>();
    for (const line of text.split("\n")) {
      const dirMatch = line.match(/^([\w\-./]+\/)[^/]+:\d+:/);
      if (dirMatch) dirs.add(dirMatch[1]!);
    }
    for (const d of dirs) {
      followUps.push({
        tool: "dir_list",
        args: { path: d.replace(/\/$/, ""), recursive: false },
        confidence: 0.4,
        reason: `Directory context from grep result: ${d}`,
      });
    }
  }

  return followUps.filter((f) => f.confidence >= 0.4);
}
```

### E.4 Integrate Tool Chaining into Retrieval Branch

**File:** `gzmo-daemon/src/reasoning/run_tot_search.ts` — after `expandRetrievalBranch`

```typescript
// After expandRetrievalBranch returns toolRecords:

if (String(process.env.GZMO_ENABLE_TOOL_CHAINING ?? "off").toLowerCase() === "on") {
  const { discoverFollowUps } = await import("../tools/chaining");
  for (const record of toolRecords) {
    const followUps = discoverFollowUps(record.tool, record.result);
    for (const fu of followUps) {
      if (toolCallsThisTask >= maxToolCalls) break;
      const { dispatchTool } = await import("../tools/registry");
      const { result } = await dispatchTool(fu.tool, fu.args, toolCtx);
      toolRecords.push({ tool: fu.tool, args: fu.args, result, timestamp: new Date().toISOString() });
      toolCallsThisTask++;
    }
  }
}
```

### E.5 Acceptance Criteria

- [ ] `GZMO_ENABLE_MODEL_ROUTING=on` dispatches different LLM calls to different models
- [ ] `GZMO_FAST_MODEL` and `GZMO_REASON_MODEL` env vars configure the model tags
- [ ] When routing disabled, all calls fall through to existing `inferDetailed`
- [ ] `GZMO_ENABLE_TOOL_CHAINING=on` discovers follow-up tool calls from tool results
- [ ] Tool chaining respects `GZMO_MAX_TOOL_CALLS` (counts follow-ups toward cap)
- [ ] Tool chaining only triggers `vault_read` and `dir_list` follow-ups (whitelist)
- [ ] Trace includes which model role was used per node

### E.6 Rollback

```bash
export GZMO_ENABLE_MODEL_ROUTING=off   # default
export GZMO_ENABLE_TOOL_CHAINING=off   # default
export GZMO_FAST_MODEL="hermes3:8b"    # same as default when unset
export GZMO_REASON_MODEL=""            # empty = use OLLAMA_MODEL
```

When both disabled, `inferByRole()` delegates directly to `inferDetailed()` and tool results are not scanned for follow-ups.

---

## Cross-Phase Integration Checklist

### Order of Implementation

| Order | Phase | Why this order |
|---|---|---|
| 1 | A (Learning Loop) | Purely additive; reads existing data; no pipeline changes except prompt injection |
| 2 | B (Trace Memory) | Builds on Phase A data; adds to embedding store; retrieval is opt-in |
| 3 | D (Intermediate Gates) | Catches errors early; saves tokens; makes Phase C more reliable |
| 4 | C (Critique + Replan) | Structural change to ToT loop; benefits from gates to avoid unnecessary replans |
| 5 | E (Multi-Model + Chaining) | Hardware-dependent; should be last because not all users can run multiple models |

### Global Env Configuration

All new toggles:

```bash
# Phase A
GZMO_ENABLE_LEARNING=off           # default
GZMO_LEARNING_BACKFILL=0           # default

# Phase B
GZMO_ENABLE_TRACE_MEMORY=off       # default

# Phase C
GZMO_ENABLE_CRITIQUE=off           # default

# Phase D
GZMO_ENABLE_GATES=off              # default

# Phase E
GZMO_ENABLE_MODEL_ROUTING=off      # default
GZMO_FAST_MODEL=hermes3:8b         # fallback to OLLAMA_MODEL if unset
GZMO_REASON_MODEL=                 # fallback to OLLAMA_MODEL if empty
GZMO_JUDGE_MODEL=                  # fallback to OLLAMA_MODEL if empty
GZMO_ENABLE_TOOL_CHAINING=off      # default
```

### New Package.json Scripts

```json
{
  "ledger:analyze": "bun run src/learning/analyze.ts",
  "trace:sync": "bun run src/learning/sync_traces.ts"
}
```

### Testing Strategy Per Phase

| Phase | Test File | Key Scenarios |
|---|---|---|
| A | `__tests__/learning_ledger.test.ts` | classifyTaskType, buildStrategyTips, formatStrategyContext, tip injection into prompt |
| B | `__tests__/trace_chunks.test.ts` | traceToChunks dedup, syncTracesIntoStore idempotency, filter by metadata.type |
| C | `__tests__/critique.test.ts` | generateCritique parsing, replan cap, empty bestPath triggers critique |
| D | `__tests__/gates.test.ts` | retrieveGate thresholds, analyzeGate coverage, reasonGate ungrounded claims |
| E | `__tests__/inference_router.test.ts` | resolveModel by role, inferByRole fallback when disabled |

### Performance Budgets

| Phase | Expected Overhead | Budget |
|---|---|---|
| A | Ledger read (I/O, no LLM) | <5ms per task |
| B | Trace retrieval (embedding search) | <50ms per task |
| C | Critique + potential replan | +1 LLM call, capped |
| D | Deterministic gates (regex + math) | <1ms per gate |
| E | Model choice (fast model is faster) | Net neutral or faster for decomposition |

---

## Final Architecture After All Phases

```
[ Task Inbox ]
     ↓
[ Strategy Ledger ] ← reads past performance ← Phase A
     ↓
[ Memory Injection ] ← reads similar past traces ← Phase B
     ↓
[ expandAnalyze ] ← fast model if routed ← Phase E
     ↓
[ Analyze Gate ] ← coverage check ← Phase D
     ↓
[ expandRetrievalBranch ] ← tool chaining ← Phase E
     ↓
[ Retrieve Gate ] ← score threshold ← Phase D
     ↓
[ expandReason ] ← deep model if routed ← Phase E
     ↓
[ Reason Gate ] ← evidence grounding ← Phase D
     ↓
[ evaluateNode ] ← judge model if routed ← Phase E
     ↓
[ bestPath ]
     ↓
[ Empty? ] → [ Critique ] → [ Replan? ] → loop back ← Phase C
     ↓
[ synthesizeToTAnswer ]
     ↓
[ Write Ledger Entry + Persist Trace ] ← Phase A
```

---

## Success Criteria (All Phases Complete)

A reasoning engine must be able to answer this prompt and **learn from failure**:

```yaml
---
status: pending
action: search
---
What file paths does the daemon write under GZMO/ that are NOT in the ops outputs registry?
```

**First attempt (no learning):**
- Retrieves `outputs_registry.ts` → good
- Searches for "GZMO/" paths → misses some
- Claims: "All paths are in the registry" (false)
- Score: 0.3 → pruned
- No branches pass → fail-closed

**With Phase A enabled (after 3 similar tasks):**
- Ledger tip: `"For path queries, vault_read-first strategy works best (z=0.94)"`
- Analyze decomposes: `vault_read("outputs_registry.ts")` then `fs_grep("GZMO/")`
- Finds `GZMO/perf.jsonl` not in registry
- Correct answer: "perf.jsonl is not in the registry"

**With Phase C enabled (if first attempt fails):**
- Critique: "Sub-tasks relied on hybrid search instead of direct file reading for path queries"
- Replan: retry with `vault_read` + `fs_grep` approach
- Second attempt succeeds

That is the difference between a pipeline and a reasoning engine.

---

*Spec complete. Start with Phase A (lowest risk, highest impact).*