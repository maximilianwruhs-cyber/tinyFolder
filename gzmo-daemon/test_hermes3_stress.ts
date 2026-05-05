/**
 * test_hermes3_stress.ts — Ultimate Hermes3:8b Stress Test
 *
 * 8-stage gauntlet testing every subsystem of the GZMO daemon:
 *   1. Identity & System Prompt Compliance
 *   2. RAG-Grounded Vault Search (embedding retrieval)
 *   3. Structured Output / JSON Compliance
 *   4. Chain Action (multi-task handoff)
 *   5. Dream Engine (distillation from completed tasks)
 *   6. Self-Ask Engine (gap detective + contradiction scanner)
 *   7. Wiki Engine (autonomous knowledge consolidation + self-documentation)
 *   8. Chaos Engine State Integrity (mutation tracking)
 *
 * Grades output quality, measures latency, detects hallucinations.
 */

import { resolve, join, basename } from "path";
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from "fs";
import { DreamEngine } from "./src/dreams";
import { SelfAskEngine } from "./src/self_ask";
import { JsonlEdgeStore } from "./src/honeypot_edges";
import { WikiEngine } from "./src/wiki_engine";
import { processTask, infer } from "./src/engine";
import { VaultWatcher } from "./src/watcher";
import { PulseLoop } from "./src/pulse";
import { syncEmbeddings } from "./src/embeddings";
import { defaultConfig } from "./src/types";
import { TaskMemory } from "./src/memory";
import type { ChaosSnapshot } from "./src/types";
import type { TaskEvent } from "./src/watcher";
import type { EmbeddingStore } from "./src/embeddings";
import { TaskDocument } from "./src/frontmatter";

// ── Paths ───────────────────────────────────────────────────
const VAULT_PATH = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../../Obsidian_Vault");
const INBOX_PATH = join(VAULT_PATH, "GZMO", "Inbox");
const OLLAMA_API_URL = process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "hermes3:8b";

// ── Results ─────────────────────────────────────────────────
interface TestResult {
  step: string;
  status: "✅ PASS" | "❌ FAIL" | "⚠️ WARN";
  timeMs: number;
  outputChars: number;
  output: string;
  notes: string;
}
const results: TestResult[] = [];

// ── Output Grader ───────────────────────────────────────────
function gradeOutput(output: string, extraChecks?: { mustContain?: string[]; mustNotContain?: string[] }): { quality: string; issues: string[] } {
  const issues: string[] = [];

  // Universal checks
  if (output.includes("\\boxed")) issues.push("LaTeX garbage");
  if (/<\/think(ing)?>/.test(output)) issues.push("Leaked think tags");
  if (/Star Trek|Godzilla|Deep Space Nine/i.test(output)) issues.push("Identity hallucination");
  if (/Llama-3|meta-llama|GPT-4|ChatGPT|I am a large language model/i.test(output)) issues.push("Model identity leak");
  if (output.length < 20) issues.push("Output too short (<20 chars)");
  if (output.length > 8000) issues.push("Output suspiciously long (>8k)");
  if (/^(Okay|Hmm|I think|Let me|I recall|The user)/m.test(output)) issues.push("Leaked internal reasoning");

  // Custom checks
  if (extraChecks?.mustContain) {
    for (const term of extraChecks.mustContain) {
      if (!output.toLowerCase().includes(term.toLowerCase())) {
        issues.push(`Missing required: "${term}"`);
      }
    }
  }
  if (extraChecks?.mustNotContain) {
    for (const term of extraChecks.mustNotContain) {
      if (output.toLowerCase().includes(term.toLowerCase())) {
        issues.push(`Contains forbidden: "${term}"`);
      }
    }
  }

  if (issues.length === 0) return { quality: "✅ CLEAN", issues: [] };
  if (issues.some(i => i.includes("hallucination") || i.includes("garbage") || i.includes("identity leak"))) return { quality: "❌ BAD", issues };
  return { quality: "⚠️ WARN", issues };
}

function recordResult(step: string, status: "✅ PASS" | "❌ FAIL" | "⚠️ WARN", timeMs: number, output: string, notes: string) {
  results.push({ step, status, timeMs, outputChars: output.length, output: output.slice(0, 600), notes });
}

// ═══════════════════════════════════════════════════════════════
// BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════════
console.log("\n╔═══════════════════════════════════════════════════════════╗");
console.log("║   🧪 GZMO Hermes3:8b Ultimate Stress Test               ║");
console.log("║   8-Stage Gauntlet — All Subsystems Under Fire           ║");
console.log(`║   Model: ${MODEL.padEnd(48)}║`);
console.log("╚═══════════════════════════════════════════════════════════╝\n");

// Boot pulse
const pulse = new PulseLoop(defaultConfig());
pulse.start(join(VAULT_PATH, "GZMO", "CHAOS_STATE.json"));
await new Promise(r => setTimeout(r, 2000));
const bootSnap = pulse.snapshot();
console.log(`[BOOT] Chaos: T=${bootSnap.tension.toFixed(0)}% E=${bootSnap.energy.toFixed(0)}% Phase=${bootSnap.phase} Temp=${bootSnap.llmTemperature.toFixed(2)}`);

// Boot embeddings
console.log("[BOOT] Loading embeddings...");
const embeddingsPath = join(VAULT_PATH, "GZMO", "embeddings.json");
let store: EmbeddingStore | undefined;
try {
  store = await syncEmbeddings(VAULT_PATH, embeddingsPath, OLLAMA_API_URL);
  console.log(`[BOOT] Embeddings: ${store.chunks.length} chunks ready`);
} catch (e: any) {
  console.error(`[BOOT] ❌ Embeddings FAILED: ${e?.message}`);
}

// Boot memory
const memory = new TaskMemory(join(VAULT_PATH, "GZMO", "memory.json"));
console.log(`[BOOT] Memory: ${memory.count} entries`);

// Boot watcher
const watcher = new VaultWatcher(INBOX_PATH);
watcher.start();
await new Promise(r => setTimeout(r, 500));

// Calm snapshot for gating bypass
const calmSnap: ChaosSnapshot = { ...bootSnap, tension: 5, energy: 100, alive: true };

console.log("[BOOT] ✅ All subsystems online. Starting gauntlet...\n");

// ═══════════════════════════════════════════════════════════════
// TEST 1: Identity & System Prompt Compliance
// ═══════════════════════════════════════════════════════════════
console.log("═══════════════════════════════════════════════════════════");
console.log("  TEST 1/8: Identity & System Prompt Compliance");
console.log("═══════════════════════════════════════════════════════════");

const t1File = join(INBOX_PATH, "_stress_01_identity.md");
writeFileSync(t1File, `---
status: pending
action: think
---

Answer these questions precisely:
1. What is your name?
2. Are you a fictional character?
3. What is your current operational phase?
4. What runtime environment are you deployed on?

Do NOT fabricate information. If you don't know something, say "unknown".
`);

const t1Start = Date.now();
try {
  const doc = await TaskDocument.load(t1File);
  if (!doc) throw new Error(`Failed to load task document: ${t1File}`);
  const event: TaskEvent = {
    filePath: t1File,
    fileName: "_stress_01_identity",
    status: "pending",
    body: `Answer these questions precisely:\n1. What is your name?\n2. Are you a fictional character?\n3. What is your current operational phase?\n4. What runtime environment are you deployed on?\n\nDo NOT fabricate information. If you don't know something, say "unknown".`,
    frontmatter: { status: "pending", action: "think" },
    document: doc,
  };
  await processTask(event, watcher, pulse, store, memory);
  const elapsed = Date.now() - t1Start;
  const content = readFileSync(t1File, "utf-8");
  const response = content.match(/## GZMO Response[\s\S]*$/)?.[0] ?? "";
  const grade = gradeOutput(response, { mustContain: ["GZMO"], mustNotContain: ["ChatGPT", "GPT-4", "Llama"] });
  const status = grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS";
  recordResult("1. Identity Compliance", status, elapsed, response, grade.issues.join(", ") || "Clean");
  console.log(`[T1] ${grade.quality} in ${(elapsed/1000).toFixed(1)}s — ${response.length} chars`);
  console.log(`[T1] Preview: ${response.slice(0, 250).replace(/\n/g, " ")}`);
} catch (e: any) {
  recordResult("1. Identity Compliance", "❌ FAIL", Date.now() - t1Start, "", e?.message);
  console.error(`[T1] ❌ CRASHED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: RAG-Grounded Vault Search
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TEST 2/8: RAG-Grounded Vault Search");
console.log("═══════════════════════════════════════════════════════════");

const t2File = join(INBOX_PATH, "_stress_02_rag.md");
writeFileSync(t2File, `---
status: pending
action: search
---

Search the vault: What is the PulseLoop and how does the Lorenz attractor influence the chaos engine's behavior? Reference specific technical details from the vault documents.
`);

const t2Start = Date.now();
try {
  const doc = await TaskDocument.load(t2File);
  if (!doc) throw new Error(`Failed to load task document: ${t2File}`);
  const event: TaskEvent = {
    filePath: t2File,
    fileName: "_stress_02_rag",
    status: "pending",
    body: "Search the vault: What is the PulseLoop and how does the Lorenz attractor influence the chaos engine's behavior? Reference specific technical details from the vault documents.",
    frontmatter: { status: "pending", action: "search" },
    document: doc,
  };
  await processTask(event, watcher, pulse, store, memory);
  const elapsed = Date.now() - t2Start;
  const content = readFileSync(t2File, "utf-8");
  const response = content.match(/## GZMO Response[\s\S]*$/)?.[0] ?? "";
  // Check if model actually used RAG context (should mention specific vault terms)
  const ragTerms = ["tension", "energy", "attractor", "pulse", "phase"];
  const ragHits = ragTerms.filter(t => response.toLowerCase().includes(t));
  const grade = gradeOutput(response);
  const ragScore = `${ragHits.length}/${ragTerms.length} RAG terms found`;
  const status = ragHits.length >= 2 && grade.quality !== "❌ BAD" ? "✅ PASS" : ragHits.length >= 1 ? "⚠️ WARN" as const : "❌ FAIL";
  recordResult("2. RAG Vault Search", status, elapsed, response, `${ragScore}. ${grade.issues.join(", ") || "Clean"}`);
  console.log(`[T2] ${status} in ${(elapsed/1000).toFixed(1)}s — ${ragScore}`);
  console.log(`[T2] Preview: ${response.slice(0, 250).replace(/\n/g, " ")}`);
} catch (e: any) {
  recordResult("2. RAG Vault Search", "❌ FAIL", Date.now() - t2Start, "", e?.message);
  console.error(`[T2] ❌ CRASHED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: Structured Output / JSON Compliance
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TEST 3/8: Structured Output Compliance");
console.log("═══════════════════════════════════════════════════════════");

const t3Start = Date.now();
try {
  const structuredPrompt = `You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no text before or after.

Generate a JSON status report with this exact schema:
{
  "daemon_name": "<your name>",
  "status": "operational" | "degraded" | "offline",
  "uptime_estimate": "<string>",
  "subsystems": [
    { "name": "<string>", "healthy": true|false }
  ],
  "recommendation": "<one sentence>"
}`;

  const response = await infer(
    "You are GZMO, a sovereign AI daemon. You follow instructions exactly. When asked for JSON, output ONLY valid JSON.",
    structuredPrompt
  );
  const elapsed = Date.now() - t3Start;

  // Try to parse as JSON
  let jsonValid = false;
  let jsonIssues: string[] = [];
  try {
    const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    jsonValid = true;
    if (!parsed.daemon_name) jsonIssues.push("Missing daemon_name");
    if (!parsed.subsystems || !Array.isArray(parsed.subsystems)) jsonIssues.push("Missing/invalid subsystems array");
    if (!parsed.recommendation) jsonIssues.push("Missing recommendation");
  } catch (parseErr: any) {
    jsonIssues.push(`JSON parse failed: ${parseErr.message.slice(0, 80)}`);
  }

  const status = jsonValid && jsonIssues.length === 0 ? "✅ PASS" : jsonValid ? "⚠️ WARN" : "❌ FAIL";
  recordResult("3. Structured JSON Output", status, elapsed, response, jsonIssues.join(", ") || "Valid JSON with correct schema");
  console.log(`[T3] ${status} in ${(elapsed/1000).toFixed(1)}s — JSON valid: ${jsonValid}`);
  console.log(`[T3] Output: ${response.slice(0, 300).replace(/\n/g, " ")}`);
} catch (e: any) {
  recordResult("3. Structured JSON Output", "❌ FAIL", Date.now() - t3Start, "", e?.message);
  console.error(`[T3] ❌ CRASHED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: Chain Action (Multi-Task Handoff)
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TEST 4/8: Chain Action (Multi-Task Handoff)");
console.log("═══════════════════════════════════════════════════════════");

const t4File = join(INBOX_PATH, "_stress_04_chain.md");
const t4NextFile = "_stress_04_chain_step2.md";
writeFileSync(t4File, `---
status: pending
action: chain
chain_next: ${t4NextFile}
---

Step 1: List exactly 3 technical components of the GZMO daemon architecture. Be brief.
`);

const t4Start = Date.now();
try {
  const doc = await TaskDocument.load(t4File);
  if (!doc) throw new Error(`Failed to load task document: ${t4File}`);
  const event: TaskEvent = {
    filePath: t4File,
    fileName: "_stress_04_chain",
    status: "pending",
    body: "Step 1: List exactly 3 technical components of the GZMO daemon architecture. Be brief.",
    frontmatter: { status: "pending", action: "chain", chain_next: t4NextFile },
    document: doc,
  };
  await processTask(event, watcher, pulse, store, memory);
  const elapsed = Date.now() - t4Start;

  // Check if chain file was created
  const chainFilePath = join(INBOX_PATH, t4NextFile);
  const chainCreated = existsSync(chainFilePath);
  const originalContent = readFileSync(t4File, "utf-8");
  const response = originalContent.match(/## GZMO Response[\s\S]*$/)?.[0] ?? "";
  const grade = gradeOutput(response);

  let chainNotes = chainCreated ? "Chain file created ✅" : "Chain file NOT created ❌";
  if (chainCreated) {
    const chainContent = readFileSync(chainFilePath, "utf-8");
    chainNotes += ` (${chainContent.length} bytes)`;
  }

  const status = chainCreated && grade.quality !== "❌ BAD" ? "✅ PASS" : "❌ FAIL";
  recordResult("4. Chain Action", status, elapsed, response, `${chainNotes}. ${grade.issues.join(", ") || "Clean"}`);
  console.log(`[T4] ${status} in ${(elapsed/1000).toFixed(1)}s — ${chainNotes}`);
  console.log(`[T4] Preview: ${response.slice(0, 250).replace(/\n/g, " ")}`);
} catch (e: any) {
  recordResult("4. Chain Action", "❌ FAIL", Date.now() - t4Start, "", e?.message);
  console.error(`[T4] ❌ CRASHED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 5: Dream Engine (Distillation)
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TEST 5/8: Dream Engine (Distillation)");
console.log("═══════════════════════════════════════════════════════════");

// Clear digested cache for test files
const digestedPath = join(VAULT_PATH, "GZMO", ".gzmo_dreams_digested.json");
try {
  const d = JSON.parse(readFileSync(digestedPath, "utf-8"));
  d.digested = d.digested.filter((x: string) => !x.startsWith("_stress_"));
  writeFileSync(digestedPath, JSON.stringify(d, null, 2));
} catch {}

const dreams = new DreamEngine(VAULT_PATH);
const t5Start = Date.now();
try {
  const result = await dreams.dream(calmSnap, infer, store, OLLAMA_API_URL);
  const elapsed = Date.now() - t5Start;
  if (result) {
    const grade = gradeOutput(result.insights);
    const status = grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS";
    recordResult("5. Dream Engine", status, elapsed, result.insights, `Source: ${result.taskFile}. ${grade.issues.join(", ") || "Clean"}`);
    console.log(`[T5] ${grade.quality} in ${(elapsed/1000).toFixed(1)}s — Source: ${result.taskFile}`);
    console.log(`[T5] Preview: ${result.insights.slice(0, 250).replace(/\n/g, " ")}`);
  } else {
    recordResult("5. Dream Engine", "⚠️ WARN", elapsed, "", "No tasks to process (expected: completed test tasks)");
    console.log("[T5] ⚠️ No unprocessed tasks found for dreaming");
  }
} catch (e: any) {
  recordResult("5. Dream Engine", "❌ FAIL", Date.now() - t5Start, "", e?.message);
  console.error(`[T5] ❌ CRASHED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 6: Self-Ask Engine (Gap Detective + Contradiction Scanner)
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TEST 6/8: Self-Ask Engine (All Strategies)");
console.log("═══════════════════════════════════════════════════════════");

if (store) {
  const selfAskEdgeStore = new JsonlEdgeStore(VAULT_PATH);
  const selfAsk = new SelfAskEngine(VAULT_PATH, selfAskEdgeStore);
  const t6Start = Date.now();
  try {
    const saResults = await selfAsk.cycle(calmSnap, store, OLLAMA_API_URL, infer);
    const elapsed = Date.now() - t6Start;
    for (const r of saResults) {
      const grade = gradeOutput(r.output);
      const status = grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS";
      recordResult(`6. Self-Ask (${r.strategy})`, status, elapsed / saResults.length, r.output, grade.issues.join(", ") || "Clean");
      console.log(`[T6] ${r.strategy}: ${grade.quality} (${r.output.length} chars)`);
      console.log(`[T6] Preview: ${r.output.slice(0, 150).replace(/\n/g, " ")}`);
    }
    console.log(`[T6] Total: ${saResults.length} strategies in ${(elapsed/1000).toFixed(1)}s`);
  } catch (e: any) {
    recordResult("6. Self-Ask Engine", "❌ FAIL", Date.now() - t6Start, "", e?.message);
    console.error(`[T6] ❌ CRASHED: ${e?.message}`);
  }
} else {
  recordResult("6. Self-Ask Engine", "❌ FAIL", 0, "", "No embedding store available");
  console.error("[T6] ❌ SKIPPED — no embeddings");
}

// ═══════════════════════════════════════════════════════════════
// TEST 7: Wiki Engine (Autonomous Knowledge Builder)
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TEST 7/8: Wiki Engine (Consolidation + Self-Doc)");
console.log("═══════════════════════════════════════════════════════════");

const srcPath = resolve(import.meta.dir, "src");
const wikiEng = new WikiEngine(VAULT_PATH, srcPath);
const t7WikiStart = Date.now();
try {
  const wikiResults = await wikiEng.cycle(infer, store, OLLAMA_API_URL);
  const elapsed = Date.now() - t7WikiStart;

  if (wikiResults.length > 0) {
    for (const wr of wikiResults) {
      const grade = gradeOutput(wr.content);
      recordResult(
        `7. Wiki (${wr.category.slice(0, 15)})`,
        grade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS",
        elapsed / wikiResults.length,
        wr.content,
        `${wr.sourceCount} sources → wiki/${wr.category}. ${grade.issues.join(", ") || "Clean"}`,
      );
      console.log(`[T7] ${wr.title}: ${grade.quality} (${wr.content.length} chars, ${wr.sourceCount} sources)`);
    }
    console.log(`[T7] Total: ${wikiResults.length} wiki pages in ${(elapsed / 1000).toFixed(1)}s`);
  } else {
    // No pages created can still pass if the engine ran without errors
    recordResult(
      "7. Wiki Engine",
      "⚠️ WARN",
      elapsed,
      "",
      "No pages created (may need more cabinet entries or fresh digest)",
    );
    console.log(`[T7] ⚠️ No wiki pages created (${(elapsed / 1000).toFixed(1)}s)`);
  }

  // Verify self-documentation file was created
  const autoDocPath = join(VAULT_PATH, "wiki", "entities", "GZMO-Architecture-AutoDoc.md");
  if (existsSync(autoDocPath)) {
    const autoDoc = readFileSync(autoDocPath, "utf-8");
    const docGrade = gradeOutput(autoDoc, { mustContain: ["engine", "pulse"] });
    recordResult(
      "7. Self-Documentation",
      docGrade.quality === "❌ BAD" ? "❌ FAIL" : "✅ PASS",
      0,
      autoDoc.slice(0, 600),
      `${autoDoc.length} chars. ${docGrade.issues.join(", ") || "Clean"}`,
    );
    console.log(`[T7] Self-Doc: ${docGrade.quality} (${autoDoc.length} chars)`);
  } else {
    console.log("[T7] Self-doc not created (24h cooldown may be active)");
  }
} catch (e: any) {
  recordResult("7. Wiki Engine", "❌ FAIL", Date.now() - t7WikiStart, "", e?.message);
  console.error(`[T7] ❌ CRASHED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// TEST 8: Chaos Engine State Integrity
// ═══════════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TEST 8/8: Chaos Engine State Integrity");
console.log("═══════════════════════════════════════════════════════════");

const t7Start = Date.now();
try {
  const finalSnap = pulse.snapshot();
  const elapsed = Date.now() - t7Start;

  // Verify mutations occurred (tension should have changed from processing tasks)
  const tensionDelta = Math.abs(finalSnap.tension - bootSnap.tension);
  const energyDelta = Math.abs(finalSnap.energy - bootSnap.energy);
  const tickDelta = finalSnap.tick - bootSnap.tick;

  const issues: string[] = [];
  if (tickDelta < 10) issues.push(`Tick too low (${tickDelta})`);
  if (!finalSnap.alive) issues.push("Pulse not alive");
  if (finalSnap.energy <= 0) issues.push("Energy depleted to zero");
  if (tensionDelta === 0 && energyDelta === 0) issues.push("No state mutation detected");

  // Count crystallizations written during test
  const cabinetPath = join(VAULT_PATH, "GZMO", "Thought_Cabinet");
  let crystalCount = 0;
  try {
    const files = readdirSync(cabinetPath);
    const today = new Date().toISOString().slice(0, 10);
    crystalCount = files.filter(f => f.startsWith(today) && f.includes("crystallization")).length;
  } catch {}

  const status = issues.length === 0 ? "✅ PASS" : issues.some(i => i.includes("not alive")) ? "❌ FAIL" : "⚠️ WARN";
  const stateReport = [
    `Ticks: ${bootSnap.tick} → ${finalSnap.tick} (Δ${tickDelta})`,
    `Tension: ${bootSnap.tension.toFixed(1)}% → ${finalSnap.tension.toFixed(1)}% (Δ${tensionDelta.toFixed(1)})`,
    `Energy: ${bootSnap.energy.toFixed(0)}% → ${finalSnap.energy.toFixed(0)}% (Δ${energyDelta.toFixed(0)})`,
    `Phase: ${bootSnap.phase} → ${finalSnap.phase}`,
    `Crystallizations today: ${crystalCount}`,
  ].join(" | ");

  recordResult("8. Chaos State Integrity", status, elapsed, stateReport, issues.join(", ") || "State mutated correctly");
  console.log(`[T7] ${status} — ${stateReport}`);
} catch (e: any) {
  recordResult("8. Chaos State Integrity", "❌ FAIL", Date.now() - t7Start, "", e?.message);
  console.error(`[T7] ❌ CRASHED: ${e?.message}`);
}

// ═══════════════════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════════════════
console.log("\n\n╔═══════════════════════════════════════════════════════════════════════╗");
console.log("║                    HERMES3:8B STRESS TEST REPORT                    ║");
console.log("╠════════════════════════════╦══════════╦═════════╦════════╦═══════════╣");
console.log("║ Test                       ║ Status   ║ Time(s) ║ Chars  ║ Notes     ║");
console.log("╠════════════════════════════╬══════════╬═════════╬════════╬═══════════╣");

for (const r of results) {
  const step = r.step.slice(0, 26).padEnd(26);
  const status = r.status.padEnd(8);
  const time = (r.timeMs / 1000).toFixed(1).padStart(7);
  const chars = String(r.outputChars).padStart(6);
  const notes = r.notes.slice(0, 9).padEnd(9);
  console.log(`║ ${step} ║ ${status} ║ ${time} ║ ${chars} ║ ${notes} ║`);
}

console.log("╚════════════════════════════╩══════════╩═════════╩════════╩═══════════╝");

const passed = results.filter(r => r.status === "✅ PASS").length;
const failed = results.filter(r => r.status === "❌ FAIL").length;
const warned = results.filter(r => r.status === "⚠️ WARN").length;
const totalTime = results.reduce((a, r) => a + r.timeMs, 0);

console.log(`\n  Score: ${passed}/${results.length} passed | ${warned} warnings | ${failed} failures`);
console.log(`  Total inference time: ${(totalTime / 1000).toFixed(1)}s`);
console.log(`  Model: ${MODEL}`);

// ── Write detailed Markdown report ───────────────────────────
const reportPath = join(VAULT_PATH, "GZMO", "hermes3_stress_report.md");
const md = [
  "# 🧪 Hermes3:8b Ultimate Stress Test Report",
  `*Generated: ${new Date().toISOString()}*`,
  `*Model: ${MODEL}*`,
  "",
  `## Summary: ${passed}/${results.length} passed, ${warned} warnings, ${failed} failures`,
  `**Total inference time:** ${(totalTime / 1000).toFixed(1)}s`,
  "",
  "| # | Test | Status | Time | Chars | Notes |",
  "|---|------|--------|------|-------|-------|",
  ...results.map((r, i) => `| ${i + 1} | ${r.step} | ${r.status} | ${(r.timeMs/1000).toFixed(1)}s | ${r.outputChars} | ${r.notes.slice(0, 60)} |`),
  "",
];

for (const r of results) {
  md.push(`---`, "", `## ${r.step}`, "", `**Status:** ${r.status} | **Time:** ${(r.timeMs/1000).toFixed(1)}s | **Output:** ${r.outputChars} chars`, "");
  if (r.output.length > 0) {
    md.push("```", r.output, "```", "");
  }
  if (r.notes) md.push(`> **Notes:** ${r.notes}`, "");
}

writeFileSync(reportPath, md.join("\n"), "utf-8");
console.log(`\n  📄 Full report: ${reportPath}`);

// ── Cleanup test files ───────────────────────────────────────
const testFiles = readdirSync(INBOX_PATH).filter(f => f.startsWith("_stress_"));
for (const f of testFiles) {
  try { unlinkSync(join(INBOX_PATH, f)); } catch {}
}
console.log(`  🧹 Cleaned ${testFiles.length} test files from Inbox`);

console.log("\n  ✅ Stress test complete. Shutting down...\n");
await watcher.stop();
pulse.stop();
process.exit(0);
