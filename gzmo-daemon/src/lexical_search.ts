import type { EmbeddingStore } from "./embeddings";
import type { SearchResult, SearchOptions } from "./search";

function normalize(s: string): string {
  return String(s ?? "").toLowerCase();
}

function tokenize(q: string): string[] {
  const raw = normalize(q);
  const parts = raw.split(/[^a-z0-9/_\-.]+/g).filter(Boolean);
  // keep tokens with some signal
  return [...new Set(parts.filter((t) => t.length >= 3))].slice(0, 24);
}

function scoreText(haystack: string, tokens: string[]): number {
  const h = normalize(haystack);
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (h.includes(t)) score += 1;
  }
  return score;
}

/**
 * Lexical retrieval against already-loaded embedded chunks.
 * This is deterministic and requires no network calls.
 *
 * Score is an arbitrary positive scalar (not cosine); we normalize later.
 */
export function lexicalSearchVault(
  query: string,
  store: EmbeddingStore,
  opts: SearchOptions = {},
): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0 || store.chunks.length === 0) return [];

  const topK = opts.topK ?? 3;
  const perFileLimit = opts.perFileLimit ?? topK;
  const typeFilter = (opts.filters?.types ?? []).map((t) => t.toLowerCase());
  const tagFilter = (opts.filters?.tags ?? []).map((t) => t.toLowerCase());

  const scored: SearchResult[] = [];
  for (const c of store.chunks) {
    const meta = c.metadata;
    if (typeFilter.length > 0) {
      const t = (meta?.type ?? "").toLowerCase();
      if (!t || !typeFilter.includes(t)) continue;
    }
    if (tagFilter.length > 0) {
      const tags = (meta?.tags ?? []).map((t) => t.toLowerCase());
      if (!tagFilter.every((t) => tags.includes(t))) continue;
    }

    let s = 0;
    s += 1.4 * scoreText(c.file, tokens);
    s += 1.2 * scoreText(c.heading, tokens);
    s += 1.0 * scoreText(c.text, tokens);

    // Retrieval priors: align with vector search heuristics (tiny bias only).
    const type = meta?.type?.toLowerCase();
    if (type === "index" || c.file.toLowerCase().endsWith("/index.md")) s -= 2.0;

    if (s <= 0) continue;
    scored.push({
      file: c.file,
      heading: c.heading,
      text: c.text,
      score: s,
      metadata: c.metadata,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const out: SearchResult[] = [];
  const perFile = new Map<string, number>();
  for (const r of scored) {
    const n = perFile.get(r.file) ?? 0;
    if (n >= perFileLimit) continue;
    perFile.set(r.file, n + 1);
    out.push(r);
    if (out.length >= topK) break;
  }

  // Normalize lexical scores to [0..1] range for comparability with cosine.
  const max = out[0]?.score ?? 1;
  for (const r of out) r.score = Math.max(0, Math.min(1, r.score / Math.max(1, max)));

  return out;
}

