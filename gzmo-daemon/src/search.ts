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
import { promises as fsp } from "fs";
import * as path from "path";

// ── Core Search ────────────────────────────────────────────────────

export interface SearchResult {
  file: string;
  heading: string;
  text: string;
  score: number;
  source?: "vector" | "graph";
  metadata?: EmbeddingChunk["metadata"];
}

export interface SearchFilters {
  pathPrefixes?: string[];
  types?: string[];
  tags?: string[];
  roles?: string[];
  statuses?: string[];
  excludePathPrefixes?: string[];
}

export interface SearchOptions {
  topK?: number;
  filters?: SearchFilters;
  perFileLimit?: number;
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
  topKOrOptions: number | SearchOptions = 3,
): Promise<SearchResult[]> {
  if (store.chunks.length === 0) return [];
  const options: SearchOptions = typeof topKOrOptions === "number"
    ? { topK: topKOrOptions }
    : topKOrOptions;
  const topK = options.topK ?? 3;
  const candidateChunks = store.chunks.filter((chunk) => matchesFilters(chunk, options.filters));
  if (candidateChunks.length === 0) {
    console.warn("[SEARCH] No candidate chunks after filters.");
    return [];
  }

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
  const scored = candidateChunks
    .map((chunk) => {
      const chunkMag = chunk.magnitude || getMagnitude(chunk.vector);
      if (chunkMag === 0) return { file: chunk.file, heading: chunk.heading, text: chunk.text, score: 0, source: "vector" as const };

      let dot = 0;
      for (let i = 0; i < queryVec.length; i++) dot += queryVec[i]! * chunk.vector[i]!;

      const rawScore = dot / (queryMag * chunkMag);
      return {
        file: chunk.file,
        heading: chunk.heading,
        text: chunk.text,
        score: applyRetrievalPrior(rawScore, chunk, query),
        source: "vector" as const,
        metadata: chunk.metadata,
      };
    })
    .filter((r) => r.score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score)
    .filter(createPerFileLimiter(options.perFileLimit ?? 2))
    .slice(0, topK);

  if (scored.length === 0) {
    console.warn(`[SEARCH] No chunks met relevance threshold ${MIN_RELEVANCE}. candidates=${candidateChunks.length}`);
  }

  return scored;
}

function applyRetrievalPrior(score: number, chunk: EmbeddingChunk, query = ""): number {
  const file = chunk.file.replace(/\\/g, "/");
  const metadata = chunk.metadata;
  let multiplier = 1;

  if (file === "wiki/START.md") multiplier *= 1.2;
  else if (file === "wiki/index.md" || file.endsWith("/index.md")) multiplier *= 0.65;
  else if (file === "wiki/entities/GZMO-Hardware-Profile.md" && isHardwarePathQuery(query)) multiplier *= 1.28;
  else if (file.startsWith("wiki/entities/")) multiplier *= 1.12;
  else if (file.startsWith("wiki/topics/")) multiplier *= 1.08;
  else if (file.startsWith("GZMO/Inbox/")) multiplier *= 0.85;

  switch (metadata?.role?.toLowerCase()) {
    case "canonical":
      multiplier *= 1.1;
      break;
    case "generated":
      multiplier *= 0.85;
      break;
    case "operational":
      multiplier *= 0.75;
      break;
    case "raw-summary":
      multiplier *= 0.85;
      break;
  }

  switch (metadata?.retrievalPriority?.toLowerCase()) {
    case "high":
      multiplier *= 1.2;
      break;
    case "low":
      multiplier *= 0.5;
      break;
  }

  return Math.min(1, score * multiplier);
}

function isHardwarePathQuery(query: string): boolean {
  const q = query.toLowerCase();
  return /\b(hardware|gpu|vram|cuda|kernel|host|machine)\b/.test(q)
    || /\b(workspace|vault|daemon|current|ollama)\s+path\b/.test(q)
    || /\bpath\s+(workspace|vault|daemon|current|ollama)\b/.test(q);
}

function createPerFileLimiter(limit: number): (result: SearchResult) => boolean {
  if (limit <= 0) return () => true;
  const seen = new Map<string, number>();
  return (result: SearchResult) => {
    const count = seen.get(result.file) ?? 0;
    if (count >= limit) return false;
    seen.set(result.file, count + 1);
    return true;
  };
}

export function inferSearchFilters(query: string): SearchFilters {
  const filters: SearchFilters = {
    excludePathPrefixes: ["GZMO/Archive/"],
  };
  const tags = [...query.matchAll(/(?:tag|tags):([a-z0-9_-]+)/gi)].map((m) => m[1]!.toLowerCase());
  const types = [...query.matchAll(/(?:type|document_type):([a-z0-9_-]+)/gi)].map((m) => m[1]!.toLowerCase());
  const paths = [...query.matchAll(/(?:path|folder):([A-Za-z0-9_./-]+)/g)].map((m) => m[1]!.replace(/^\/+/, ""));

  if (tags.length > 0) filters.tags = tags;
  if (types.length > 0) filters.types = types;
  if (paths.length > 0) filters.pathPrefixes = paths;

  return filters;
}

function matchesFilters(chunk: EmbeddingChunk, filters?: SearchFilters): boolean {
  if (!filters) return true;
  const normalizedFile = chunk.file.replace(/\\/g, "/");
  if (filters.excludePathPrefixes?.some((prefix) => normalizedFile.startsWith(prefix))) return false;
  if (filters.pathPrefixes?.length && !filters.pathPrefixes.some((prefix) => normalizedFile.startsWith(prefix))) return false;

  const metadata = chunk.metadata;
  if (filters.types?.length) {
    const type = metadata?.type?.toLowerCase();
    if (!type || !filters.types.includes(type)) return false;
  }
  if (filters.statuses?.length) {
    const status = metadata?.status?.toLowerCase();
    if (!status || !filters.statuses.includes(status)) return false;
  }
  if (filters.tags?.length) {
    const tags = new Set(metadata?.tags ?? []);
    if (!filters.tags.every((tag) => tags.has(tag.toLowerCase()))) return false;
  }
  if (filters.roles?.length) {
    const role = metadata?.role?.toLowerCase();
    if (!role || !filters.roles.includes(role)) return false;
  }
  return true;
}

export async function augmentWithWikiGraphContext(
  vaultPath: string,
  results: SearchResult[],
  maxNeighbors: number = 2,
): Promise<SearchResult[]> {
  if (results.length === 0 || maxNeighbors <= 0) return results;

  const existing = new Set(results.map((result) => result.file));
  const wikiIndex = await indexWikiPages(vaultPath);
  const neighbors: SearchResult[] = [];

  for (const result of results) {
    if (!result.file.startsWith("wiki/")) continue;
    const raw = await readVaultFile(vaultPath, result.file);
    if (!raw) continue;

    const links = [...raw.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)]
      .map((match) => match[1]!.trim())
      .filter(Boolean);

    for (const link of links) {
      const linkedFile = resolveWikiLink(link, wikiIndex);
      if (!linkedFile || existing.has(linkedFile)) continue;
      const linkedRaw = await readVaultFile(vaultPath, linkedFile);
      if (!linkedRaw) continue;
      existing.add(linkedFile);
      neighbors.push({
        file: linkedFile,
        heading: "wikilink neighbor",
        text: linkedRaw.replace(/^---[\s\S]*?---\s*/, "").trim().slice(0, 500),
        score: Math.max(0.01, result.score - 0.05),
        source: "graph",
      });
      if (neighbors.length >= maxNeighbors) return [...results, ...neighbors];
    }
  }

  return [...results, ...neighbors];
}

type WikiLinkIndex = Map<string, string | string[]>;

async function indexWikiPages(vaultPath: string): Promise<WikiLinkIndex> {
  const index: WikiLinkIndex = new Map();
  const wikiRoot = path.join(vaultPath, "wiki");
  await scanWiki(wikiRoot, vaultPath, index);
  return index;
}

async function scanWiki(dir: string, vaultPath: string, index: WikiLinkIndex): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanWiki(full, vaultPath, index);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const rel = path.relative(vaultPath, full).replace(/\\/g, "/");
      const noExt = rel.replace(/\.md$/i, "").toLowerCase();
      const wikiRelative = noExt.replace(/^wiki\//, "");
      const base = path.basename(entry.name, ".md").toLowerCase();
      addWikiLinkIndexEntry(index, noExt, rel);
      addWikiLinkIndexEntry(index, wikiRelative, rel);
      addWikiLinkIndexEntry(index, base, rel);
    }
  }
}

function addWikiLinkIndexEntry(index: WikiLinkIndex, key: string, rel: string): void {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "").toLowerCase();
  const existing = index.get(normalized);
  if (!existing) {
    index.set(normalized, rel);
    return;
  }
  if (Array.isArray(existing)) {
    if (!existing.includes(rel)) existing.push(rel);
    return;
  }
  if (existing !== rel) index.set(normalized, [existing, rel]);
}

export function resolveWikiLink(link: string, index: WikiLinkIndex): string | null {
  const normalized = link
    .split("#")[0]!
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .toLowerCase();
  if (!normalized || normalized.startsWith("http")) return null;

  const directHit = index.get(normalized);
  if (typeof directHit === "string") return directHit;
  if (Array.isArray(directHit)) return directHit.length === 1 ? directHit[0]! : null;

  if (!normalized.startsWith("wiki/")) {
    const pathHit = index.get(`wiki/${normalized}`);
    if (typeof pathHit === "string") return pathHit;
    if (Array.isArray(pathHit) && pathHit.length === 1) return pathHit[0]!;
  }
  return null;
}

async function readVaultFile(vaultPath: string, relPath: string): Promise<string | null> {
  try {
    return await Bun.file(path.join(vaultPath, relPath)).text();
  } catch {
    return null;
  }
}

/**
 * Format search results as context for the LLM system prompt.
 */
export function formatSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return "";

  const sections = results.map((r, i) => {
    const meta = formatSearchMetadata(r.metadata);
    const metaLine = meta ? `\nMetadata: ${meta}` : "";
    return `[${i + 1}] ${r.file} — ${r.heading} (${(r.score * 100).toFixed(0)}%, ${r.source ?? "vector"}):${metaLine}\n${r.text}`;
  });

  return `\n## Relevant Vault Context\n${sections.join("\n\n")}`;
}

function formatSearchMetadata(metadata?: EmbeddingChunk["metadata"]): string {
  if (!metadata) return "";
  const parts: string[] = [];
  if (metadata.type) parts.push(`type=${metadata.type}`);
  if (metadata.role) parts.push(`role=${metadata.role}`);
  if ((metadata.tags ?? []).length > 0) parts.push(`tags=${metadata.tags.join(",")}`);
  if (metadata.status) parts.push(`status=${metadata.status}`);
  if (metadata.updated) parts.push(`updated=${metadata.updated}`);
  return parts.join("; ");
}
