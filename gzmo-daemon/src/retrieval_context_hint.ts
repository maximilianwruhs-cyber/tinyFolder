import { readIntEnv } from "./pipelines/helpers";

/**
 * Explain for operators: large Ollama context does not inflate injected snippets.
 */
export function formatRetrievalContextHint(): string {
  const ctx =
    typeof process.env.OLLAMA_CONTEXT_LENGTH === "string" && process.env.OLLAMA_CONTEXT_LENGTH.trim()
      ? process.env.OLLAMA_CONTEXT_LENGTH.trim()
      : "_unset (see Ollama model defaults)_";
  const topk = readIntEnv("GZMO_TOPK", 6, 1, 20);
  const maxSnip = readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 10, 1, 20);
  const maxChars = readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000);
  return (
    `Ollama \`OLLAMA_CONTEXT_LENGTH=${ctx}\` caps the **model tensor context**; GZMO still injects only **GZMO_TOPK=${topk}** hits × **GZMO_EVIDENCE_MAX_SNIPPETS=${maxSnip}** × **GZMO_EVIDENCE_MAX_CHARS=${maxChars}** into the Evidence Packet unless you raise those vars. Think tasks use retrieval only when \`GZMO_THINK_RETRIEVAL\` requests it.`
  );
}
