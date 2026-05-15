/**
 * Machine-readable provenance appendix for autonomy-generated markdown.
 */

export interface ProvenanceParams {
  subsystem: "self_ask" | "dream" | "crystallization";
  strategy?: string;
  model?: string;
  /** Retrieval query fingerprint (e.g. first 160 chars normalized). */
  retrieval_query_id?: string;
  evidence_files?: string[];
}

function yamlEscape(s: string): string {
  const t = s.replace(/\r/g, "").trim();
  if (!t.includes("\n") && !/[:#[\]{}",]/.test(t) && !/^\s/.test(t)) return t;
  return JSON.stringify(t);
}

/** HTML-comment YAML block parsers can strip; renders at end of body. */
export function formatProvenanceYamlComment(params: ProvenanceParams): string {
  const lines = [
    "subsystem: " + yamlEscape(params.subsystem),
    `generated_at: ${yamlEscape(new Date().toISOString())}`,
    `ollama_model: ${yamlEscape(params.model ?? process.env.OLLAMA_MODEL ?? "unknown")}`,
  ];
  if (params.strategy) lines.push(`strategy: ${yamlEscape(params.strategy)}`);
  if (params.retrieval_query_id) lines.push(`retrieval_query_id: ${yamlEscape(params.retrieval_query_id)}`);
  if (params.evidence_files?.length) {
    lines.push("evidence_files:");
    for (const f of params.evidence_files.slice(0, 24)) lines.push(`  - ${yamlEscape(f.replace(/\\/g, "/"))}`);
  }
  return ["", "<!-- gzmo-provenance:yaml", lines.join("\n"), "-->", ""].join("\n");
}
