import { inferByRole } from "./inference_router";
import { readBoolEnv } from "./pipelines/helpers";

/**
 * Local multi-query rewriting using Ollama via the model router.
 * When GZMO_ENABLE_MODEL_ROUTING=on this uses the "fast" role (e.g. qwen2.5:0.5b).
 * Enable explicitly with `GZMO_MULTIQUERY=on`.
 */
export async function rewriteQuery(params: {
  query: string;
  timeoutMs?: number;
}): Promise<string[]> {
  if (!readBoolEnv("GZMO_MULTIQUERY", false)) return [params.query];
  const timeoutMs = params.timeoutMs ?? 4500;

  const system = [
    "You rewrite user queries for retrieval.",
    "Output MUST be valid JSON exactly: {\"rewrites\":[...]}",
    "Rules:",
    "- Provide exactly 3 rewrites.",
    "- Each rewrite must be <= 12 words.",
    "- Use keyword-heavy phrasing (entities, file names, paths, tags).",
    "- Do not add information; only rephrase.",
  ].join("\n");

  try {
    const result = await inferByRole("fast", system, params.query, {
      temperature: 0.2,
      maxTokens: 160,
      // R2: actually honour the advertised timeout so a hung Ollama can never
      // block search even when GZMO_MULTIQUERY=on.
      timeoutMs,
    });

    const content = result.answer.trim();
    const parsed = JSON.parse(content) as { rewrites?: string[] };
    const rewrites = Array.isArray(parsed.rewrites)
      ? parsed.rewrites.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const uniq = [...new Set([params.query, ...rewrites])].slice(0, 4);
    return uniq.length ? uniq : [params.query];
  } catch {
    return [params.query];
  }
}

