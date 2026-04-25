/**
 * embeddings.ts — Local Embedding Pipeline
 *
 * Embeds vault markdown files using nomic-embed-text via Ollama.
 * SHA256 dedup prevents re-embedding unchanged content.
 * Debounced file watching for live vault sync.
 *
 * Source: Local RAG notebook (NotebookLM)
 */

import { existsSync } from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import matter from "gray-matter";
import { cpus } from "os";
import { atomicWriteJson, resolveVaultPath } from "./vault_fs";

// ── Types ──────────────────────────────────────────────────────────

export interface EmbeddingChunk {
  file: string;           // relative path from vault root
  heading: string;        // nearest markdown heading
  text: string;           // chunk content
  hash: string;           // SHA256 of text
  vector: number[];       // embedding vector
  magnitude: number;      // pre-computed L2 norm for O(1) cosine sim
  updatedAt: string;      // ISO timestamp
  metadata?: {
    pathBucket: string;
    type?: string;
    tags: string[];
    role?: string;
    retrievalPriority?: string;
    status?: string;
    updated?: string;
  };
}

export interface EmbeddingStore {
  modelName: string;
  chunks: EmbeddingChunk[];
  lastFullScan: string;
  dirty: boolean;         // tracks whether chunks were modified since last write
}

// ── Configuration ──────────────────────────────────────────────────

const EMBED_MODEL = "nomic-embed-text";
const CHUNK_SIZE = 400;       // ~tokens (chars ÷ 4)
const CHUNK_OVERLAP = 80;     // ~tokens overlap
const MAX_CHUNK_CHARS = CHUNK_SIZE * 4;
const OVERLAP_CHARS = CHUNK_OVERLAP * 4;

// Folders to embed (relative to vault root)
const EMBED_FOLDERS = [
  "wiki",
  "GZMO/Thought_Cabinet",
  "GZMO/Inbox",
  "Projects",
  "Notes",
];

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Embed a single text using Ollama's nomic-embed-text.
 */
async function embedText(
  text: string,
  ollamaUrl: string = "http://localhost:11434",
): Promise<number[]> {
  const resp = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });

  if (!resp.ok) {
    const err = new Error(`Embedding failed: ${resp.status} ${resp.statusText}`);
    (err as any).status = resp.status;
    throw err;
  }

  const data = await resp.json() as { embedding: number[] };
  return data.embedding;
}

function resolveEmbedConcurrency(requested: string | undefined): number {
  const raw = (requested ?? "4").trim().toLowerCase();
  if (raw === "auto") {
    const cores = Math.max(1, cpus()?.length ?? 1);
    // Conservative default: keep parallelism below what can starve the event loop.
    return Math.max(2, Math.min(8, Math.floor(cores / 2)));
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(32, n) : 4;
}

function shouldBackoffEmbeddingError(err: unknown): boolean {
  const status = typeof (err as any)?.status === "number" ? (err as any).status as number : null;
  if (status === 429 || status === 503 || status === 502) return true;
  const msg = String((err as any)?.message ?? err ?? "");
  return /\b429\b|\btoo many requests\b|\brate limit\b|\boverloaded\b/i.test(msg);
}

/** Compute L2 magnitude of a vector. */
function vectorMagnitude(vec: number[]): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i]! * vec[i]!;
  return Math.sqrt(sum);
}

/**
 * Split markdown into heading-aware chunks.
 * Keeps chunks under MAX_CHUNK_CHARS with OVERLAP_CHARS overlap.
 */
function chunkMarkdown(content: string, filePath: string): Array<{ heading: string; text: string }> {
  const lines = content.split("\n");
  const chunks: Array<{ heading: string; text: string }> = [];
  let currentHeading = path.basename(filePath, ".md");
  let buffer = "";

  for (const line of lines) {
    // Track current heading
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      // Flush buffer before new heading
      if (buffer.trim().length > 50) {
        chunks.push({ heading: currentHeading, text: buffer.trim() });
        buffer = "";
      }
      currentHeading = headingMatch[1]!.trim();
    }

    buffer += line + "\n";

    // Flush if chunk is large enough
    if (buffer.length >= MAX_CHUNK_CHARS) {
      chunks.push({ heading: currentHeading, text: buffer.trim() });
      // Keep overlap
      buffer = buffer.slice(-OVERLAP_CHARS);
    }
  }

  // Final chunk
  if (buffer.trim().length > 50) {
    chunks.push({ heading: currentHeading, text: buffer.trim() });
  }

  return chunks;
}

function extractMetadata(content: string, relPath: string): NonNullable<EmbeddingChunk["metadata"]> {
  let data: Record<string, unknown> = {};
  try {
    data = matter(content).data ?? {};
  } catch {
    data = {};
  }

  const defaults = metadataDefaultsForPath(relPath);
  const tags = [...new Set([...defaults.tags, ...readTags(data.tags)])];

  return {
    pathBucket: relPath.split("/")[0] ?? "",
    type: readScalar(data.type) ?? defaults.type,
    tags,
    role: readScalar(data.role) ?? defaults.role,
    retrievalPriority: readScalar(data.retrieval_priority) ?? defaults.retrievalPriority,
    status: readScalar(data.status),
    updated: readScalar(data.updated),
  };
}

function metadataDefaultsForPath(relPath: string): Pick<NonNullable<EmbeddingChunk["metadata"]>, "tags" | "type" | "role" | "retrievalPriority"> {
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("GZMO/Thought_Cabinet/")) {
    return { tags: ["gzmo", "thought-cabinet", "generated"], type: "generated", role: "generated", retrievalPriority: "low" };
  }
  if (normalized.startsWith("GZMO/Inbox/")) {
    return { tags: ["gzmo", "inbox", "task"], type: "task", role: "operational", retrievalPriority: "medium" };
  }
  if (normalized.startsWith("wiki/")) {
    return { tags: ["wiki"], role: "canonical", retrievalPriority: "high" };
  }
  return { tags: [], retrievalPriority: "medium" };
}

function readScalar(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const s = String(value).trim();
  return s || undefined;
}

function readTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).replace(/^#/, "").trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\s,]+/).map((tag) => tag.replace(/^#/, "").trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

/**
 * SHA256 hash of content for dedup.
 */
function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Scan vault and embed new/changed files.
 * Returns the updated store.
 */
export async function syncEmbeddings(
  vaultPath: string,
  storePath: string,
  ollamaUrl: string = "http://localhost:11434",
): Promise<EmbeddingStore> {
  // Validate target write path stays inside vault & not in raw/
  const { abs: storeAbs } = resolveVaultPath(vaultPath, storePath);
  // Load existing store
  let store: EmbeddingStore = {
    modelName: EMBED_MODEL,
    chunks: [],
    lastFullScan: "",
    dirty: false,
  };

  const storeFile = Bun.file(storeAbs);
  if (await storeFile.exists()) {
    try {
      const loaded = await storeFile.json();
      store = { ...loaded, dirty: false };
      // Backfill magnitudes for chunks from older stores
      for (const c of store.chunks) {
        if (c.magnitude === undefined || c.magnitude === 0) {
          c.magnitude = vectorMagnitude(c.vector);
        }
      }
    } catch {
      console.warn("[EMBED] Corrupt store, rebuilding...");
    }
  }

  // Build hash index of existing chunks for O(1) dedup
  const existingByHash = new Map<string, EmbeddingChunk>();
  for (const c of store.chunks) {
    existingByHash.set(c.hash, c);
  }

  // Scan vault for .md files in configured folders
  const files = await findMarkdownFiles(vaultPath);
  let embedded = 0;
  let skipped = 0;
  const newChunks: EmbeddingChunk[] = [];

  for (const file of files) {
    const fullPath = path.join(vaultPath, file);
    let content: string;
    try {
      content = await Bun.file(fullPath).text();
    } catch {
      continue;
    }

    // Skip frontmatter-only files
    if (content.trim().length < 50) continue;

    const chunks = chunkMarkdown(content, file);
    const metadata = extractMetadata(content, file);

    let concurrency = resolveEmbedConcurrency(process.env.EMBED_CONCURRENCY);
    const chunksToEmbed: Array<{ chunk: { heading: string; text: string }; hash: string }> = [];

    for (const chunk of chunks) {
      const hash = hashContent(chunk.text);

      const existing = existingByHash.get(hash);
      if (existing) {
        // Reuse the vector, but never reuse provenance (file/heading/updatedAt).
        // Identical text can exist in multiple files; search provenance must remain accurate.
        newChunks.push({
          file,
          heading: chunk.heading,
          text: chunk.text.slice(0, 500),
          hash,
          vector: existing.vector,
          magnitude: existing.magnitude ?? vectorMagnitude(existing.vector),
          updatedAt: new Date().toISOString(),
          metadata,
        });
        skipped++;
        continue;
      }

      chunksToEmbed.push({ chunk, hash });
    }

    // Embed new chunks in bounded-concurrency batches (Ollama-friendly + adaptive backoff).
    for (let i = 0; i < chunksToEmbed.length; i += concurrency) {
      const batch = chunksToEmbed.slice(i, i + concurrency);
      let backoff = false;
      await Promise.all(batch.map(async ({ chunk, hash }) => {
        try {
          const vector = await embedText(chunk.text, ollamaUrl);
          newChunks.push({
            file,
            heading: chunk.heading,
            text: chunk.text.slice(0, 500), // store truncated for space
            hash,
            vector,
            magnitude: vectorMagnitude(vector),
            updatedAt: new Date().toISOString(),
            metadata,
          });
          embedded++;
        } catch (err) {
          console.warn(`[EMBED] Failed to embed chunk from ${file}:`, err);
          if (shouldBackoffEmbeddingError(err)) backoff = true;
        }
      }));
      if (backoff && concurrency > 1) {
        concurrency = Math.max(1, Math.floor(concurrency / 2));
      }
    }
  }

  store.chunks = newChunks;
  store.lastFullScan = new Date().toISOString();
  store.dirty = false; // just persisted

  // Persist atomically (prevents partial/corrupt json)
  await atomicWriteJson(vaultPath, storeAbs, store, 0);

  console.log(`[EMBED] Sync complete: ${embedded} new, ${skipped} cached, ${store.chunks.length} total`);
  return store;
}

/**
 * Embed a single file (for incremental updates via watcher).
 */
export async function embedSingleFile(
  vaultPath: string,
  relPath: string,
  store: EmbeddingStore,
  storePath: string,
  ollamaUrl: string = "http://localhost:11434",
): Promise<void> {
  const { abs: storeAbs } = resolveVaultPath(vaultPath, storePath);
  const fullPath = path.join(vaultPath, relPath);
  // Remove old chunks for this file
  store.chunks = store.chunks.filter((c) => c.file !== relPath);

  // If file is missing/unreadable/too short, persist cleanup and stop.
  let content: string;
  try {
    content = await Bun.file(fullPath).text();
  } catch {
    store.dirty = true;
    await atomicWriteJson(vaultPath, storeAbs, store, 0);
    store.dirty = false;
    return;
  }

  if (content.trim().length < 50) {
    store.dirty = true;
    await atomicWriteJson(vaultPath, storeAbs, store, 0);
    store.dirty = false;
    return;
  }

  // Chunk and embed
  const chunks = chunkMarkdown(content, relPath);
  const metadata = extractMetadata(content, relPath);
  let concurrency = resolveEmbedConcurrency(process.env.EMBED_CONCURRENCY);

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    let backoff = false;
    await Promise.all(batch.map(async (chunk) => {
      try {
        const vector = await embedText(chunk.text, ollamaUrl);
        store.chunks.push({
          file: relPath,
          heading: chunk.heading,
          text: chunk.text.slice(0, 500),
          hash: hashContent(chunk.text),
          vector,
          magnitude: vectorMagnitude(vector),
          updatedAt: new Date().toISOString(),
          metadata,
        });
      } catch {
        // Skip failed chunks
        backoff = true;
      }
    }));
    if (backoff && concurrency > 1) {
      concurrency = Math.max(1, Math.floor(concurrency / 2));
    }
  }

  // Persist atomically via Bun.write
  store.dirty = true;
  await atomicWriteJson(vaultPath, storeAbs, store, 0);
  store.dirty = false;
}

/**
 * Remove all chunks belonging to a file and persist the store.
 * Used for live watcher unlink/delete events.
 */
export async function removeFileEmbeddings(
  vaultPath: string,
  relPath: string,
  store: EmbeddingStore,
  storePath: string,
): Promise<void> {
  const { abs: storeAbs } = resolveVaultPath(vaultPath, storePath);
  const before = store.chunks.length;
  store.chunks = store.chunks.filter((c) => c.file !== relPath);
  if (store.chunks.length === before) return;
  store.dirty = true;
  await atomicWriteJson(vaultPath, storeAbs, store, 0);
  store.dirty = false;
}

// ── Helpers ────────────────────────────────────────────────────────

async function findMarkdownFiles(vaultPath: string): Promise<string[]> {
  const files: string[] = [];

  for (const folder of EMBED_FOLDERS) {
    const folderPath = path.join(vaultPath, folder);
    if (!existsSync(folderPath)) continue;
    await scanDir(folderPath, vaultPath, files);
  }

  return files;
}

async function scanDir(dir: string, root: string, out: string[]): Promise<void> {
  try {
    const dh = await fsp.opendir(dir);
    for await (const entry of dh) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await scanDir(full, root, out);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(path.relative(root, full));
      }
    }
  } catch {
    // Skip unreadable dirs
  }
}
