/**
 * Pre-execution clarification for think tasks referencing vault entities.
 */

import { resolve } from "path";
import { searchVaultHybrid } from "./search";
import type { EmbeddingStore } from "./embeddings";
import { extractExplicitVaultMdPaths, readBoolEnv } from "./pipelines/helpers";
import { shouldInjectProjectGrounding } from "./pipelines/helpers";

function ollamaBaseUrl(): string {
  const base0 = (process.env.OLLAMA_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return (base0.endsWith("/v1") ? base0 : `${base0}/v1`).replace(/\/v1$/, "");
}

/** Returns clarification text when the think task should halt, else undefined. */
export async function checkThinkClarification(params: {
  vaultRoot: string;
  body: string;
  embeddingStore?: EmbeddingStore;
}): Promise<string | undefined> {
  if (!readBoolEnv("GZMO_ENABLE_THINK_CLARIFY", false)) return undefined;

  const body = String(params.body ?? "").trim();
  if (!body) {
    return "The task body is empty. Please describe what you want GZMO to think through.";
  }

  const explicit = extractExplicitVaultMdPaths(body);
  const missing: string[] = [];
  for (const rel of explicit) {
    try {
      const abs = resolve(params.vaultRoot, rel);
      if (!(await Bun.file(abs).exists())) missing.push(rel);
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length > 0) {
    return [
      "Referenced vault files were not found:",
      ...missing.map((f) => `- \`${f}\``),
      "",
      "Fix the paths or add the documents, then set `status: pending`.",
    ].join("\n");
  }

  const refsVault =
    shouldInjectProjectGrounding("think", body) ||
    /\b(vault|wiki\/|knowledge base|according to our|in (?:the )?docs)\b/i.test(body) ||
    explicit.length > 0;

  if (!refsVault) return undefined;

  if (params.embeddingStore) {
    try {
      const results = await searchVaultHybrid(body, params.embeddingStore, ollamaBaseUrl(), {
        topK: 4,
        mode: "fast",
      });
      if (results.length === 0 && explicit.length === 0) {
        return [
          "This think task appears to need vault grounding, but retrieval found no matching documents.",
          "",
          "**Suggestions:**",
          "- Add or update wiki pages related to your question",
          "- Use `action: search` if you need evidence-first answers",
          "- Rephrase with specific file names or topics",
        ].join("\n");
      }
    } catch {
      // Non-fatal — proceed if retrieval fails
    }
  }

  if (body.length < 24 && explicit.length === 0) {
    return [
      "The query is too brief for a vault-grounded think task.",
      "",
      "Please add more context: what to analyze, which area of the vault matters, and what output format you need.",
    ].join("\n");
  }

  return undefined;
}
