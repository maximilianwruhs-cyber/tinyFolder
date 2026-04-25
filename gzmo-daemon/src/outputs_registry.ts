export type OutputKind =
  | "telemetry"
  | "health"
  | "state"
  | "embeddings"
  | "report"
  | "digest"
  | "log"
  | "index"
  | "artifact";

export type OutputOperation =
  | "writes"        // primary writer: file is produced here
  | "maintains"     // file is updated/kept correct (mechanical upkeep)
  | "derives"       // file is derived from other sources (rendered index, report)
  | "directory";    // directory root for produced artifacts

export type OutputWriteMode =
  | "atomic"
  | "append"
  | "overwrite"
  | "mixed"
  | "n/a";

export interface OutputSpec {
  path: string;              // vault-relative
  kind: OutputKind;
  purpose: string;           // 1 line
  writer: string;            // subsystem/module name
  operation: OutputOperation;
  writeMode: OutputWriteMode;
  cadence?: string;          // human-readable cadence (e.g. "60s", "on-demand")
  format?: "json" | "jsonl" | "md" | "dir";
}

/**
 * Canonical, code-defined registry of files the daemon writes/maintains.
 * This is the source of truth for ops “what does it write?” questions.
 */
export const OUTPUTS_REGISTRY: OutputSpec[] = [
  { path: "GZMO/TELEMETRY.json", kind: "telemetry", purpose: "Compact machine-readable ops telemetry snapshot.", writer: "health.ts", operation: "writes", writeMode: "atomic", cadence: "periodic", format: "json" },
  { path: "GZMO/health.md", kind: "health", purpose: "Human-readable subsystem health summary.", writer: "health.ts", operation: "writes", writeMode: "overwrite", cadence: "periodic", format: "md" },
  { path: "GZMO/CHAOS_STATE.json", kind: "state", purpose: "Pulse/chaos snapshot for scheduling + parameter modulation.", writer: "pulse.ts", operation: "writes", writeMode: "overwrite", cadence: "periodic", format: "json" },

  { path: "GZMO/embeddings.json", kind: "embeddings", purpose: "Local embedding store for vault semantic search.", writer: "embeddings.ts", operation: "maintains", writeMode: "atomic", cadence: "periodic/on-change", format: "json" },

  { path: "GZMO/perf.jsonl", kind: "log", purpose: "Per-task performance spans for latency auditing.", writer: "perf.ts", operation: "writes", writeMode: "append", cadence: "per task", format: "jsonl" },

  { path: "GZMO/anchor-index.json", kind: "index", purpose: "Anchor index artifact used for anchor priors + ops inspection.", writer: "anchor_index.ts", operation: "derives", writeMode: "overwrite", cadence: "daily", format: "json" },
  { path: "GZMO/anchor-report.md", kind: "report", purpose: "Human-readable anchor report artifact.", writer: "anchor_index.ts", operation: "derives", writeMode: "overwrite", cadence: "daily", format: "md" },

  { path: "GZMO/retrieval-metrics.json", kind: "report", purpose: "Eval harness retrieval metrics (JSON).", writer: "eval_harness.ts", operation: "derives", writeMode: "atomic", cadence: "12h", format: "json" },
  { path: "GZMO/rag-quality.md", kind: "report", purpose: "Eval harness quality gate report (Markdown).", writer: "eval_harness.ts", operation: "derives", writeMode: "overwrite", cadence: "12h", format: "md" },

  { path: "GZMO/wiki-lint-report.md", kind: "report", purpose: "Wiki lint findings report.", writer: "wiki_lint.ts", operation: "derives", writeMode: "overwrite", cadence: "weekly", format: "md" },
  { path: "GZMO/self-ask-quality.md", kind: "report", purpose: "Self-Ask quality report (recent lookback).", writer: "self_ask_report.ts", operation: "derives", writeMode: "overwrite", cadence: "12h", format: "md" },

  { path: "GZMO/doctor-report.md", kind: "report", purpose: "Doctor run summary report.", writer: "doctor.ts", operation: "derives", writeMode: "overwrite", cadence: "on-demand", format: "md" },
  { path: "GZMO/doctor-report.json", kind: "report", purpose: "Doctor run details (JSON).", writer: "doctor.ts", operation: "derives", writeMode: "atomic", cadence: "on-demand", format: "json" },

  { path: "GZMO/.gzmo_dreams_digested.json", kind: "digest", purpose: "Dream digest (which inbox tasks were distilled).", writer: "dreams.ts", operation: "maintains", writeMode: "atomic", cadence: "per dream", format: "json" },
  { path: "GZMO/.gzmo_wiki_digest.json", kind: "digest", purpose: "Wiki digest (which cabinet entries were consolidated).", writer: "wiki_engine.ts", operation: "maintains", writeMode: "atomic", cadence: "per wiki cycle", format: "json" },
  { path: "GZMO/.gzmo_ingest_digest.json", kind: "digest", purpose: "Ingest digest (which raw sources were summarized).", writer: "ingest_engine.ts", operation: "maintains", writeMode: "atomic", cadence: "per ingest cycle", format: "json" },
  { path: "GZMO/.gzmo_auto_tasks.json", kind: "digest", purpose: "Auto-task digest (stable ids + rate limiting).", writer: "auto_tasks.ts", operation: "maintains", writeMode: "atomic", cadence: "per auto-task", format: "json" },

  { path: "wiki/index.md", kind: "index", purpose: "Wiki index map (rebuilt mechanically).", writer: "wiki_index.ts", operation: "maintains", writeMode: "overwrite", cadence: "per wiki cycle", format: "md" },
  { path: "wiki/log.md", kind: "log", purpose: "Append-only wiki operations log.", writer: "wiki_log.ts", operation: "writes", writeMode: "append", cadence: "per wiki write", format: "md" },

  { path: "GZMO/OPS_OUTPUTS.json", kind: "index", purpose: "Generated JSON registry of daemon outputs (from code registry).", writer: "ops_outputs_artifact.ts", operation: "derives", writeMode: "atomic", cadence: "startup", format: "json" },
  { path: "wiki/entities/GZMO-Ops-Outputs.md", kind: "index", purpose: "Generated Markdown index of daemon outputs (from code registry).", writer: "ops_outputs_artifact.ts", operation: "derives", writeMode: "overwrite", cadence: "startup", format: "md" },

  { path: "GZMO/Thought_Cabinet", kind: "artifact", purpose: "Generated artifact root (dreams/self-ask/crystallizations).", writer: "multiple", operation: "directory", writeMode: "n/a", cadence: "continuous", format: "dir" },
  { path: "GZMO/Quarantine", kind: "artifact", purpose: "Quarantined drafts/artifacts that failed quality gates.", writer: "quarantine.ts", operation: "directory", writeMode: "n/a", cadence: "as-needed", format: "dir" },
];

