/**
 * Reasoning Trace — structured internal reasoning for tasks.
 */

import { join } from "path";
import { readdir } from "fs/promises";
import { atomicWriteJson, safeAppendJsonl } from "./vault_fs";

export type ReasoningNodeType =
  | "task_start"
  | "analyze"
  | "retrieve"
  | "vault_read"
  | "dir_list"
  | "reason"
  | "verify"
  | "critique"
  | "replan"
  | "tool_call"
  | "answer"
  | "retry"
  | "abstain";

export interface ReasoningNode {
  node_id: string;
  trace_id: string;
  parent_id: string | null;
  type: ReasoningNodeType;
  depth: number;
  prompt_summary: string;
  raw_thinking?: string;
  evidence_cited?: string[];
  tools_used?: string[];
  claims?: Array<{
    text: string;
    confidence: number;
    sources: string[];
  }>;
  outcome: "success" | "failure" | "abstain" | "partial";
  model?: string;
  tokens_used?: number;
  elapsed_ms: number;
  timestamp: string;
  /** Shadow-judge or hybrid score (0..1), optional */
  score?: number;
  /** ToT verify retry pass (optional) */
  retryGeneration?: number;
}

export interface ReasoningTrace {
  trace_id: string;
  task_file: string;
  action: "think" | "search" | "chain";
  model: string;
  total_tokens?: number;
  total_elapsed_ms: number;
  nodes: ReasoningNode[];
  final_answer: string;
  status: "completed" | "failed";
}

export function tracesEnabled(): boolean {
  return String(process.env.GZMO_ENABLE_TRACES ?? "on").toLowerCase() !== "off";
}

const TRACES_SUBDIR = "GZMO/Reasoning_Traces";

export async function persistTrace(vaultPath: string, trace: ReasoningTrace): Promise<string> {
  const filename = `${trace.trace_id}.json`;
  const filepath = join(TRACES_SUBDIR, filename);
  await atomicWriteJson(vaultPath, filepath, trace);
  return filepath;
}

export async function appendTraceIndex(vaultPath: string, trace: ReasoningTrace): Promise<void> {
  const indexPath = join(TRACES_SUBDIR, "index.jsonl");
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

export async function findTracesForTask(vaultPath: string, taskFile: string): Promise<ReasoningTrace[]> {
  const dir = join(vaultPath, TRACES_SUBDIR);
  const files = await readdir(dir).catch(() => [] as string[]);
  const traces: ReasoningTrace[] = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f === "index.jsonl") continue;
    try {
      const raw = await Bun.file(join(dir, f)).text();
      const t = JSON.parse(raw) as ReasoningTrace;
      if (t.task_file === taskFile) traces.push(t);
    } catch {
      continue;
    }
  }
  traces.sort(
    (a, b) =>
      new Date(b.nodes[0]?.timestamp ?? 0).getTime() - new Date(a.nodes[0]?.timestamp ?? 0).getTime(),
  );
  return traces;
}
