/**
 * Sync reasoning traces into the embedding store (trace memory).
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { EmbeddingStore, EmbeddingChunk } from "../embeddings";
import { traceToChunks } from "./trace_chunks";
import type { ReasoningTrace } from "../reasoning_trace";

function getMagnitude(vec: number[]): number {
  let s = 0;
  for (const v of vec) s += v * v;
  return Math.sqrt(s);
}

export async function syncTracesIntoStore(
  vaultPath: string,
  store: EmbeddingStore,
  ollamaUrl: string,
): Promise<number> {
  const tracesDir = join(vaultPath, "GZMO", "Reasoning_Traces");
  const files = await readdir(tracesDir).catch(() => [] as string[]);

  let added = 0;
  const existingHashes = new Set(store.chunks.map((c) => c.hash));

  const base = ollamaUrl.replace(/\/v1$/, "").replace(/\/$/, "");
  const embedModel = store.modelName || "nomic-embed-text";

  for (const f of files) {
    if (!f.endsWith(".json") || f === "index.jsonl") continue;
    try {
      const raw = await readFile(join(tracesDir, f), "utf-8");
      const trace = JSON.parse(raw) as ReasoningTrace;
      const chunks = traceToChunks(trace);
      for (const chunk of chunks) {
        if (existingHashes.has(chunk.hash)) continue;

        const resp = await fetch(`${base}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: embedModel, prompt: chunk.text.slice(0, 2000) }),
        });
        if (!resp.ok) continue;
        const data = (await resp.json()) as { embedding: number[] };
        const embedding = data.embedding;
        if (!embedding?.length) continue;

        const mag = getMagnitude(embedding);

        const row: EmbeddingChunk = {
          file: chunk.file,
          heading: chunk.heading,
          text: chunk.text,
          hash: chunk.hash,
          vector: embedding,
          magnitude: mag,
          updatedAt: new Date().toISOString(),
          metadata: {
            pathBucket: chunk.metadata.pathBucket,
            type: chunk.metadata.type,
            role: chunk.metadata.role,
            tags: chunk.metadata.tags,
            status: chunk.metadata.status,
            task_type: chunk.metadata.task_type,
          },
        };
        store.chunks.push(row);
        existingHashes.add(chunk.hash);
        added++;
      }
    } catch {
      continue;
    }
  }

  if (added > 0) store.dirty = true;
  if (added > 0) console.log(`[EMBEDDINGS] Synced ${added} trace chunks into store`);
  return added;
}
