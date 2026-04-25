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
import { lexicalSearchVault } from "./lexical_search";

// ── Core Search ────────────────────────────────────────────────────

export interface SearchResult {
  file: string;
  heading: string;
  text: string;
  score: number;
  metadata?: EmbeddingChunk["metadata"];
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

export interface SearchFilters {
  types?: string[];
  tags?: string[];
}

export interface SearchOptions {
  topK?: number;
  perFileLimit?: number;
  filters?: SearchFilters;
}

export function resolveWikiLink(link: string, index: Map<string, string | string[]>): string | null {
  const key = String(link ?? "").trim();
  if (!key) return null;
  const norm = key.toLowerCase();

  // Prefer path-qualified keys if present.
  if (norm.includes("/")) {
    const hit = index.get(norm);
    return typeof hit === "string" ? hit : null;
  }

  const hit = index.get(norm);
  if (!hit) return null;
  // Reject ambiguous basenames.
  if (Array.isArray(hit)) return null;
  return hit;
}

/**
 * Search the embedding store for chunks most similar to the query.
 */
export async function searchVault(
  query: string,
  store: EmbeddingStore,
  ollamaUrl: string = "http://localhost:11434",
  topKOrOptions: number | SearchOptions = 3,
): Promise<SearchResult[]> {
  if (store.chunks.length === 0) return [];

  const opts: SearchOptions = typeof topKOrOptions === "number" ? { topK: topKOrOptions } : (topKOrOptions ?? {});
  const topK = opts.topK ?? 3;
  const perFileLimit = opts.perFileLimit ?? topK;
  const typeFilter = (opts.filters?.types ?? []).map((t) => t.toLowerCase());
  const tagFilter = (opts.filters?.tags ?? []).map((t) => t.toLowerCase());

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

      let score = dot / (queryMag * chunkMag);

      // Small-LLM retrieval priors (lightweight heuristics).
      const role = chunk.metadata?.role?.toLowerCase();
      const type = chunk.metadata?.type?.toLowerCase();
      const retrieval = chunk.metadata?.retrievalPriority?.toLowerCase();

      if (role === "canonical") score += 0.12;
      if (chunk.file.toLowerCase().includes("hardware-profile")) score += 0.18;
      if (type === "index" || chunk.file.toLowerCase().endsWith("/index.md") || chunk.file.toLowerCase().endsWith("wiki/index.md")) score -= 1.0;
      if (retrieval === "low") score -= 0.08;

      return {
        file: chunk.file,
        heading: chunk.heading,
        text: chunk.text,
        score,
        metadata: chunk.metadata,
      };
    })
    .filter((r) => r.score >= MIN_RELEVANCE)
    .filter((r) => {
      if (typeFilter.length > 0) {
        const t = (r.metadata?.type ?? "").toLowerCase();
        if (!t || !typeFilter.includes(t)) return false;
      }
      if (tagFilter.length > 0) {
        const tags = (r.metadata?.tags ?? []).map((t) => t.toLowerCase());
        if (!tagFilter.every((t) => tags.includes(t))) return false;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score);

  // Diversify by file path.
  const out: SearchResult[] = [];
  const perFile = new Map<string, number>();
  for (const r of scored) {
    const n = perFile.get(r.file) ?? 0;
    if (n >= perFileLimit) continue;
    perFile.set(r.file, n + 1);
    out.push(r);
    if (out.length >= topK) break;
  }

  return out;
}

/**
 * Hybrid retrieval: vector (semantic) + lexical (exact/path/schema).
 * Merges and re-ranks with diversification.
 */
export async function searchVaultHybrid(
  query: string,
  store: EmbeddingStore,
  ollamaUrl: string = "http://localhost:11434",
  topKOrOptions: number | SearchOptions = 3,
): Promise<SearchResult[]> {
  const opts: SearchOptions = typeof topKOrOptions === "number" ? { topK: topKOrOptions } : (topKOrOptions ?? {});
  const topK = opts.topK ?? 3;
  const perFileLimit = opts.perFileLimit ?? topK;

  const [vec, lex] = await Promise.all([
    searchVault(query, store, ollamaUrl, { ...opts, topK: Math.max(topK, 6), perFileLimit }),
    Promise.resolve(lexicalSearchVault(query, store, { ...opts, topK: Math.max(topK, 6), perFileLimit })),
  ]);

  // Merge by file+heading+text prefix.
  const key = (r: SearchResult) => `${r.file}::${r.heading}::${(r.text ?? "").slice(0, 80)}`;
  const merged = new Map<string, SearchResult>();

  // Prefer vector score, but let lexical pull in exact matches.
  for (const r of vec) merged.set(key(r), r);
  for (const r of lex) {
    const k = key(r);
    const existing = merged.get(k);
    if (!existing) {
      merged.set(k, r);
      continue;
    }
    // Combine scores (both are already in [0..1] range).
    existing.score = Math.max(existing.score, r.score) * 0.7 + Math.min(1, existing.score + r.score) * 0.3;
  }

  const scored = [...merged.values()].sort((a, b) => b.score - a.score);

  // Diversify by file path.
  const out: SearchResult[] = [];
  const perFile = new Map<string, number>();
  for (const r of scored) {
    const n = perFile.get(r.file) ?? 0;
    if (n >= perFileLimit) continue;
    perFile.set(r.file, n + 1);
    out.push(r);
    if (out.length >= topK) break;
  }
  return out;
}

/**
 * Format search results as context for the LLM system prompt.
 */
export function formatSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return "";

  const sections = results.map((r, i) => {
    const meta = r.metadata
      ? `\nMetadata: type=${r.metadata.type ?? "?"}; role=${r.metadata.role ?? "?"}; tags=${(r.metadata.tags ?? []).join(",")}`
      : "";
    return `[${i + 1}] ${r.file} — ${r.heading} (${(r.score * 100).toFixed(0)}%):\n${r.text}${meta}`;
  });

  return `\n## Relevant Vault Context\n${sections.join("\n\n")}`;
}
