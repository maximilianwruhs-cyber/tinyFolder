/**
 * Convert reasoning traces into embeddable chunks.
 */

import type { ReasoningTrace } from "../reasoning_trace";
import { createHash } from "crypto";
import { classifyTaskType } from "./ledger";

export interface TraceChunk {
  file: string;
  heading: string;
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

function hashChunk(c: TraceChunk): TraceChunk {
  const hash = createHash("sha256").update(c.text).digest("hex").slice(0, 16);
  return { ...c, hash };
}

export function traceToChunks(trace: ReasoningTrace): TraceChunk[] {
  const baseTags = ["trace", trace.action, trace.status];
  const startSummary = trace.nodes.find((n) => n.type === "task_start")?.prompt_summary ?? "";
  const taskTypeKey = classifyTaskType(startSummary || trace.task_file);

  const summaryChunk: TraceChunk = {
    file: trace.task_file,
    heading: `${taskTypeKey} — ${trace.status}`,
    text: [
      `Task: ${startSummary || trace.task_file}`,
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
      task_type: taskTypeKey,
      status: trace.status,
      model: trace.model,
    },
  };

  const bestClaims = trace.nodes
    .filter((n) => (n.score ?? 0) >= 0.5 && n.claims && n.claims.length > 0)
    .flatMap((n) => n.claims!)
    .map((c) => c.text)
    .join("\n– ");

  if (bestClaims.length > 30) {
    const claimsChunk: TraceChunk = {
      file: trace.task_file,
      heading: `${taskTypeKey} — claims`,
      text: `Claims from successful reasoning:\n– ${bestClaims}`,
      hash: "",
      metadata: {
        pathBucket: "traces",
        type: "trace",
        role: "reasoning",
        tags: [...baseTags, "claims"],
        task_type: taskTypeKey,
        status: trace.status,
        model: trace.model,
      },
    };
    return [summaryChunk, claimsChunk].map(hashChunk);
  }

  return [hashChunk(summaryChunk)];
}
