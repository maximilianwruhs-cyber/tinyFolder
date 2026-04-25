import { afterEach, describe, expect, test } from "bun:test";
import type { EmbeddingStore } from "../embeddings";
import { bm25SearchVault, buildBm25Index } from "../bm25";
import { searchVaultHybrid } from "../search";
import { compileEvidencePacket, renderEvidencePacket } from "../evidence_packet";
import { verifySafety } from "../verifier_safety";
import { gatherVaultStateIndex } from "../vault_state_index";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function storeFixture(): EmbeddingStore {
  const now = new Date().toISOString();
  return {
    modelName: "test-embed",
    lastFullScan: now,
    dirty: false,
    chunks: [
      {
        file: "wiki/entities/GZMO-Ops-Outputs.md",
        heading: "Outputs",
        text: "TELEMETRY.json health.md embeddings.json",
        hash: "a",
        vector: [1, 0],
        magnitude: 1,
        updatedAt: now,
        metadata: { pathBucket: "wiki", type: "entity", role: "canonical", tags: ["ops"] },
      },
      {
        file: "wiki/index.md",
        heading: "Index",
        text: "broad index page",
        hash: "b",
        vector: [1, 0],
        magnitude: 1,
        updatedAt: now,
        metadata: { pathBucket: "wiki", type: "index", role: "operational", retrievalPriority: "low", tags: ["index"] },
      },
      {
        file: "wiki/topics/telemetry.md",
        heading: "Telemetry",
        text: "The daemon writes TELEMETRY.json under vault/GZMO.",
        hash: "c",
        vector: [0.9, 0.1],
        magnitude: Math.sqrt(0.82),
        updatedAt: now,
        metadata: { pathBucket: "wiki", type: "topic", role: "canonical", tags: ["telemetry"] },
      },
    ],
  };
}

describe("max finesse pack", () => {
  test("bm25SearchVault finds exact/path-like terms without network", () => {
    const store = storeFixture();
    const results = bm25SearchVault("Where is TELEMETRY.json written?", store, buildBm25Index(store), { topK: 2, perFileLimit: 1 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.file)).toContain("wiki/entities/GZMO-Ops-Outputs.md");
  });

  test("searchVaultHybrid merges vector+lexical and diversifies files", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 })) as unknown as typeof fetch;
    const store = storeFixture();
    const results = await searchVaultHybrid("telemetry json path", store, "http://example.invalid", { topK: 2, perFileLimit: 1 });
    expect(results.length).toBe(2);
    expect(new Set(results.map((r) => r.file)).size).toBe(2);
    // index should be strongly dampened
    expect(results.map((r) => r.file)).not.toContain("wiki/index.md");
  });

  test("evidence packet renders snippet IDs and allowedPaths", () => {
    const packet = compileEvidencePacket({
      localFacts: "Local Facts (deterministic)\n- telemetry: `vault/GZMO/TELEMETRY.json`",
      results: [
        { file: "wiki/entities/GZMO-Ops-Outputs.md", heading: "Outputs", text: "TELEMETRY.json", score: 0.9 },
      ],
      maxSnippets: 5,
    });
    const rendered = renderEvidencePacket(packet);
    expect(rendered).toContain("## Evidence Packet");
    expect(rendered).toContain("[E1]");
    expect(rendered).toContain("[E2]");
    expect(packet.allowedPaths).toContain("wiki/entities/GZMO-Ops-Outputs.md");
  });

  test("safety verifier blocks invented paths not in evidence", () => {
    const packet = compileEvidencePacket({
      localFacts: "",
      results: [{ file: "wiki/entities/GZMO-Ops-Outputs.md", heading: "Outputs", text: "TELEMETRY.json", score: 0.9 }],
      maxSnippets: 3,
    });
    const verdict = verifySafety({
      answer: "It is written to `vault/GZMO/NOT_REAL.json`.",
      packet,
    });
    expect(verdict).toContain("not present in evidence");
  });

  test("vault state index lists canonical output paths deterministically", async () => {
    const vault = mkdtempSync(join(tmpdir(), "gzmo-vault-state-"));
    try {
      mkdirSync(join(vault, "GZMO"), { recursive: true });
      writeFileSync(join(vault, "GZMO", "TELEMETRY.json"), "{}");
      const index = await gatherVaultStateIndex({ vaultPath: vault, query: "where is telemetry written?" });
      expect(index).toContain("Vault State Index");
      expect(index).toContain("TELEMETRY.json");
      expect(index).toContain("GZMO-Ops-Outputs.md");
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});

