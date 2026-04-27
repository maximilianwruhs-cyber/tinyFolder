import type { SearchResult } from "./search";

function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

function clamp(s: string, n: number): string {
  const t = String(s ?? "").trim();
  return t.length <= n ? t : t.slice(0, n).trimEnd() + "\n…";
}

/**
 * Budgeted local reranker using Ollama's OpenAI-compatible endpoint.
 * This is intentionally strict and best-effort: if anything fails, returns the input list unchanged.
 *
 * Enable explicitly with `GZMO_RERANK_LLM=on`.
 */
export async function rerankWithLLM(params: {
  query: string;
  candidates: SearchResult[];
  ollamaBaseUrl?: string; // e.g. http://localhost:11434/v1
  model?: string; // e.g. hermes3:8b
  maxCandidates?: number; // default 12
  timeoutMs?: number; // default 6000
}): Promise<SearchResult[]> {
  if (!readBoolEnv("GZMO_RERANK_LLM", false)) return params.candidates;
  const base = (params.ollamaBaseUrl ?? (process.env.OLLAMA_URL ?? "http://localhost:11434/v1")).replace(/\/$/, "");
  const model = params.model ?? (process.env.OLLAMA_MODEL ?? "hermes3:8b");
  const maxCandidates = params.maxCandidates ?? 12;
  const timeoutMs = params.timeoutMs ?? 6000;

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
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) return params.candidates;
    const data = await resp.json() as any;
    const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
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

