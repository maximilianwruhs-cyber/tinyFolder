/**
 * embeddings.ts — Local Embedding Pipeline
 *
 * Embeds vault markdown files using nomic-embed-text via Ollama.
 * SHA256 dedup prevents re-embedding unchanged content.
 * Debounced file watching for live vault sync.
 *
 * Source: Local RAG notebook (NotebookLM)
 */

import { existsSync, readdirSync } from "fs";
import * as path from "path";
import * as crypto from "crypto";
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
    throw new Error(`Embedding failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as { embedding: number[] };
  return data.embedding;
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
  const files = findMarkdownFiles(vaultPath);
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
        });
        skipped++;
        continue;
      }

      // Embed new chunk
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
        });
        embedded++;
      } catch (err) {
        console.warn(`[EMBED] Failed to embed chunk from ${file}:`, err);
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
  for (const chunk of chunks) {
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
      });
    } catch {
      // Skip failed chunks
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

function findMarkdownFiles(vaultPath: string): string[] {
  const files: string[] = [];

  for (const folder of EMBED_FOLDERS) {
    const folderPath = path.join(vaultPath, folder);
    if (!existsSync(folderPath)) continue;
    scanDir(folderPath, vaultPath, files);
  }

  return files;
}

function scanDir(dir: string, root: string, out: string[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        scanDir(full, root, out);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(path.relative(root, full));
      }
    }
  } catch {
    // Skip unreadable dirs
  }
}
