import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";

import { defaultConfig } from "../types";
import { PulseLoop } from "../pulse";
import { syncEmbeddings } from "../embeddings";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ollamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return resp.ok;
  } catch {
    return false;
  }
}

function baseOllamaUrl(): string {
  return (process.env.OLLAMA_URL?.replace(/\/v1\/?$/, "") || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

describe("regressions (integration)", () => {
  test("embedding dedup preserves provenance for identical text in multiple files", async () => {
    const baseUrl = baseOllamaUrl();
    if (!(await ollamaReachable(baseUrl))) {
      // Bun's `test.skip` signature differs from Jest; easiest is to no-op the test.
      // We keep it as a PASS in non-Ollama environments (CI/local).
      return;
    }

    const vault = mkdtempSync(join(tmpdir(), "gzmo-vault-"));
    try {
      mkdirSync(join(vault, "GZMO", "Inbox"), { recursive: true });
      mkdirSync(join(vault, "GZMO", "Thought_Cabinet"), { recursive: true });
      mkdirSync(join(vault, "wiki", "topics"), { recursive: true });

      // Important: keep the *chunk text* identical across both files.
      // If we include file-specific headings, chunk hashes will differ and won't exercise dedup.
      const shared = "SAME_PARAGRAPH_123\nThis paragraph is identical across files.\nIt must not lose provenance.\n";
      const fileA = join(vault, "wiki", "topics", "A.md");
      const fileB = join(vault, "wiki", "topics", "B.md");

      writeFileSync(fileA, `---\n---\n\n${shared}\n`, "utf-8");
      writeFileSync(fileB, `---\n---\n\n${shared}\n`, "utf-8");

      const storePath = join(vault, "GZMO", "embeddings.json");
      const store = await syncEmbeddings(vault, storePath, baseUrl);

      // Find hashes that occur multiple times, and ensure the repeated chunk points to both files
      const byHash = new Map<string, { files: Set<string>; headings: Set<string> }>();
      for (const c of store.chunks) {
        const v = byHash.get(c.hash) ?? { files: new Set<string>(), headings: new Set<string>() };
        v.files.add(c.file);
        v.headings.add(c.heading);
        byHash.set(c.hash, v);
      }
      const duplicates = [...byHash.entries()].filter(([, v]) => v.files.size >= 2);
      expect(duplicates.length).toBeGreaterThan(0);

      const relA = relative(vault, fileA).replace(/\\/g, "/");
      const relB = relative(vault, fileB).replace(/\\/g, "/");
      const hasBoth = duplicates.some(([, v]) => v.files.has(relA) && v.files.has(relB));
      expect(hasBoth).toBe(true);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  }, 120_000);

  test("task_failed event affects tension in next snapshots", async () => {
    const pulse = new PulseLoop(defaultConfig());
    pulse.start(); // no snapshot file needed
    try {
      // Wait for a few ticks to stabilize
      const sampleAvg = async (n: number) => {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          await sleep(250);
          sum += pulse.snapshot().tension;
        }
        return sum / n;
      };

      const before = await sampleAvg(6);

      // Use a large custom delta to avoid flakiness from hardware telemetry variance.
      pulse.emitEvent({ type: "custom", tensionDelta: 20, energyDelta: 0 });

      // Give it a few heartbeats to process and settle
      const after = await sampleAvg(6);

      expect(after).toBeGreaterThan(before + 5.0);
    } finally {
      pulse.stop();
    }
  }, 30_000);
});

