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
import { buildBm25Index, bm25SearchVault } from "./bm25";
import { rerankWithLLM } from "./rerank_llm";
import { rewriteQuery } from "./query_rewrite";
import { buildAnchorIndex } from "./anchor_index";

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

// BM25 index cache (store identity -> built index)
const bm25Cache = new WeakMap<EmbeddingStore, ReturnType<typeof buildBm25Index>>();
const anchorCache = new WeakMap<EmbeddingStore, ReturnType<typeof buildAnchorIndex>>();

function getBm25Index(store: EmbeddingStore) {
  const hit = bm25Cache.get(store);
  if (hit) return hit;
  const idx = buildBm25Index(store);
  bm25Cache.set(store, idx);
  return idx;
}

function getAnchorIndex(store: EmbeddingStore) {
  const hit = anchorCache.get(store);
  if (hit) return hit;
  const idx = buildAnchorIndex(store);
  anchorCache.set(store, idx);
  return idx;
}

function applyAnchorPrior(query: string, results: SearchResult[], store: EmbeddingStore): SearchResult[] {
  // Enable explicitly (cheap but not free).
  const raw = (process.env.GZMO_ANCHOR_PRIOR ?? "").trim().toLowerCase();
  if (!(raw === "1" || raw === "true" || raw === "yes" || raw === "on")) return results;

  const idx = getAnchorIndex(store);
  const q = query.toLowerCase();
  const hot = idx.anchors
    .slice(0, 80)
    .map((a) => a.anchor)
    .filter((a) => a && q.includes(a.toLowerCase()))
    .slice(0, 12);
  if (hot.length === 0) return results;

  return results.map((r) => {
    let bonus = 0;
    const text = `${r.heading}\n${r.text}`.toLowerCase();
    for (const a of hot) {
      if (text.includes(a.toLowerCase())) bonus += 0.03;
    }
    return bonus ? { ...r, score: Math.min(1, r.score + bonus) } : r;
  });
}

function rrfFuse(params: {
  dense: SearchResult[];
  lexical: SearchResult[];
  k?: number; // RRF constant
}): SearchResult[] {
  const k = params.k ?? 60;
  const fused = new Map<string, SearchResult & { _rrf: number }>();
  const key = (r: SearchResult) => `${r.file}::${r.heading}::${(r.text ?? "").slice(0, 80)}`;

  const addList = (list: SearchResult[]) => {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank]!;
      const kk = key(r);
      const contrib = 1 / (k + rank + 1);
      const existing = fused.get(kk);
      if (!existing) {
        fused.set(kk, { ...r, _rrf: contrib });
      } else {
        existing._rrf += contrib;
        existing.score = Math.max(existing.score, r.score);
      }
    }
  };

  addList(params.dense);
  addList(params.lexical);

  return [...fused.values()]
    .sort((a, b) => b._rrf - a._rrf)
    .map(({ _rrf, ...rest }) => rest);
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

  const baseV1 = (process.env.OLLAMA_URL ?? "http://localhost:11434/v1");
  const rewrites = await rewriteQuery({ query, ollamaBaseUrl: baseV1 });

  const denseAll: SearchResult[] = [];
  const lexAll: SearchResult[] = [];
  for (const q of rewrites) {
    const [vec, lex] = await Promise.all([
      searchVault(q, store, ollamaUrl, { ...opts, topK: Math.max(topK, 10), perFileLimit }),
      Promise.resolve(
        bm25SearchVault(q, store, getBm25Index(store), { ...opts, topK: Math.max(topK, 10), perFileLimit }),
      ),
    ]);
    denseAll.push(...applyAnchorPrior(q, vec, store));
    lexAll.push(...applyAnchorPrior(q, lex, store));
  }

  let fused = rrfFuse({ dense: denseAll, lexical: lexAll, k: 60 });

  // Optional LLM reranker (best-effort). Uses OpenAI-compatible base URL, not /api.
  fused = await rerankWithLLM({
    query,
    candidates: fused,
    ollamaBaseUrl: baseV1,
    maxCandidates: 12,
    timeoutMs: 6000,
  });

  // Diversify by file path.
  const out: SearchResult[] = [];
  const perFile = new Map<string, number>();
  for (const r of fused) {
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
