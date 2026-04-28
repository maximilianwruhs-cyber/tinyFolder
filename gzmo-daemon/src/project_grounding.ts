import { join } from "path";

export interface ProjectGrounding {
  text: string;
  allowedPaths: string[]; // absolute and/or vault-relative paths allowed to appear backticked
}

function contractFactPack(): string {
  return [
    "Canonical contracts (mechanisms):",
    "- Tasks are Markdown files under `GZMO/Inbox/` with YAML frontmatter keys `status` and `action`.",
    "- Task lifecycle is `pending -> processing -> completed|failed` and results are appended to the same inbox file.",
    "- `action: search` must ground claims in an Evidence Packet and cite snippets as `[E#]`.",
    "- Embeddings store lives at `GZMO/embeddings.json` and powers vault search (RAG).",
    "- Ingest pipeline: add a source under `raw/` -> daemon summarizes into `wiki/sources/` and updates `wiki/log.md` + `wiki/index.md`.",
    "- Operational snapshots are written under `GZMO/` (e.g. `GZMO/TELEMETRY.json`, `GZMO/health.md`).",
    "- Retrieval quality gate outputs: `GZMO/rag-quality.md` + `GZMO/retrieval-metrics.json`.",
    "",
  ].join("\n");
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
    contractFactPack(),
    vaultStateIndex?.trim() ? vaultStateIndex.trim() : "",
    "",
    localFacts?.trim() ? localFacts.trim() : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { text, allowedPaths: allowed };
}

