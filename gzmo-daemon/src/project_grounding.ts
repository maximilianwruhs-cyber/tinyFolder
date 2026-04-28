import { join } from "path";

export interface ProjectGrounding {
  text: string;
  allowedPaths: string[]; // absolute and/or vault-relative paths allowed to appear backticked
}

export function buildProjectGrounding(vaultPath: string, vaultStateIndex: string, localFacts: string): ProjectGrounding {
  const vp = String(vaultPath ?? "").trim();
  const knownRel = [
    "GZMO/Inbox",
    "GZMO/Subtasks",
    "GZMO/Thought_Cabinet",
    "GZMO/Quarantine",
    "GZMO/embeddings.json",
    "GZMO/TELEMETRY.json",
    "GZMO/health.md",
    "GZMO/rag-quality.md",
    "GZMO/retrieval-metrics.json",
    "wiki",
    "wiki/index.md",
    "wiki/log.md",
    "wiki/sources",
    "raw",
  ];

  const allowedAbs = knownRel.map((p) => join(vp, p).replace(/\\/g, "/"));
  const allowed = [...new Set([...knownRel, ...allowedAbs])];

  const text = [
    "Canonical contracts (paths):",
    ...knownRel.map((p) => `- \`${p}\``),
    "",
    vaultStateIndex?.trim() ? vaultStateIndex.trim() : "",
    "",
    localFacts?.trim() ? localFacts.trim() : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { text, allowedPaths: allowed };
}

