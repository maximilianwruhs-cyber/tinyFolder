import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { extractMemoryArtifactHints } from "../memory";
import { formatRetrievalContextHint } from "../retrieval_context_hint";
import { ThinkPipeline } from "../pipelines/think_pipeline";
import { defaultEngineHooks } from "../engine_hooks";
import { compileEvidencePacket, renderEvidencePacket } from "../evidence_packet";
import type { EmbeddingStore } from "../embeddings";
import { TaskDocument } from "../frontmatter";
import { autonomyBudgetAllows, autonomyBudgetConsume, readBudgetDigest } from "../autonomy_budget";

describe("excellence roadmap — memory + retrieval docs", () => {
  test("extractMemoryArtifactHints finds markdown paths", () => {
    expect(
      extractMemoryArtifactHints(
        "See `GZMO/health.md` and wiki/overview.md for telemetry; also GZMO/Inbox/x.md",
      ),
    ).toEqual(["GZMO/health.md", "wiki/overview.md", "GZMO/Inbox/x.md"]);
  });

  test("formatRetrievalContextHint explains context vs injection knobs", () => {
    const hint = formatRetrievalContextHint();
    expect(hint).toContain("GZMO_TOPK=");
    expect(hint).toContain("Evidence Packet");
  });
});

describe("excellence roadmap — evidence citations", () => {
  test("compileEvidencePacket assigns E# ids for retrieval regression", () => {
    const packet = compileEvidencePacket({
      localFacts: "",
      results: [
        {
          file: "GZMO/sample.md",
          heading: "H",
          text: "GZMO TELEMETRY lives here.",
          score: 0.9,
        },
      ],
      maxSnippets: 4,
      maxSnippetChars: 200,
    });
    const r = renderEvidencePacket(packet);
    expect(r).toMatch(/\[E1\]/);
    expect(packet.allowedPaths).toContain("GZMO/sample.md");
  });
});

describe("ThinkPipeline retrieval (light tier)", () => {
  const prevThink = process.env.GZMO_THINK_RETRIEVAL;
  const prevClarify = process.env.GZMO_ENABLE_THINK_CLARIFY;
  let tmp = "";

  afterEach(() => {
    process.env.GZMO_THINK_RETRIEVAL = prevThink;
    process.env.GZMO_ENABLE_THINK_CLARIFY = prevClarify;
    delete (globalThis as { __GZMO_TEST_FETCH?: typeof fetch }).__GZMO_TEST_FETCH;
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = "";
    }
  });

  test("injects Evidence Packet when grounding heuristics match", async () => {
    process.env.GZMO_THINK_RETRIEVAL = "light";
    process.env.GZMO_ENABLE_THINK_CLARIFY = "false";
    tmp = join(tmpdir(), `gzmo-excell-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(tmp, "GZMO", "Inbox"), { recursive: true });

    const taskPath = join(tmp, "GZMO", "Inbox", "think_test.md");
    await Bun.write(
      taskPath,
      ["---", "status: pending", "action: think", "---", "", "According to our wiki vault, where is TELEMETRY.json?"].join("\n"),
    );
    const doc = await TaskDocument.load(taskPath);
    expect(doc).toBeTruthy();

    const store: EmbeddingStore = {
      modelName: "nomic-embed-text",
      chunks: [
        {
          file: "GZMO/guide.md",
          heading: "Ops",
          text: "The daemon writes GZMO/TELEMETRY.json for compact telemetry snapshots.",
          hash: "h1",
          vector: [1, 0, 0, 0],
          magnitude: 1,
          updatedAt: new Date().toISOString(),
          metadata: { pathBucket: "gzmo", tags: [] },
        },
      ],
      lastFullScan: new Date().toISOString(),
      dirty: false,
    };

    const embedFetchStub = async (input: string | URL | Request): Promise<Response> => {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (u.includes("/api/embeddings")) {
        return new Response(JSON.stringify({ embedding: [1, 0, 0, 0] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not mocked", { status: 502 });
    };

    (globalThis as { __GZMO_TEST_FETCH?: typeof fetch }).__GZMO_TEST_FETCH = embedFetchStub as unknown as typeof fetch;

    const pl = new ThinkPipeline();
    const ctx = await pl.prepare({
      event: {
        filePath: taskPath,
        fileName: "think_test.md",
        status: "pending",
        body: "According to our wiki vault, where is TELEMETRY.json?",
        frontmatter: { status: "pending", action: "think" },
        document: doc!,
      },
      vaultRoot: tmp,
      embeddingStore: store,
      memory: undefined,
      pulse: undefined,
      hooks: defaultEngineHooks(),
    });

    expect(ctx.vaultContext.length).toBeGreaterThan(40);
    expect(ctx.vaultContext).toContain("Evidence");
    expect(ctx.state.evidencePacket).toBeTruthy();
  });
});

describe("autonomy budget digest", () => {
  let tmp = "";

  afterEach(() => {
    process.env.GZMO_AUTONOMY_OPS_BUDGET_HOUR = "";
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("consumes against hourly cap", async () => {
    tmp = join(tmpdir(), `gzmo-budget-${Date.now()}`);
    mkdirSync(join(tmp, "GZMO"), { recursive: true });

    process.env.GZMO_AUTONOMY_OPS_BUDGET_HOUR = "1";
    expect(await autonomyBudgetAllows(tmp)).toBe(true);
    await autonomyBudgetConsume(tmp, "dream");
    expect(await autonomyBudgetAllows(tmp)).toBe(false);
    const digest = await readBudgetDigest(tmp);
    expect(digest.counts.dream).toBe(1);
    expect(await Bun.file(join(tmp, "GZMO", ".gzmo_autonomy_budget.json")).exists()).toBe(true);
  });
});
