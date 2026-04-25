import { safeAppendJsonl } from "./vault_fs";

export const PERF_JSONL_PATH = "GZMO/perf.jsonl";

export interface PerfSpan {
  name: string;
  ms: number;
}

export interface TaskPerfEvent {
  type: "task_perf";
  created_at: string;
  fileName: string;
  action: string;
  ok: boolean;
  total_ms: number;
  spans: PerfSpan[];
}

export async function appendTaskPerf(vaultPath: string, ev: TaskPerfEvent): Promise<void> {
  await safeAppendJsonl(vaultPath, PERF_JSONL_PATH, ev);
}

