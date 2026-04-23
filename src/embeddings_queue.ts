import type { EmbeddingStore } from "./embeddings";
import { embedSingleFile, removeFileEmbeddings, syncEmbeddings } from "./embeddings";

type Job =
  | { kind: "upsert"; relPath: string }
  | { kind: "remove"; relPath: string };

export class EmbeddingsQueue {
  private store: EmbeddingStore | undefined;
  private running = false;
  private readonly queue: Job[] = [];
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly vaultPath: string,
    private readonly storePath: string,
    private readonly ollamaUrl: string,
  ) {}

  /**
   * Full scan + sync. This must be called before enqueuing mutations.
   * Owns the store thereafter.
   */
  async initByFullSync(): Promise<EmbeddingStore> {
    this.store = await syncEmbeddings(this.vaultPath, this.storePath, this.ollamaUrl);
    return this.store;
  }

  getStore(): EmbeddingStore | undefined {
    return this.store;
  }

  enqueueUpsertFile(relPath: string): void {
    if (!this.store) return;
    this.queue.push({ kind: "upsert", relPath });
    void this.drain();
  }

  enqueueRemoveFile(relPath: string): void {
    if (!this.store) return;
    this.queue.push({ kind: "remove", relPath });
    void this.drain();
  }

  async whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    if (!this.store) return;
    this.running = true;

    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        if (!this.store) return;

        if (job.kind === "upsert") {
          await embedSingleFile(this.vaultPath, job.relPath, this.store, this.storePath, this.ollamaUrl);
        } else {
          await removeFileEmbeddings(this.vaultPath, job.relPath, this.store, this.storePath);
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length === 0 && this.idleResolvers.length > 0) {
        const resolvers = this.idleResolvers;
        this.idleResolvers = [];
        for (const r of resolvers) r();
      }
    }
  }
}

