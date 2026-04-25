import type { EmbeddingStore } from "./embeddings";
import type { SearchOptions, SearchResult } from "./search";

function normalize(s: string): string {
  return String(s ?? "").toLowerCase();
}

function tokenize(text: string): string[] {
  // Keep path-ish tokens too.
  const raw = normalize(text);
  const parts = raw.split(/[^a-z0-9/_\-.]+/g).filter(Boolean);
  // Drop very short tokens, cap to bound work.
  return parts.filter((t) => t.length >= 3).slice(0, 64);
}

export interface Bm25Index {
  // doc id is chunk index in store.chunks
  avgdl: number;
  docLen: Uint32Array;
  df: Map<string, number>;
  tf: Array<Map<string, number>>;
}

export function buildBm25Index(store: EmbeddingStore): Bm25Index {
  const n = store.chunks.length;
  const df = new Map<string, number>();
  const tf: Array<Map<string, number>> = new Array(n);
  const docLen = new Uint32Array(n);

  let totalLen = 0;

  for (let i = 0; i < n; i++) {
    const c = store.chunks[i]!;
    const tokens = tokenize(`${c.file}\n${c.heading}\n${c.text}`);
    docLen[i] = tokens.length;
    totalLen += tokens.length;

    const m = new Map<string, number>();
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
    tf[i] = m;

    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const avgdl = n > 0 ? totalLen / n : 0;
  return { avgdl, docLen, df, tf };
}

function bm25Score(params: {
  qTokens: string[];
  docTf: Map<string, number>;
  docLen: number;
  avgdl: number;
  df: Map<string, number>;
  N: number;
  k1?: number;
  b?: number;
}): number {
  const k1 = params.k1 ?? 1.2;
  const b = params.b ?? 0.75;
  const { qTokens, docTf, docLen, avgdl, df, N } = params;

  let score = 0;
  for (const t of qTokens) {
    const f = docTf.get(t) ?? 0;
    if (f <= 0) continue;
    const n = df.get(t) ?? 0;
    // BM25+ style IDF; stable for small corpora.
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    const denom = f + k1 * (1 - b + b * (docLen / Math.max(1e-6, avgdl)));
    score += idf * ((f * (k1 + 1)) / denom);
  }
  return score;
}

/**
 * BM25 retrieval over embedded chunks (purely local, deterministic).
 * Returns scores normalized to [0..1] for fusion.
 */
export function bm25SearchVault(
  query: string,
  store: EmbeddingStore,
  index: Bm25Index,
  opts: SearchOptions = {},
): SearchResult[] {
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0 || store.chunks.length === 0) return [];

  const topK = opts.topK ?? 3;
  const perFileLimit = opts.perFileLimit ?? topK;
  const typeFilter = (opts.filters?.types ?? []).map((t) => t.toLowerCase());
  const tagFilter = (opts.filters?.tags ?? []).map((t) => t.toLowerCase());

  const scored: Array<{ idx: number; score: number }> = [];
  const N = store.chunks.length;

  for (let i = 0; i < N; i++) {
    const c = store.chunks[i];
    if (!c) continue;
    const meta = c.metadata;

    if (typeFilter.length > 0) {
      const t = (meta?.type ?? "").toLowerCase();
      if (!t || !typeFilter.includes(t)) continue;
    }
    if (tagFilter.length > 0) {
      const tags = (meta?.tags ?? []).map((t) => t.toLowerCase());
      if (!tagFilter.every((t) => tags.includes(t))) continue;
    }

    const s = bm25Score({
      qTokens,
      // Defensive: older/partial indexes or sparse chunk arrays should not crash retrieval.
      docTf: index.tf[i] ?? new Map<string, number>(),
      docLen: index.docLen[i] ?? 0,
      avgdl: index.avgdl,
      df: index.df,
      N,
    });
    if (s <= 0) continue;
    scored.push({ idx: i, score: s });
  }

  scored.sort((a, b) => b.score - a.score);

  // Convert to SearchResult and diversify by file.
  const out: SearchResult[] = [];
  const perFile = new Map<string, number>();
  for (const r of scored) {
    const c = store.chunks[r.idx]!;
    const n = perFile.get(c.file) ?? 0;
    if (n >= perFileLimit) continue;
    perFile.set(c.file, n + 1);
    out.push({
      file: c.file,
      heading: c.heading,
      text: c.text,
      score: r.score,
      metadata: c.metadata,
    });
    if (out.length >= Math.max(topK, 8)) break;
  }

  // Normalize to [0..1] range for fusion.
  const max = out[0]?.score ?? 1;
  for (const r of out) r.score = Math.max(0, Math.min(1, r.score / Math.max(1, max)));
  return out.slice(0, topK * 2);
}

