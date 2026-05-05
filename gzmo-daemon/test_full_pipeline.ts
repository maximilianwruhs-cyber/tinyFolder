/**
 * test_full_pipeline.ts — Comprehensive E2E Pipeline Test
 *
 * Tests EVERY pipeline step of the GZMO daemon:
 *   1. Task Processing (think action) — basic inference
 *   2. Task Processing (search action) — vault RAG
 *   3. Dream Engine — distill completed task
 *   4. Self-Ask Engine — gap detective, contradiction scanner, spaced repetition
 *
 * For each step: validates completion, measures time, and outputs content for quality review.
 */

import { resolve, join } from "path";
import * as fs from "fs";
import { DreamEngine } from "./src/dreams";
import { SelfAskEngine } from "./src/self_ask";
import { JsonlEdgeStore } from "./src/honeypot_edges";
import { processTask, infer } from "./src/engine";
import { VaultWatcher } from "./src/watcher";
import { PulseLoop } from "./src/pulse";
import { syncEmbeddings, embedSingleFile } from "./src/embeddings";
import { defaultConfig } from "./src/types";
import { TaskMemory } from "./src/memory";
import type { ChaosSnapshot } from "./src/types";
import type { TaskEvent } from "./src/watcher";
import type { EmbeddingStore } from "./src/embeddings";
import { TaskDocument } from "./src/frontmatter";

const VAULT_PATH = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../../Obsidian_Vault");
const INBOX_PATH = join(VAULT_PATH, "GZMO", "Inbox");
const OLLAMA_API_URL = process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434";

// ── Results Collector ──────────────────────────────────────────
interface TestResult {
  step: string;
  status: "✅ PASS" | "❌ FAIL" | "⚠️ WARN";
  timeMs: number;
  outputChars: number;
  output: string;
  notes: string;
}
const results: TestResult[] = [];

function gradeOutput(output: string): { quality: string; issues: string[] } {
  const issues: string[] = [];
  if (output.includes("\\boxed")) issues.push("LaTeX boxed garbage");
  if (output.includes("</thinking>") || output.includes("</think>")) issues.push("Leaked think tags");
  if (/Star Trek|Godzilla|Deep Space Nine/i.test(output)) issues.push("Identity hallucination");
  if (/Llama-3|meta-llama|GPT-4|ChatGPT/i.test(output)) issues.push("Model hallucination");
  if (output.length < 20) issues.push("Output too short");
  if (output.length > 5000) issues.push("Output suspiciously long");
  if (/^(Okay|Hmm|I think|Let me|I recall|The user)/m.test(output)) issues.push("Leaked reasoning");

  if (issues.length === 0) return { quality: "✅ CLEAN", issues: [] };
  if (issues.some(i => i.includes("hallucination") || i.includes("garbage"))) return { quality: "❌ BAD", issues };
  return { quality: "⚠️ WARN", issues };
}

// ── Boot ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════════════════");
console.log("  GZMO Full Pipeline Test — qwen3:4b");
console.log("════════════════════════════════════════════════════\n");

// Boot pulse
const pulse = new PulseLoop(defaultConfig());
pulse.start(join(VAULT_PATH, "GZMO", "CHAOS_STATE.json"));
await new Promise(r => setTimeout(r, 2000));
const snap = pulse.snapshot();
console.log(`[BOOT] Chaos: T=${snap.tension.toFixed(0)} E=${snap.energy.toFixed(0)}% ${snap.phase}`);

// Boot embeddings
console.log("[BOOT] Loading embeddings...");
const embeddingsPath = join(VAULT_PATH, "GZMO", "embeddings.json");
let store: EmbeddingStore | undefined;
try {
  store = await syncEmbeddings(VAULT_PATH, embeddingsPath, OLLAMA_API_URL);
  console.log(`[BOOT] Embeddings: ${store.chunks.length} chunks`);
} catch (e: any) {
  console.error(`[BOOT] Embeddings FAILED: ${e?.message}`);
}

// Boot memory
const memory = new TaskMemory(join(VAULT_PATH, "GZMO", "memory.json"));
console.log(`[BOOT] Memory: ${memory.count} entries`);

// Boot watcher (needed for processTask file locking)
const watcher = new VaultWatcher(INBOX_PATH);
watcher.start();
await new Promise(r => setTimeout(r, 500));

// Calm snapshot for self-ask gating bypass
const calmSnap: ChaosSnapshot = { ...snap, tension: 5, energy: 100, alive: true };

// ═══════════════════════════════════════════════════════════════
// TEST 1: Task Processing — action: think
// ═══════════════════════════════════════════════════════════════
console.log("\n════════════════════════════════════════════════════");
console.log("  TEST 1: Task Processing (action: think)");
console.log("════════════════════════════════════════════════════");

const thinkFile = join(INBOX_PATH, "_test_think.md");
fs.writeFileSync(thinkFile, `---\nstatus: pending\naction: think\n---\n\nGZMO, state your identity and current chaos state. Be concise.\n`);

const t1 = Date.now();
try {
  const thinkDoc = await TaskDocument.load(thinkFile);
  if (!thinkDoc) throw new Error(`Failed to load task document: ${thinkFile}`);
  const event: TaskEvent = {
    filePath: thinkFile,
    fileName: "_test_think",
    status: "pending",
    body: "GZMO, state your identity and current chaos state. Be concise.",
    frontmatter: { status: "pending", action: "think" },
    document: thinkDoc,
  };
  await processTask(event, watcher, pulse, store, memory);
  const elapsed = Date.now() - t1;
  const content = fs.readFileSync(thinkFile, "utf-8");
  const responseMatch = content.match(/## GZMO Response[\s\S]*$/);
  const response = responseMatch?.[0] ?? "";
  const grade = gradeOutput(response);
  results.push({
    step: "1. Task (think)",
    status: grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS",
    timeMs: elapsed,
    outputChars: response.length,
    output: response.slice(0, 500),
    notes: grade.issues.length > 0 ? grade.issues.join(", ") : "Clean output",
  });
  console.log(`[TEST 1] ${grade.quality} in ${(elapsed/1000).toFixed(1)}s (${response.length} chars)`);
  if (grade.issues.length) console.log(`[TEST 1] Issues: ${grade.issues.join(", ")}`);
  console.log(`[TEST 1] Preview: ${response.slice(0, 200).replace(/\n/g, " ")}`);
} catch (e: any) {
  results.push({ step: "1. Task (think)", status: "❌ FAIL", timeMs: Date.now() - t1, outputChars: 0, output: "", notes: e?.message });
  console.error(`[TEST 1] ❌ FAILED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: Task Processing — action: search
// ═══════════════════════════════════════════════════════════════
console.log("\n════════════════════════════════════════════════════");
console.log("  TEST 2: Task Processing (action: search)");
console.log("════════════════════════════════════════════════════");

const searchFile = join(INBOX_PATH, "_test_search.md");
fs.writeFileSync(searchFile, `---\nstatus: pending\naction: search\n---\n\nWhat do you know about the chaos engine and allostasis system?\n`);

const t2 = Date.now();
try {
  const searchDoc = await TaskDocument.load(searchFile);
  if (!searchDoc) throw new Error(`Failed to load task document: ${searchFile}`);
  const event: TaskEvent = {
    filePath: searchFile,
    fileName: "_test_search",
    status: "pending",
    body: "What do you know about the chaos engine and allostasis system?",
    frontmatter: { status: "pending", action: "search" },
    document: searchDoc,
  };
  await processTask(event, watcher, pulse, store, memory);
  const elapsed = Date.now() - t2;
  const content = fs.readFileSync(searchFile, "utf-8");
  const responseMatch = content.match(/## GZMO Response[\s\S]*$/);
  const response = responseMatch?.[0] ?? "";
  const grade = gradeOutput(response);
  results.push({
    step: "2. Task (search)",
    status: grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS",
    timeMs: elapsed,
    outputChars: response.length,
    output: response.slice(0, 500),
    notes: grade.issues.length > 0 ? grade.issues.join(", ") : "Clean output",
  });
  console.log(`[TEST 2] ${grade.quality} in ${(elapsed/1000).toFixed(1)}s (${response.length} chars)`);
  if (grade.issues.length) console.log(`[TEST 2] Issues: ${grade.issues.join(", ")}`);
  console.log(`[TEST 2] Preview: ${response.slice(0, 200).replace(/\n/g, " ")}`);
} catch (e: any) {
  results.push({ step: "2. Task (search)", status: "❌ FAIL", timeMs: Date.now() - t2, outputChars: 0, output: "", notes: e?.message });
  console.error(`[TEST 2] ❌ FAILED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: Dream Engine
// ═══════════════════════════════════════════════════════════════
console.log("\n════════════════════════════════════════════════════");
console.log("  TEST 3: Dream Engine");
console.log("════════════════════════════════════════════════════");

// Reset digested so dreams can process our test tasks
const digestedPath = join(VAULT_PATH, "GZMO", ".gzmo_dreams_digested.json");
try {
  const d = JSON.parse(fs.readFileSync(digestedPath, "utf-8"));
  d.digested = d.digested.filter((x: string) => !x.startsWith("_test_"));
  fs.writeFileSync(digestedPath, JSON.stringify(d, null, 2));
} catch {}

const dreams = new DreamEngine(VAULT_PATH);
const t3 = Date.now();
try {
  const result = await dreams.dream(calmSnap, infer, store, OLLAMA_API_URL);
  const elapsed = Date.now() - t3;
  if (result) {
    const grade = gradeOutput(result.insights);
    results.push({
      step: "3. Dream Engine",
      status: grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS",
      timeMs: elapsed,
      outputChars: result.insights.length,
      output: result.insights.slice(0, 500),
      notes: `Source: ${result.taskFile}. ${grade.issues.length > 0 ? grade.issues.join(", ") : "Clean output"}`,
    });
    console.log(`[TEST 3] ${grade.quality} in ${(elapsed/1000).toFixed(1)}s (${result.insights.length} chars)`);
    console.log(`[TEST 3] Source: ${result.taskFile}`);
    console.log(`[TEST 3] Preview: ${result.insights.slice(0, 200).replace(/\n/g, " ")}`);
  } else {
    results.push({ step: "3. Dream Engine", status: "⚠️ WARN", timeMs: elapsed, outputChars: 0, output: "", notes: "No tasks to process" });
    console.log("[TEST 3] ⚠️ No unprocessed tasks to dream about");
  }
} catch (e: any) {
  results.push({ step: "3. Dream Engine", status: "❌ FAIL", timeMs: Date.now() - t3, outputChars: 0, output: "", notes: e?.message });
  console.error(`[TEST 3] ❌ FAILED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: Self-Ask Engine (all 3 strategies)
// ═══════════════════════════════════════════════════════════════
console.log("\n════════════════════════════════════════════════════");
console.log("  TEST 4: Self-Ask Engine (all strategies)");
console.log("════════════════════════════════════════════════════");

if (store) {
  const selfAskEdgeStore = new JsonlEdgeStore(VAULT_PATH);
  const selfAsk = new SelfAskEngine(VAULT_PATH, selfAskEdgeStore);
  const t4 = Date.now();
  try {
    const saResults = await selfAsk.cycle(calmSnap, store, OLLAMA_API_URL, infer);
    const elapsed = Date.now() - t4;
    for (const r of saResults) {
      const grade = gradeOutput(r.output);
      results.push({
        step: `4. Self-Ask (${r.strategy})`,
        status: grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS",
        timeMs: elapsed / saResults.length,
        outputChars: r.output.length,
        output: r.output.slice(0, 300),
        notes: grade.issues.length > 0 ? grade.issues.join(", ") : "Clean output",
      });
      console.log(`[TEST 4] ${r.strategy}: ${grade.quality} (${r.output.length} chars)`);
      console.log(`[TEST 4] Output: ${r.output.slice(0, 150).replace(/\n/g, " ")}`);
    }
    console.log(`[TEST 4] Total: ${saResults.length} strategies in ${(elapsed/1000).toFixed(1)}s`);
  } catch (e: any) {
    results.push({ step: "4. Self-Ask", status: "❌ FAIL", timeMs: Date.now() - t4, outputChars: 0, output: "", notes: e?.message });
    console.error(`[TEST 4] ❌ FAILED: ${e?.message}`);
  }
} else {
  results.push({ step: "4. Self-Ask", status: "❌ FAIL", timeMs: 0, outputChars: 0, output: "", notes: "No embeddings" });
}

// ═══════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════
console.log("\n\n════════════════════════════════════════════════════");
console.log("  PIPELINE TEST REPORT");
console.log("════════════════════════════════════════════════════\n");

console.log("┌─────────────────────────────┬──────────┬─────────┬────────┬──────────────────────────┐");
console.log("│ Step                        │ Status   │ Time(s) │ Chars  │ Notes                    │");
console.log("├─────────────────────────────┼──────────┼─────────┼────────┼──────────────────────────┤");
for (const r of results) {
  const step = r.step.padEnd(27);
  const status = r.status.padEnd(8);
  const time = (r.timeMs / 1000).toFixed(1).padStart(7);
  const chars = String(r.outputChars).padStart(6);
  const notes = r.notes.slice(0, 24).padEnd(24);
  console.log(`│ ${step} │ ${status} │ ${time} │ ${chars} │ ${notes} │`);
}
console.log("└─────────────────────────────┴──────────┴─────────┴────────┴──────────────────────────┘");

const passed = results.filter(r => r.status === "✅ PASS").length;
const failed = results.filter(r => r.status === "❌ FAIL").length;
const warned = results.filter(r => r.status === "⚠️ WARN").length;
console.log(`\nTotal: ${passed} passed, ${warned} warned, ${failed} failed out of ${results.length} tests`);

// Write detailed report to file
const reportPath = join(VAULT_PATH, "GZMO", "pipeline_test_report.md");
const reportLines = [
  "# 🔬 GZMO Pipeline Test Report",
  `*Generated: ${new Date().toISOString()}*`,
  `*Model: qwen3:4b*`,
  "",
  `## Summary: ${passed}/${results.length} passed`,
  "",
  "| Step | Status | Time | Chars | Notes |",
  "|------|--------|------|-------|-------|",
  ...results.map(r => `| ${r.step} | ${r.status} | ${(r.timeMs/1000).toFixed(1)}s | ${r.outputChars} | ${r.notes} |`),
  "",
];

for (const r of results) {
  reportLines.push(`## ${r.step}`, "", "```", r.output, "```", "");
}

fs.writeFileSync(reportPath, reportLines.join("\n"), "utf-8");
console.log(`\nFull report: ${reportPath}`);

// Cleanup test files
try {
  fs.unlinkSync(join(INBOX_PATH, "_test_think.md"));
  fs.unlinkSync(join(INBOX_PATH, "_test_search.md"));
} catch {}

console.log("\n[TEST] Done. Shutting down...");
await watcher.stop();
pulse.stop();
process.exit(0);
