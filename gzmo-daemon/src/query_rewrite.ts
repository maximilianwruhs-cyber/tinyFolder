function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

/**
 * Local multi-query rewriting using Ollama (OpenAI-compatible endpoint).
 * Enable explicitly with `GZMO_MULTIQUERY=on`.
 */
export async function rewriteQuery(params: {
  query: string;
  ollamaBaseUrl?: string; // e.g. http://localhost:11434/v1
  model?: string;
  timeoutMs?: number;
}): Promise<string[]> {
  if (!readBoolEnv("GZMO_MULTIQUERY", false)) return [params.query];
  const base = (params.ollamaBaseUrl ?? (process.env.OLLAMA_URL ?? "http://localhost:11434/v1")).replace(/\/$/, "");
  const model = params.model ?? (process.env.OLLAMA_MODEL ?? "hermes3:8b");
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
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 160,
        messages: [
          { role: "system", content: system },
          { role: "user", content: params.query },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return [params.query];
    const data = await resp.json() as any;
    const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(content) as { rewrites?: string[] };
    const rewrites = Array.isArray(parsed.rewrites) ? parsed.rewrites.map((s) => String(s).trim()).filter(Boolean) : [];
    const uniq = [...new Set([params.query, ...rewrites])].slice(0, 4);
    return uniq.length ? uniq : [params.query];
  } catch {
    return [params.query];
  }
}

