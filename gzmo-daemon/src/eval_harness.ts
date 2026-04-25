import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { EmbeddingStore } from "./embeddings";
import { gatherLocalFacts } from "./local_facts";
import { gatherVaultStateIndex } from "./vault_state_index";
import { searchVaultHybrid } from "./search";
import { compileEvidencePacket } from "./evidence_packet";
import { verifySafety } from "./verifier_safety";

export interface EvalResult {
  ok: boolean;
  summary: string;
  metrics: Record<string, number>;
  details: string[];
}

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
        file: "wiki/topics/telemetry.md",
        heading: "Telemetry",
        text: "The daemon writes TELEMETRY.json under vault/GZMO.",
        hash: "b",
        vector: [0.9, 0.1],
        magnitude: Math.sqrt(0.82),
        updatedAt: now,
        metadata: { pathBucket: "wiki", type: "topic", role: "canonical", tags: ["telemetry"] },
      },
    ],
  };
}

/**
 * Minimal scenario runner used as a quality gate in CI/tests.
 * It does NOT call the LLM; it validates the deterministic substrate and safety constraints.
 */
export async function runEvalHarness(): Promise<EvalResult> {
  const details: string[] = [];
  const metrics: Record<string, number> = {};
  const vault = mkdtempSync(join(tmpdir(), "gzmo-eval-vault-"));
  try {
    mkdirSync(join(vault, "GZMO"), { recursive: true });
    mkdirSync(join(vault, "wiki", "entities"), { recursive: true });
    writeFileSync(join(vault, "GZMO", "TELEMETRY.json"), JSON.stringify({ ok: true, ts: new Date().toISOString() }, null, 2));
    writeFileSync(join(vault, "GZMO", "health.md"), "# Health\nok\n");
    writeFileSync(join(vault, "wiki", "entities", "GZMO-Ops-Outputs.md"), "# Ops Outputs\n- TELEMETRY.json\n");

    const query = "Where does the daemon write telemetry json?";
    const store = storeFixture();

    // Stub embedding endpoint so hybrid search doesn't hit the network.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ embedding: [1, 0] }), { status: 200 })) as any;

    const [facts, state, retrieval] = await Promise.all([
      gatherLocalFacts({ vaultPath: vault, query }),
      gatherVaultStateIndex({ vaultPath: vault, query }),
      searchVaultHybrid(query, store, "http://example.invalid", { topK: 4, perFileLimit: 1 }),
    ]);
    globalThis.fetch = originalFetch;

    metrics.localFactsChars = facts.length;
    metrics.vaultStateChars = state.length;
    metrics.retrievalCount = retrieval.length;

    if (!facts.includes("TELEMETRY.json")) details.push("local_facts missing TELEMETRY.json evidence");
    if (!state.includes("Vault State Index")) details.push("vault_state_index missing header");
    if (retrieval.length === 0) details.push("hybrid retrieval returned no results");

    const packet = compileEvidencePacket({
      localFacts: [facts, state].filter(Boolean).join("\n"),
      results: retrieval,
      maxSnippets: 10,
      maxSnippetChars: 900,
    });

    // Safety gate: invented path should be blocked.
    const verdict = verifySafety({ answer: "It writes to `vault/GZMO/NOT_REAL.json`.", packet });
    metrics.safetyBlocksInvented = verdict ? 1 : 0;
    if (!verdict) details.push("safety verifier failed to block invented path");

    const ok = details.length === 0;
    return {
      ok,
      summary: ok ? "eval harness passed" : "eval harness failed",
      metrics,
      details,
    };
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
}

