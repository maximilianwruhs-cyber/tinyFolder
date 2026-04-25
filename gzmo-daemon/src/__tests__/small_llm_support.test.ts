import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { verifyAnchors } from "../anchor_verifier";
import { parseTypedNextAction } from "../auto_tasks";
import { syncEmbeddings, type EmbeddingStore } from "../embeddings";
import { formatSearchContext, resolveWikiLink, searchVault } from "../search";
import { parseStructuredDreamReflection } from "../structured";
import { writeHealth } from "../health";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("small LLM support mechanisms", () => {
  test("parses strict JSON dream reflection and typed next actions", () => {
    const parsed = parseStructuredDreamReflection(JSON.stringify({
      summary: "The task established a concrete daemon invariant.",
      evidence: ["Task request: exact invariant"],
      delta: "A new invariant can be checked.",
      missing: ["No runtime log was provided."],
      superfluous: ["The model mentioned an unsupported cloud backup."],
      claims: ["The daemon writes health status."],
      anchors: ["exact invariant"],
      nextActions: [{ type: "verify", title: "Check health output includes telemetry" }],
      confidence: 0.8,
      unverifiedClaims: [],
    }));

    expect(parsed?.nextActions[0]?.type).toBe("verify");
    expect(parsed?.superfluous).toContain("The model mentioned an unsupported cloud backup.");
    expect(parseTypedNextAction(JSON.stringify({ nextActions: [{ type: "maintenance", title: "Review schema drift" }] }))).toEqual({
      type: "maintenance",
      title: "Review schema drift",
    });
  });

  test("verifies anchors by exact text restoration", () => {
    const results = verifyAnchors(
      ["literal anchor span", "missing anchor span"],
      [{ label: "Task request", text: "The task contains a literal anchor span for checking." }],
    );

    expect(results.find((result) => result.anchor === "literal anchor span")?.verified).toBe(true);
    expect(results.find((result) => result.anchor === "missing anchor span")?.verified).toBe(false);
  });

  test("searchVault applies metadata filters before vector ranking", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 })) as unknown as typeof fetch;
    const store: EmbeddingStore = {
      modelName: "test-embed",
      lastFullScan: new Date().toISOString(),
      dirty: false,
      chunks: [
        {
          file: "wiki/entities/GZMO.md",
          heading: "GZMO",
          text: "architecture match",
          hash: "a",
          vector: [1, 0],
          magnitude: 1,
          updatedAt: new Date().toISOString(),
          metadata: { pathBucket: "wiki", type: "entity", role: "canonical", tags: ["architecture"] },
        },
        {
          file: "wiki/topics/Linux.md",
          heading: "Linux",
          text: "wrong type",
          hash: "b",
          vector: [1, 0],
          magnitude: 1,
          updatedAt: new Date().toISOString(),
          metadata: { pathBucket: "wiki", type: "topic", tags: ["architecture"] },
        },
      ],
    };

    const results = await searchVault("type:entity tag:architecture GZMO", store, "http://example.invalid", {
      topK: 5,
      filters: { types: ["entity"], tags: ["architecture"] },
    });

    expect(results.map((result) => result.file)).toEqual(["wiki/entities/GZMO.md"]);
    expect(formatSearchContext(results)).toContain("Metadata: type=entity; role=canonical; tags=architecture");
  });

  test("resolveWikiLink prefers path-qualified links and rejects ambiguous basenames", () => {
    const index = new Map<string, string | string[]>([
      ["index", ["wiki/index.md", "wiki/dreams/index.md"]],
      ["wiki/index", "wiki/index.md"],
      ["dreams/index", "wiki/dreams/index.md"],
      ["wiki/dreams/index", "wiki/dreams/index.md"],
      ["gzmo", "wiki/entities/GZMO.md"],
    ]);

    expect(resolveWikiLink("wiki/index", index)).toBe("wiki/index.md");
    expect(resolveWikiLink("dreams/index", index)).toBe("wiki/dreams/index.md");
    expect(resolveWikiLink("index", index)).toBeNull();
    expect(resolveWikiLink("GZMO", index)).toBe("wiki/entities/GZMO.md");
  });

  test("searchVault diversifies files and applies small-LLM retrieval priors", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 })) as unknown as typeof fetch;
    const now = new Date().toISOString();
    const store: EmbeddingStore = {
      modelName: "test-embed",
      lastFullScan: now,
      dirty: false,
      chunks: [
        {
          file: "wiki/log.md",
          heading: "Log A",
          text: "log exact match a",
          hash: "log-a",
          vector: [1, 0],
          magnitude: 1,
          updatedAt: now,
          metadata: { pathBucket: "wiki", type: "log", role: "operational", retrievalPriority: "low", tags: ["log"] },
        },
        {
          file: "wiki/log.md",
          heading: "Log B",
          text: "log exact match b",
          hash: "log-b",
          vector: [1, 0],
          magnitude: 1,
          updatedAt: now,
          metadata: { pathBucket: "wiki", type: "log", role: "operational", retrievalPriority: "low", tags: ["log"] },
        },
        {
          file: "wiki/entities/GZMO.md",
          heading: "GZMO",
          text: "canonical close match",
          hash: "gzmo",
          vector: [0.9, 0.1],
          magnitude: Math.sqrt(0.82),
          updatedAt: now,
          metadata: { pathBucket: "wiki", type: "entity", role: "canonical", tags: ["gzmo"] },
        },
      ],
    };

    const results = await searchVault("GZMO log", store, "http://example.invalid", { topK: 2, perFileLimit: 1 });

    expect(results.map((result) => result.file)).toEqual(["wiki/entities/GZMO.md", "wiki/log.md"]);
  });

  test("searchVault dampens broad indexes and boosts hardware profile", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 })) as unknown as typeof fetch;
    const now = new Date().toISOString();
    const store: EmbeddingStore = {
      modelName: "test-embed",
      lastFullScan: now,
      dirty: false,
      chunks: [
        {
          file: "wiki/topics/Linux-Workstation.md",
          heading: "Paths",
          text: "hardware path",
          hash: "linux",
          vector: [0.5, 0.5],
          magnitude: Math.sqrt(0.5),
          updatedAt: now,
          metadata: { pathBucket: "wiki", type: "topic", role: "canonical", tags: ["linux"] },
        },
        {
          file: "wiki/entities/GZMO-Hardware-Profile.md",
          heading: "Current Hardware And Paths",
          text: "hardware path",
          hash: "hardware",
          vector: [0.95, 0.05],
          magnitude: Math.sqrt(0.905),
          updatedAt: now,
          metadata: { pathBucket: "wiki", type: "entity", role: "canonical", tags: ["hardware"] },
        },
        {
          file: "wiki/index.md",
          heading: "Index",
          text: "hardware path",
          hash: "index",
          vector: [1, 0],
          magnitude: 1,
          updatedAt: now,
          metadata: { pathBucket: "wiki", type: "index", role: "operational", retrievalPriority: "low", tags: ["index"] },
        },
      ],
    };

    const results = await searchVault("GZMO hardware path", store, "http://example.invalid", { topK: 3, perFileLimit: 1 });

    expect(results[0]?.file).toBe("wiki/entities/GZMO-Hardware-Profile.md");
    expect(results.map((result) => result.file)).not.toContain("wiki/index.md");
  });

  test("syncEmbeddings applies folder-level metadata defaults", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 })) as unknown as typeof fetch;
    const vault = mkdtempSync(join(tmpdir(), "gzmo-embeddings-defaults-"));
    try {
      mkdirSync(join(vault, "GZMO", "Thought_Cabinet"), { recursive: true });
      mkdirSync(join(vault, "GZMO", "Inbox"), { recursive: true });
      writeFileSync(join(vault, "GZMO", "Thought_Cabinet", "note.md"), "# Generated Note\n\nThis generated thought cabinet note is long enough to embed as a test chunk.");
      writeFileSync(join(vault, "GZMO", "Inbox", "task.md"), "# Inbox Task\n\nThis inbox task is long enough to embed as an operational task chunk.");

      const store = await syncEmbeddings(vault, join(vault, "GZMO", "embeddings.json"), "http://example.invalid");
      const thought = store.chunks.find((chunk) => chunk.file === "GZMO/Thought_Cabinet/note.md");
      const inbox = store.chunks.find((chunk) => chunk.file === "GZMO/Inbox/task.md");

      expect(thought?.metadata?.role).toBe("generated");
      expect(thought?.metadata?.retrievalPriority).toBe("low");
      expect(thought?.metadata?.tags).toContain("thought-cabinet");
      expect(inbox?.metadata?.role).toBe("operational");
      expect(inbox?.metadata?.type).toBe("task");
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("writeHealth emits compact telemetry JSON", async () => {
    const vault = mkdtempSync(join(tmpdir(), "gzmo-health-"));
    try {
      await writeHealth({
        vaultPath: vault,
        profile: "full",
        ollamaUrl: "http://localhost:11434",
        model: "tiny-test",
        pulse: {
          tension: 12.3,
          energy: 88,
          phase: "Idle",
          alive: true,
          deaths: 0,
          tick: 42,
          thoughtsIncubating: 1,
          thoughtsCrystallized: 2,
          llmTemperature: 0.4,
          llmMaxTokens: 512,
          llmValence: -0.1,
        },
        scheduler: {
          dreamsEnabled: true,
          selfAskEnabled: true,
          wikiEnabled: true,
          ingestEnabled: true,
          wikiLintEnabled: true,
          pruningEnabled: true,
          embeddingsLiveEnabled: true,
        },
        counts: {
          inboxPending: 0,
          inboxProcessing: 0,
          inboxCompleted: 1,
          inboxFailed: 0,
          cabinetNotes: 2,
          quarantineNotes: 0,
        },
      });

      const telemetry = await Bun.file(join(vault, "GZMO", "TELEMETRY.json")).json();
      expect(telemetry.runtime.inference.maxTokens).toBe(512);
      expect(telemetry.workload.inbox.completed).toBe(1);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
