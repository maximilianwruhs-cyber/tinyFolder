import type { SearchResult } from "./search";
import { inferByRole } from "./inference_router";
import { readBoolEnv } from "./pipelines/helpers";

function clamp(s: string, n: number): string {
  const t = String(s ?? "").trim();
  return t.length <= n ? t : t.slice(0, n).trimEnd() + "\n…";
}

/**
 * Budgeted local reranker via the model router.
 * When GZMO_ENABLE_MODEL_ROUTING=on this uses the "rerank" role
 * (e.g. a dedicated lightweight reranker or falls back to OLLAMA_MODEL).
 *
 * Enable explicitly with `GZMO_RERANK_LLM=on`.
 */
export async function rerankWithLLM(params: {
  query: string;
  candidates: SearchResult[];
  maxCandidates?: number;
}): Promise<SearchResult[]> {
  if (!readBoolEnv("GZMO_RERANK_LLM", false)) return params.candidates;
  const maxCandidates = params.maxCandidates ?? 12;

  const list = params.candidates.slice(0, maxCandidates);
  if (list.length <= 2) return params.candidates;

  const items = list.map((c, i) => ({
    id: `R${i + 1}`,
    file: c.file,
    heading: c.heading,
    text: clamp(c.text, 420),
  }));

  const system = [
    "You are a strict retrieval reranker.",
    "Decide which snippets are relevant evidence for answering the QUERY.",
    "Rules:",
    "- Only judge relevance; do not answer the query.",
    "- Prefer snippets that directly contain the answer or required facts.",
    "- If uncertain, keep fewer rather than more.",
    "- Output MUST be valid JSON exactly, with schema:",
    "  {\"keep\":[\"R1\",\"R4\",...]}",
  ].join("\n");

  const user = [
    `QUERY:\n${params.query}`,
    "",
    "CANDIDATES:",
    ...items.map((it) => `- ${it.id} ${it.file} — ${it.heading}\n\`\`\`\n${it.text}\n\`\`\``),
  ].join("\n");

  try {
    const result = await inferByRole("rerank", system, user, {
      temperature: 0,
      maxTokens: 180,
    });

    const content = result.answer.trim();
    const parsed = JSON.parse(content) as { keep?: string[] };
    const keep = Array.isArray(parsed.keep) ? parsed.keep : [];
    if (keep.length === 0) return params.candidates;
    const keepSet = new Set(keep);
    const kept = list.filter((_, i) => keepSet.has(`R${i + 1}`));
    return kept.length > 0 ? [...kept, ...params.candidates.slice(list.length)] : params.candidates;
  } catch {
    return params.candidates;
  }
}

