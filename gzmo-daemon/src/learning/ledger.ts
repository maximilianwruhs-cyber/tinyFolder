/**
 * Strategy Ledger — learn from past task performance.
 *
 * Core invariant: every completed task can contribute a ledger entry.
 * Entries are queryable by task type + decomposition fingerprint.
 */

import { join } from "path";
import { readFile } from "fs/promises";
import { safeAppendJsonl } from "../vault_fs";
import { readBoolEnv } from "../pipelines/helpers";

export type TaskTypeFingerprint =
  | "path_query"
  | "synthesis"
  | "comparison"
  | "how_to"
  | "fact_check"
  | "unknown";

export interface StrategyEntry {
  entry_id: string;
  task_type: TaskTypeFingerprint;
  task_file: string;
  decomposition_style: string;
  used_tools: boolean;
  used_tot: boolean;
  model: string;
  ok: boolean;
  z_score: number;
  citation_rate: number;
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
  return readBoolEnv("GZMO_ENABLE_LEARNING", false);
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

export function classifyTaskType(body: string): TaskTypeFingerprint {
  const q = body.toLowerCase();
  if (/\b(?:path|where|location|written to|output to|file\b.*\blist)/.test(q)) return "path_query";
  if (/\b(?:compare|difference|versus|vs|contrast|same as|different from)/.test(q)) return "comparison";
  if (/\b(?:how does|how is|how do|explain|why does|why is|mechanism|works)/.test(q)) return "how_to";
  if (/\b(?:true|false|correct|accurate|verify|check|validate)/.test(q)) return "fact_check";
  if (/\b(?:summarize|overview|summary|synthesize|gist|main points)/.test(q)) return "synthesis";
  return "unknown";
}

/** Extract decomposition style from a trace's analyze node (or first analyze-like summary). */
export function extractDecompositionStyle(
  traceNodes: Array<{ type: string; prompt_summary: string }>,
): string {
  const analyze =
    traceNodes.find((n) => n.type === "analyze" && /sub-task/i.test(n.prompt_summary)) ??
    traceNodes.find((n) => n.type === "analyze" && n.prompt_summary && !/pipeline /i.test(n.prompt_summary)) ??
    traceNodes.find((n) => n.type === "analyze");
  if (!analyze) return "unknown";
  const s = analyze.prompt_summary.toLowerCase();
  if (/broad|general|overview/.test(s)) return "broad_scope";
  if (/narrow|specific|exact/.test(s)) return "narrow_scope";
  if (/vault_read|read file/.test(s)) return "direct_read";
  return "default";
}

export function buildStrategyTips(entries: StrategyEntry[], taskType: TaskTypeFingerprint): StrategyTip[] {
  const relevant = entries.filter((e) => e.task_type === taskType && Number.isFinite(e.z_score));
  if (relevant.length < 3) return [];

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

export function formatStrategyContext(tips: StrategyTip[]): string {
  if (tips.length === 0) return "";
  const lines = ["## Strategy guidance (from past performance)", ""];
  for (const t of tips) {
    const label = t.kind === "positive" ? "Effective" : "Avoid";
    lines.push(`${label}: ${t.style} — ${t.reason}`);
  }
  lines.push("");
  return lines.join("\n");
}
