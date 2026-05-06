/**
 * One-shot: sync Reasoning_Traces into GZMO/embeddings.json (requires Ollama embeddings).
 * Usage: VAULT_PATH=/abs/path/to/vault bun run src/learning/sync_traces_cli.ts
 */

import { resolve, join } from "path";
import { readFile } from "fs/promises";
import type { EmbeddingStore } from "../embeddings";
import { syncTracesIntoStore } from "./sync_traces";
import { atomicWriteJson } from "../vault_fs";
import { invalidateEmbeddingSearchCache } from "../search";

async function main() {
  const vault = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../../../vault");
  const storePath = join(vault, "GZMO", "embeddings.json");
  const ollama = process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434";

  const raw = await readFile(storePath, "utf-8").catch(() => "");
  if (!raw) {
    console.error(`Missing or empty embeddings store: ${storePath}`);
    process.exit(1);
  }
  const store = JSON.parse(raw) as EmbeddingStore;
  const added = await syncTracesIntoStore(vault, store, ollama);
  if (added > 0) {
    invalidateEmbeddingSearchCache(store);
    await atomicWriteJson(vault, "GZMO/embeddings.json", store, 0);
    store.dirty = false;
  }
  console.log(JSON.stringify({ ok: true, added }, null, 2));
}

if (import.meta.main) void main();
