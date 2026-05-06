/**
 * Backfill ledger from existing perf.jsonl and reasoning traces.
 */

import { join } from "path";
import { readFile, readdir } from "fs/promises";
import type { TaskPerfEvent } from "../perf";
import type { ReasoningTrace } from "../reasoning_trace";
import { appendStrategyEntry, classifyTaskType, extractDecompositionStyle } from "./ledger";
import { readBoolEnv } from "../pipelines/helpers";

function taskBodyHintFromTrace(tr: ReasoningTrace): string {
  const start = tr.nodes.find((n) => n.type === "task_start");
  if (start?.prompt_summary) return start.prompt_summary;
  return tr.task_file;
}

export async function backfillLedgerFromPerf(vaultPath: string, force = false): Promise<number> {
  if (!force && !readBoolEnv("GZMO_LEARNING_BACKFILL", false)) return 0;

  const perfPath = join(vaultPath, "GZMO", "perf.jsonl");
  const raw = await readFile(perfPath, "utf-8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean);

  let added = 0;
  for (const line of lines.slice(-500)) {
    try {
      const perf = JSON.parse(line) as TaskPerfEvent;
      if (!perf.fileName || !perf.action) continue;

      const tracesDir = join(vaultPath, "GZMO", "Reasoning_Traces");
      const traceFiles = await readdir(tracesDir).catch(() => [] as string[]);
      let decomposition = "unknown";
      let classifySource = perf.fileName;
      for (const tf of traceFiles) {
        if (!tf.endsWith(".json") || tf === "index.jsonl") continue;
        try {
          const tr = JSON.parse(await readFile(join(tracesDir, tf), "utf-8")) as ReasoningTrace;
          if (tr.task_file.includes(perf.fileName) || perf.fileName.includes(tr.task_file)) {
            decomposition = extractDecompositionStyle(tr.nodes);
            classifySource = taskBodyHintFromTrace(tr);
            break;
          }
        } catch {
          continue;
        }
      }

      await appendStrategyEntry(vaultPath, {
        task_type: classifyTaskType(classifySource),
        task_file: perf.fileName,
        decomposition_style: decomposition,
        used_tools: false,
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
