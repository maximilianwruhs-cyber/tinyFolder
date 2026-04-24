import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { searchVault, formatSearchContext } from "../search";
import type { EmbeddingStore, EmbeddingChunk } from "../embeddings";

// Global fetch mock setup
const originalFetch = globalThis.fetch;

describe("searchVault", () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    globalThis.fetch = mock() as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns empty array for empty store", async () => {
    const store: EmbeddingStore = {
      modelName: "test-model",
      chunks: [],
      lastFullScan: "",
      dirty: false,
    };

    const results = await searchVault("test query", store);
    expect(results).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("returns empty array when ollama fetch fails", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    const store: EmbeddingStore = {
      modelName: "test-model",
      chunks: [
        { file: "a.md", heading: "H1", text: "text", hash: "1", vector: [1, 0], magnitude: 1, updatedAt: "" }
      ],
      lastFullScan: "",
      dirty: false,
    };

    const results = await searchVault("test query", store);
    expect(results).toEqual([]);
  });

  test("performs cosine similarity search and ranks results", async () => {
    // Query vector: [1, 0, 0]
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [1, 0, 0] })
    });

    const store: EmbeddingStore = {
      modelName: "test-model",
      chunks: [
        // Perfect match (cosine similarity = 1)
        { file: "perfect.md", heading: "H1", text: "perfect", hash: "1", vector: [1, 0, 0], magnitude: 1, updatedAt: "" },
        // Orthogonal (cosine similarity = 0) -> will be filtered out due to MIN_RELEVANCE (0.3)
        { file: "orthogonal.md", heading: "H1", text: "orthogonal", hash: "2", vector: [0, 1, 0], magnitude: 1, updatedAt: "" },
        // Partial match (cosine similarity = 0.5)
        { file: "partial.md", heading: "H1", text: "partial", hash: "3", vector: [0.5, 0.866, 0], magnitude: 1, updatedAt: "" },
      ],
      lastFullScan: "",
      dirty: false,
    };

    const results = await searchVault("test query", store, "http://localhost:11434", 2);

    expect(results.length).toBe(2);

    // First result should be perfect match
    expect(results[0]!.file).toBe("perfect.md");
    expect(results[0]!.score).toBeCloseTo(1.0);

    // Second result should be partial match
    expect(results[1]!.file).toBe("partial.md");
    expect(results[1]!.score).toBeCloseTo(0.5);
  });

  test("computes magnitude dynamically if missing from chunk", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0, 1, 0] })
    });

    const store: EmbeddingStore = {
      modelName: "test-model",
      chunks: [
        // Exact match but missing magnitude (legacy data)
        { file: "legacy.md", heading: "H1", text: "legacy", hash: "1", vector: [0, 1, 0], magnitude: 0, updatedAt: "" } as any
      ],
      lastFullScan: "",
      dirty: false,
    };

    const results = await searchVault("test query", store);
    expect(results.length).toBe(1);
    expect(results[0]!.file).toBe("legacy.md");
    expect(results[0]!.score).toBeCloseTo(1.0);
  });
});

describe("formatSearchContext", () => {
  test("returns empty string for empty results", () => {
    expect(formatSearchContext([])).toBe("");
  });

  test("formats results correctly", () => {
    const results = [
      { file: "file1.md", heading: "Header 1", text: "This is the text.", score: 0.95 },
      { file: "file2.md", heading: "Header 2", text: "More text.", score: 0.543 }
    ];

    const formatted = formatSearchContext(results);

    expect(formatted).toContain("## Relevant Vault Context");
    expect(formatted).toContain("[1] file1.md — Header 1 (95%):\nThis is the text.");
    expect(formatted).toContain("[2] file2.md — Header 2 (54%):\nMore text.");
  });
});
