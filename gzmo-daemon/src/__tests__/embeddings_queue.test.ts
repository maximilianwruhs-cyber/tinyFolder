import { expect, test, describe } from "bun:test";
import { EmbeddingsQueue } from "../embeddings_queue";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("EmbeddingsQueue", () => {
  test("serialized writes via whenIdle", async () => {
    const vault = join(tmpdir(), `gzmo-test-${Date.now()}`);
    mkdirSync(join(vault, "GZMO"), { recursive: true });
    mkdirSync(join(vault, "wiki"), { recursive: true });

    const storePath = join(vault, "GZMO", "embeddings.json");
    // Mock store
    const initialStore = { modelName: "test", chunks: [], lastFullScan: "", dirty: false };
    writeFileSync(storePath, JSON.stringify(initialStore));

    const q = new EmbeddingsQueue(vault, storePath, "http://localhost:11434");

    // We can't easily test actual embedding without Ollama, but we can test the queue logic
    // if we mock the underlying functions or just check for race conditions if they were real.
    // Given the current structure, we'll just verify it doesn't crash and handles the state.

    // @ts-ignore
    q.store = initialStore;

    q.enqueueUpsertFile("wiki/test.md");
    q.enqueueRemoveFile("wiki/test.md");

    await q.whenIdle();
    // @ts-ignore
    expect(q.running).toBe(false);
    // @ts-ignore
    expect(q.queue.length).toBe(0);

    rmSync(vault, { recursive: true, force: true });
  });
});
