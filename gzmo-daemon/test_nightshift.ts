/**
 * test_nightshift.ts — Manual trigger for Dream + Self-Ask engines
 *
 * Tests both pipelines with qwen3:4b (non-thinking) model
 * to verify output quality before committing to the nightshift.
 *
 * NOTE: Bypasses chaos gating so self-ask runs regardless of tension.
 */

import { resolve, join } from "path";
import { DreamEngine } from "./src/dreams";
import { SelfAskEngine } from "./src/self_ask";
import { JsonlEdgeStore } from "./src/honeypot_edges";
import { infer } from "./src/engine";
import { PulseLoop } from "./src/pulse";
import { syncEmbeddings } from "./src/embeddings";
import { defaultConfig } from "./src/types";
import type { ChaosSnapshot } from "./src/types";

const VAULT_PATH = process.env.VAULT_PATH ?? resolve(
  import.meta.dir, "../../Obsidian_Vault"
);
const OLLAMA_API_URL = process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434";

// Boot a temp pulse for chaos snapshot
const pulse = new PulseLoop(defaultConfig());
const snapshotPath = join(VAULT_PATH, "GZMO", "CHAOS_STATE.json");
pulse.start(snapshotPath);

await new Promise(r => setTimeout(r, 2000));
const realSnap = pulse.snapshot();
console.log(`\n[TEST] Real Chaos: T=${realSnap.tension.toFixed(0)} E=${realSnap.energy.toFixed(0)}% ${realSnap.phase}`);

// Create a fake calm snapshot to bypass self-ask gating
const calmSnap: ChaosSnapshot = {
  ...realSnap,
  tension: 5,      // Below the 15 threshold
  energy: 100,
  alive: true,
};
console.log(`[TEST] Override snap: T=5, E=100% (bypassing self-ask gate)\n`);

// Boot embeddings
console.log("[TEST] Loading embeddings...");
const embeddingsPath = join(VAULT_PATH, "GZMO", "embeddings.json");
let store;
try {
  store = await syncEmbeddings(VAULT_PATH, embeddingsPath, OLLAMA_API_URL);
  console.log(`[TEST] Embeddings: ${store.chunks.length} chunks\n`);
} catch (err: any) {
  console.error(`[TEST] Embeddings failed: ${err?.message}`);
}

// ── Test 1: Dream Engine ──────────────────────────────────────
console.log("═══════════════════════════════════════════════");
console.log("  TEST 1: Dream Engine (qwen3:4b)");
console.log("═══════════════════════════════════════════════");

const dreams = new DreamEngine(VAULT_PATH);
const t1 = Date.now();
try {
  const result = await dreams.dream(calmSnap, infer, store, OLLAMA_API_URL);
  const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
  if (result) {
    console.log(`[DREAM] ✅ Completed in ${elapsed}s`);
    console.log(`[DREAM] Source: ${result.taskFile}`);
    console.log(`[DREAM] Output: ${result.vaultPath}`);
    console.log(`[DREAM] Insights (${result.insights.length} chars):`);
    console.log("---");
    console.log(result.insights);
    console.log("---\n");
  } else {
    console.log(`[DREAM] ⚠️ No unprocessed tasks to dream about (${elapsed}s)`);
  }
} catch (err: any) {
  console.error(`[DREAM] ❌ Failed: ${err?.message}`);
}

// ── Test 2: Self-Ask Engine ───────────────────────────────────
console.log("═══════════════════════════════════════════════");
console.log("  TEST 2: Self-Ask Engine (qwen3:4b)");
console.log("═══════════════════════════════════════════════");

if (store) {
  const selfAskEdgeStore = new JsonlEdgeStore(VAULT_PATH);
  const selfAsk = new SelfAskEngine(VAULT_PATH, selfAskEdgeStore);
  const t2 = Date.now();
  try {
    const results = await selfAsk.cycle(calmSnap, store, OLLAMA_API_URL, infer);
    const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
    console.log(`\n[SELF-ASK] Completed ${results.length} strategies in ${elapsed}s`);
    for (const r of results) {
      console.log(`\n[SELF-ASK] Strategy: ${r.strategy}`);
      console.log(`[SELF-ASK] Output (${r.output.length} chars):`);
      console.log("---");
      console.log(r.output.slice(0, 800));
      if (r.output.length > 800) console.log("...(truncated)");
      console.log("---");
    }
  } catch (err: any) {
    console.error(`[SELF-ASK] ❌ Failed: ${err?.message}`);
  }
} else {
  console.log("[SELF-ASK] ⚠️ Skipped — no embeddings available");
}

console.log("\n[TEST] Done. Shutting down...");
pulse.stop();
process.exit(0);
