/**
 * search.ts — Vault Semantic Search
 *
 * Cosine similarity search against embedded vault chunks.
 * Returns top-K relevant chunks for LLM context injection.
 * Pre-computes vector magnitudes for O(1) amortized lookups.
 *
 * Source: Local RAG notebook (NotebookLM)
 */

import type { EmbeddingChunk, EmbeddingStore } from "./embeddings";

// ── Core Search ────────────────────────────────────────────────────

export interface SearchResult {
  file: string;
  heading: string;
  text: string;
  score: number;
}

// Cache for pre-computed magnitudes (avoids recomputing on every search)
const magnitudeCache = new WeakMap<number[], number>();

function getMagnitude(vec: number[]): number {
  let cached = magnitudeCache.get(vec);
  if (cached !== undefined) return cached;
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i]! * vec[i]!;
  cached = Math.sqrt(sum);
  magnitudeCache.set(vec, cached);
  return cached;
}

const MIN_RELEVANCE = 0.3; // Skip chunks below 30% similarity

/**
 * Search the embedding store for chunks most similar to the query.
 */
export async function searchVault(
  query: string,
  store: EmbeddingStore,
  ollamaUrl: string = "http://localhost:11434",
  topK: number = 3,
): Promise<SearchResult[]> {
  if (store.chunks.length === 0) return [];

  // Embed the query
  const resp = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: store.modelName, prompt: query }),
  });

  if (!resp.ok) {
    console.warn(`[SEARCH] Embedding query failed: ${resp.status}`);
    return [];
  }

  const data = await resp.json() as { embedding: number[] };
  const queryVec = data.embedding;
  const queryMag = getMagnitude(queryVec);

  if (queryMag === 0) return [];

  // Score all chunks (using pre-computed magnitudes for O(1) lookups)
  const scored = store.chunks
    .map((chunk) => {
      const chunkMag = chunk.magnitude || getMagnitude(chunk.vector); // fallback for legacy data
      if (chunkMag === 0) return { file: chunk.file, heading: chunk.heading, text: chunk.text, score: 0 };

      let dot = 0;
      for (let i = 0; i < queryVec.length; i++) dot += queryVec[i]! * chunk.vector[i]!;

      return {
        file: chunk.file,
        heading: chunk.heading,
        text: chunk.text,
        score: dot / (queryMag * chunkMag),
      };
    })
    .filter((r) => r.score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

/**
 * Format search results as context for the LLM system prompt.
 */
export function formatSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return "";

  const sections = results.map((r, i) =>
    `[${i + 1}] ${r.file} — ${r.heading} (${(r.score * 100).toFixed(0)}%):\n${r.text}`
  );

  return `\n## Relevant Vault Context\n${sections.join("\n\n")}`;
}
