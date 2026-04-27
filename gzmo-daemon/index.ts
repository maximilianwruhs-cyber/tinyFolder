/**
 * GZMO Daemon v0.3.0 — Smart Core Edition
 *
 * A sovereign, filesystem-driven AI daemon with:
 * - Lorenz attractor heartbeat + Thought Cabinet crystallization
 * - Allostatic stress system (anti-sedation via simulated cortisol)
 * - Vault search via nomic-embed-text embeddings
 * - Episodic task memory for cross-task continuity
 * - Task routing via action: frontmatter (think/search/chain)
 * - Autonomous dream distillation
 *
 * Usage (foreground):
 *   OLLAMA_MODEL=hermes3:8b VAULT_PATH=/abs/path/to/vault bun run index.ts
 * Production (Ubuntu): see repo README — systemd user unit + scripts/wait-for-ollama.sh.
 */

import { resolve, join, relative, basename } from "path";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { VaultWatcher } from "./src/watcher";
import { processTask, infer } from "./src/engine";
import { LiveStream } from "./src/stream";
import { PulseLoop } from "./src/pulse";
import { DreamEngine } from "./src/dreams";
import { SelfAskEngine } from "./src/self_ask";
import { PruningEngine } from "./src/prune";
import { WikiEngine } from "./src/wiki_engine";
import { IngestEngine } from "./src/ingest_engine";
import { defaultConfig } from "./src/types";
import { TaskMemory } from "./src/memory";
import { runWikiLint } from "./src/wiki_lint";
import type { TriggerFired } from "./src/triggers";
import type { ChaosSnapshot } from "./src/types";
import { safeWriteText } from "./src/vault_fs";
import { describeRuntimeProfile, resolveRuntimeProfile } from "./src/runtime_profile";
import { EmbeddingsQueue } from "./src/embeddings_queue";
import { writeHealth } from "./src/health";
import { scoreSelfAskOutput } from "./src/self_ask_quality";
import { writeSelfAskQualityReport } from "./src/self_ask_report";
import { HoneypotPromotionEngine } from "./src/honeypot_promotion";
import { compileCoreWisdom } from "./src/core_wisdom";
import { writeOpsOutputsArtifacts } from "./src/ops_outputs_artifact";

// ── Global Abort Controller (for graceful shutdown of in-flight inference) ──
export const daemonAbort = new AbortController();

// ── Resolve Vault Path ─────────────────────────────────────
const VAULT_PATH = process.env.VAULT_PATH ?? resolve(
  import.meta.dir, "../vault"
);
const INBOX_PATH = join(VAULT_PATH, "GZMO", "Inbox");
const OLLAMA_API_URL = process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434";

// ── Runtime profile (safe mode) ────────────────────────────
const runtime = resolveRuntimeProfile();

// ── Ensure directories exist ───────────────────────────────
for (const dir of [
  join(VAULT_PATH, "GZMO"),
  INBOX_PATH,
  join(VAULT_PATH, "GZMO", "Subtasks"),
  join(VAULT_PATH, "GZMO", "Thought_Cabinet"),
]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Boot ───────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════");
console.log("  GZMO Daemon v0.3.0 — Smart Core");
console.log("  ⚡ Chaos Engine + Allostasis + Vault RAG");
console.log("═══════════════════════════════════════════════");
console.log(`  Vault:  ${VAULT_PATH}`);
console.log(`  Inbox:  ${INBOX_PATH}`);
console.log(`  Model:  ${process.env.OLLAMA_MODEL ?? "hermes3:8b"}`);
console.log(`  Ollama: ${OLLAMA_API_URL}`);
console.log(`  Profile:${describeRuntimeProfile(runtime)}`);
console.log("═══════════════════════════════════════════════");

// Defaults for the “max finesse” retrieval stack (can be overridden by env).
process.env.GZMO_MULTIQUERY ??= "on";
process.env.GZMO_RERANK_LLM ??= "on";
process.env.GZMO_ANCHOR_PRIOR ??= "on";
process.env.GZMO_MIN_RETRIEVAL_SCORE ??= "0.32";

// ── Ollama Readiness Gate ──────────────────────────────────────
async function waitForOllama(url: string, maxRetries = 10): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        console.log(`[OLLAMA] Connected (attempt ${i + 1})`);
        return true;
      }
    } catch {}
    const delay = Math.min(1000 * Math.pow(2, i), 15000);
    console.log(`[OLLAMA] Waiting for Ollama... retry ${i + 1}/${maxRetries} (${delay}ms)`);
    await new Promise(r => setTimeout(r, delay));
  }
  return false;
}

// ── Initialize LiveStream ──────────────────────────────────
const stream = new LiveStream(VAULT_PATH);

// ── Initialize PulseLoop (the beating heart) ───────────────
const pulse = new PulseLoop(defaultConfig());
const snapshotPath = join(VAULT_PATH, "GZMO", "CHAOS_STATE.json");
pulse.start(snapshotPath);

// Wire triggers → LiveStream + Crystallization vault notes (NEVER to APIs)
pulse.setTriggerDispatch((fired: TriggerFired[], snap: ChaosSnapshot) => {
  for (const f of fired) {
    if (f.action.type === "log") {
      stream.log(f.action.message, {
        tension: snap.tension,
        energy: snap.energy,
        phase: snap.phase,
      });
    }
  }

  // Upgrade 5: Write crystallization events to Thought_Cabinet
  if (snap.lastCrystallization) {
    const c = snap.lastCrystallization;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "-");
    const filename = `${dateStr}_${timeStr}_crystallization.md`;
    const filepath = join(VAULT_PATH, "GZMO", "Thought_Cabinet", filename);
    const content = [
      "---",
      `date: ${dateStr}`,
      `time: \"${now.toISOString().slice(11, 19)}\"`,
      `tick: ${snap.tick}`,
      `category: ${c.category}`,
      `mutation_target: ${c.mutation.target}`,
      `mutation_delta: ${c.mutation.delta}`,
      `tags: [crystallization, mutation, autonomous]`,
      "---",
      "",
      `# 🔮 Crystallization — ${dateStr} ${now.toISOString().slice(11, 16)} UTC`,
      "",
      `**Category**: ${c.category}`,
      `**Thought**: \"${c.text}\"`,
      `**Incubated**: ${c.tickCrystallized - c.tickAbsorbed} ticks (absorbed at tick ${c.tickAbsorbed})`,
      "",
      "## Mutation Applied",
      "",
      `| Target | Delta | Description |`,
      `|--------|-------|-------------|`,
      `| ${c.mutation.target} | ${c.mutation.delta > 0 ? "+" : ""}${c.mutation.delta} | ${c.mutation.description} |`,
      "",
      "## Attractor State After Mutation",
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Tension | ${snap.tension.toFixed(1)}% |`,
      `| Energy | ${snap.energy.toFixed(0)}% |`,
      `| Temperature | ${snap.llmTemperature.toFixed(3)} |`,
      `| Valence | ${snap.llmValence >= 0 ? "+" : ""}${snap.llmValence.toFixed(3)} |`,
      `| MaxTokens | ${snap.llmMaxTokens} |`,
      "",
      "---",
      `*The Lorenz attractor's trajectory has been permanently altered.*`,
    ].join("\n");
    safeWriteText(VAULT_PATH, filepath, content)
      .then(() => console.log(`[CRYSTAL] Written: ${filename}`))
      .catch(() => {});
  }
});

stream.log("🟢 Daemon started. Chaos Engine at 174 BPM.");

// Always keep ops outputs artifacts mechanically correct (no LLM required).
// This is a deterministic contract surface for ops questions.
writeOpsOutputsArtifacts({ vaultPath: VAULT_PATH }).catch(() => {});

// ── Initialize Task Memory ────────────────────────────────
const memoryPath = join(VAULT_PATH, "GZMO", "memory.json");
const memory = new TaskMemory(memoryPath);
console.log(`[MEMORY] Loaded ${memory.count} entries from memory.json`);

// ── Initialize Embeddings (Vault RAG) ──────────────────────
const embeddingsPath = join(VAULT_PATH, "GZMO", "embeddings.json");
const embeddings = new EmbeddingsQueue(VAULT_PATH, embeddingsPath, OLLAMA_API_URL);

async function bootEmbeddings(): Promise<void> {
  try {
    console.log("[EMBED] Syncing vault embeddings...");
    const store = await embeddings.initByFullSync();
    stream.log(`📚 Vault indexed: ${store.chunks.length} chunks embedded.`);
  } catch (err: any) {
    console.warn(`[EMBED] Embedding sync failed (non-fatal): ${err?.message}`);
    console.warn("[EMBED] Vault search will be unavailable until embeddings sync.");
  }
}

// ── Initialize Watcher (declared here, started after Ollama gate) ──
const watcher = new VaultWatcher(INBOX_PATH);

let activeTaskCount = 0;
let lastTaskCompletedAt = 0;

watcher.on("task", async (event) => {
  if (!runtime.enableTaskProcessing) return;

  activeTaskCount++;
  const action = event.frontmatter?.action ?? "think";
  stream.log(`📥 Task claimed: **${event.fileName}** (${action})`);

  try {
    await processTask(event, watcher, pulse, embeddings.getStore(), memory);
    stream.log(`✅ Task completed: **${event.fileName}**`);
    lastTaskCompletedAt = Date.now();

    // Ensure completed tasks become searchable for RAG (Inbox is embedded, but not live-watched by default).
    if (embeddings.getStore()) {
      embeddings.enqueueUpsertFile(`GZMO/Inbox/${event.fileName}.md`);
    }
  } catch (err: any) {
    stream.log(`❌ Task failed: **${event.fileName}** — ${err?.message}`);
  }

  activeTaskCount--;
  if (activeTaskCount === 0) {
    stream.log("💤 Idle. Waiting for tasks...");
  }
});

function autonomyAllowed(): boolean {
  // Backpressure rule: don't run autonomy while tasks are in flight,
  // and don't start autonomy immediately after completion (protects p95).
  const cooldownMs = Number.parseInt(process.env.GZMO_AUTONOMY_COOLDOWN_MS ?? "20000", 10);
  const cool = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 20000;
  if (activeTaskCount > 0) return false;
  if (lastTaskCompletedAt && Date.now() - lastTaskCompletedAt < cool) return false;
  return true;
}

// ── Idle Connect Mode (force connection strengthening while idle) ─────────────
// Runs additional Self-Ask cycles when the Inbox has no pending tasks.
const IDLE_CONNECT = String(process.env.GZMO_IDLE_CONNECT_MODE ?? "").toLowerCase() === "on";
let idleConnectRunning = false;
let lastIdleConnectAt = 0;
let idleConnectBackoffMs = 0;

async function inboxHasPending(): Promise<boolean> {
  try {
    const inboxDir = join(VAULT_PATH, "GZMO", "Inbox");
    const files = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      try {
        const raw = await Bun.file(join(inboxDir, f)).text();
        if (/^\s*status:\s*pending\s*$/m.test(raw)) return true;
      } catch {}
    }
  } catch {}
  return false;
}

setInterval(async () => {
  if (!IDLE_CONNECT) return;
  if (!runtime.enableSelfAsk) return;
  if (idleConnectRunning) return;
  if (!embeddings.getStore()) return;
  if (await inboxHasPending()) return; // stop immediately if a real task landed
  if (!autonomyAllowed()) return;

  const now = Date.now();
  const baseCooldown = 8 * 60 * 1000; // 8 minutes
  const cooldown = baseCooldown + idleConnectBackoffMs;
  if (now - lastIdleConnectAt < cooldown) return;

  const snap = pulse.snapshot();
  // Reuse SelfAskEngine gating (it also checks energy/tension).
  idleConnectRunning = true;
  try {
    const results = await selfAsk.cycle(snap, embeddings.getStore()!, OLLAMA_API_URL, infer);
    if (results.length > 0) {
      // lightweight quality aggregation: score based on citations/no-connection (no extra LLM calls)
      const scores = results.map((r) => scoreSelfAskOutput({ output: r.output, packet: undefined }).score);
      const avg = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
      // Backoff if quality is poor (prevents spam overnight)
      idleConnectBackoffMs = avg < 55 ? Math.min(60 * 60 * 1000, idleConnectBackoffMs + 10 * 60 * 1000) : Math.max(0, idleConnectBackoffMs - 5 * 60 * 1000);
      stream.log(`🧩 Idle-connect: ran self-ask (${results.length} results, quality~${avg.toFixed(0)}/100, backoff=${Math.round(idleConnectBackoffMs / 60000)}m)`);
    }
  } catch (err: any) {
    console.warn(`[IDLE-CONNECT] self-ask failed: ${err?.message}`);
    idleConnectBackoffMs = Math.min(60 * 60 * 1000, idleConnectBackoffMs + 10 * 60 * 1000);
  } finally {
    lastIdleConnectAt = Date.now();
    idleConnectRunning = false;
  }
}, 60_000);

// ── Self-Ask Quality Report (nightly-ish, lightweight) ──────────────────────
let nextSelfAskReportTime = Date.now() + 20 * 60 * 1000; // warmup 20min
setInterval(async () => {
  if (!runtime.enableSelfAsk) return;
  if (Date.now() < nextSelfAskReportTime) return;
  try {
    await writeSelfAskQualityReport({ vaultPath: VAULT_PATH, lookbackFiles: 80 });
  } catch (err: any) {
    console.warn(`[SELF-ASK-REPORT] Failed: ${err?.message}`);
  }
  // run every 12h (keeps it “overnight” without being noisy)
  nextSelfAskReportTime = Date.now() + 12 * 60 * 60 * 1000;
}, 60_000);

// ── Boot Sequence (Ollama-gated) ──────────────────────────────
(async () => {
  const ollamaReady = await waitForOllama(OLLAMA_API_URL);

  if (!ollamaReady) {
    console.error("[CRITICAL] Ollama unreachable after all retries. Inference, dreams, and self-ask DISABLED.");
    console.error("[CRITICAL] Start Ollama and restart the daemon: sudo systemctl start ollama && systemctl --user restart gzmo-daemon");
    stream.log("🔴 **Ollama unreachable** — inference disabled. Start Ollama and restart daemon.");
    // Don't exit — keep the heartbeat alive so the operator can see LiveStream status
  } else {
    // Boot embeddings only after Ollama is confirmed
    if (runtime.enableEmbeddingsInitialSync) {
      await bootEmbeddings();
    } else {
      console.log("[EMBED] Initial embeddings sync disabled by profile.");
    }
  }

  // ── Embedding Live-Sync (wiki watcher) ─────────────────────
  if (embeddings.getStore() && runtime.enableEmbeddingsLiveSync) {
    const chokidarMod = await import("chokidar");
    const { watch } = chokidarMod;
    const WATCH_DIRS = [
      join(VAULT_PATH, "wiki"),
      join(VAULT_PATH, "GZMO", "Thought_Cabinet"),
    ];

    const embedWatcher = watch(WATCH_DIRS, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    });

    let embedDebounce: ReturnType<typeof setTimeout> | null = null;
    const pendingFiles = new Set<string>();

    const processEmbedQueue = async () => {
      if (!embeddings.getStore()) return;
      const files = [...pendingFiles];
      pendingFiles.clear();
      for (const fullPath of files) {
        const relPath = relative(VAULT_PATH, fullPath).replace(/\\/g, "/");
        try {
          embeddings.enqueueUpsertFile(relPath);
          console.log(`[EMBED] Live-synced: ${relPath}`);
        } catch {
          // non-fatal
        }
      }
    };

    const onFileEvent = (filePath: string) => {
      if (!filePath.endsWith(".md")) return;
      pendingFiles.add(filePath);
      if (embedDebounce) clearTimeout(embedDebounce);
      embedDebounce = setTimeout(processEmbedQueue, 3000);
    };

    embedWatcher.on("change", onFileEvent);
    embedWatcher.on("add", onFileEvent);
    embedWatcher.on("unlink", async (filePath: string) => {
      if (!filePath.endsWith(".md")) return;
      if (!embeddings.getStore()) return;
      const relPath = relative(VAULT_PATH, filePath).replace(/\\/g, "/");
      try {
        embeddings.enqueueRemoveFile(relPath);
        console.log(`[EMBED] Removed embeddings for deleted file: ${relPath}`);
      } catch {
        // non-fatal
      }
    });

    console.log("[EMBED] Live-sync watcher started on wiki/ + Thought_Cabinet/");
  } else if (!runtime.enableEmbeddingsLiveSync) {
    console.log("[EMBED] Live-sync watcher disabled by profile.");
  }

  // ── Start Watcher (only after Ollama gate) ────────────────────
  if (runtime.enableInboxWatcher) {
    watcher.start();
  } else {
    console.log("[WATCHER] Inbox watcher disabled by profile.");
  }
})();

// ── Initialize Dream Engine ────────────────────────────────
const dreams = new DreamEngine(VAULT_PATH);
const honeypotPromotion = new HoneypotPromotionEngine(VAULT_PATH);

// Dream cycle: chaos-responsive interval (15-45min depending on tension)
const DREAM_BASE_MS = 30 * 60 * 1000;
let nextDreamTime = Date.now() + DREAM_BASE_MS;

setInterval(async () => {
  if (!runtime.enableDreams) return;
  if (Date.now() < nextDreamTime) return;
  if (!autonomyAllowed()) return;

  const snap = pulse.snapshot();
  if (!snap.alive || snap.energy < 20) return;

  try {
    const result = await dreams.dream(snap, infer, embeddings.getStore() ?? undefined, OLLAMA_API_URL);
    if (result) {
      stream.log(`🌙 Dream crystallized from **${result.taskFile}**`);
      pulse.emitEvent({ type: "dream_proposed", dreamText: result.insights.slice(0, 200) });

      // Re-embed the new dream file
      if (embeddings.getStore()) {
        const dreamFileName = basename(result.vaultPath);
        const dreamRelPath = `GZMO/Thought_Cabinet/${dreamFileName}`;
        embeddings.enqueueUpsertFile(dreamRelPath);
      }
    }
  } catch (err: any) {
    console.error(`[DREAM] Dream cycle error: ${err?.message}`);
  }

  // Honeypot promotion pass: turn accumulated self-ask intersections into promoted nodes.
  // Runs on the same cadence as dreams (bounded by promotion budget and digest).
  try {
    const promo = await honeypotPromotion.cycle();
    if (promo.promoted > 0) {
      stream.log(`🍯 Honeypot promotion: ${promo.promoted} nodes`);
      for (const n of promo.nodes) stream.log(`🍯 Promoted honeypot: **${n}**`);
    }
  } catch {
    // non-fatal
  }

  // Core Wisdom compiler pass: keep wiki/overview.md as the last honeypot.
  try {
    await compileCoreWisdom(VAULT_PATH, "Dream cycle maintenance pass");
  } catch {
    // non-fatal
  }

  // Chaos-driven next interval: high tension = dream sooner, low = dream later
  const snap2 = pulse.snapshot();
  const tensionFactor = 1.0 - (snap2.tension / 100) * 0.5; // 0.5–1.0
  const nextMs = Math.round(DREAM_BASE_MS * tensionFactor);
  nextDreamTime = Date.now() + nextMs;
  console.log(`[DREAM] Next dream in ${(nextMs / 60000).toFixed(0)}min (tension=${snap2.tension.toFixed(0)})`);
}, 60_000); // Check every minute

// ── Core Wisdom cycle: runs hourly (lightweight) ─────────────────────────────
const CORE_WISDOM_BASE_MS = 60 * 60 * 1000;
let nextCoreWisdomTime = Date.now() + 7 * 60 * 1000; // warmup 7min

setInterval(async () => {
  if (Date.now() < nextCoreWisdomTime) return;
  try {
    await compileCoreWisdom(VAULT_PATH, "Scheduled core wisdom compilation");
    stream.log("🧠 Core Wisdom updated: `wiki/overview.md`");
  } catch (err: any) {
    console.error(`[CORE_WISDOM] Compile failed: ${err?.message}`);
  }
  nextCoreWisdomTime = Date.now() + CORE_WISDOM_BASE_MS;
}, 60_000);

// ── Initialize Self-Ask Engine ─────────────────────────────
const selfAsk = new SelfAskEngine(VAULT_PATH);

// Self-Ask cycle: chaos-responsive (1-3h depending on energy)
const SELFASK_BASE_MS = 2 * 60 * 60 * 1000;
let nextSelfAskTime = Date.now() + SELFASK_BASE_MS;

setInterval(async () => {
  if (!runtime.enableSelfAsk) return;
  if (Date.now() < nextSelfAskTime) return;
  if (!autonomyAllowed()) return;

  const snap = pulse.snapshot();
  if (!snap.alive || !embeddings.getStore()) return;
  // Skip if energy too low (conserve resources)
  if (snap.energy < 30) {
    console.log(`[SELF-ASK] Skipped — energy too low (${snap.energy.toFixed(0)}%)`);
    nextSelfAskTime = Date.now() + 30 * 60 * 1000; // retry in 30min
    return;
  }

  try {
    const results = await selfAsk.cycle(snap, embeddings.getStore()!, OLLAMA_API_URL, infer);
    for (const result of results) {
      stream.log(`🔍 Self-Ask (${result.strategy}): ${result.output.slice(0, 80).replace(/\\n/g, " ")}`);
      pulse.emitEvent({ type: "self_ask_completed", strategy: result.strategy, result: result.output });

      // Re-embed the new self-ask file
      if (result.vaultPath && embeddings.getStore()) {
        const fileName = basename(result.vaultPath);
        const relPath = `GZMO/Thought_Cabinet/${fileName}`;
        embeddings.enqueueUpsertFile(relPath);
      }
    }
    if (results.length > 0) {
      stream.log(`🔍 Self-Ask cycle complete: ${results.length} strategies ran.`);
    }
  } catch (err: any) {
    console.error(`[SELF-ASK] Cycle error: ${err?.message}`);
  }

  // Chaos-driven next interval: high energy = think sooner
  const snap2 = pulse.snapshot();
  const energyFactor = 1.5 - (snap2.energy / 100); // 0.5–1.5
  const nextMs = Math.round(SELFASK_BASE_MS * energyFactor);
  nextSelfAskTime = Date.now() + nextMs;
  console.log(`[SELF-ASK] Next cycle in ${(nextMs / 3600000).toFixed(1)}h (energy=${snap2.energy.toFixed(0)}%)`);
}, 60_000); // Check every minute

// ── Initialize Wiki Engine (Autonomous Knowledge Builder) ───
const srcPath = resolve(import.meta.dir, "src");
const wikiEngine = new WikiEngine(VAULT_PATH, srcPath);

// ── Initialize Ingest Engine (raw/ → wiki/sources) ───────────────
const ingestEngine = new IngestEngine(VAULT_PATH);

// Wiki cycle: runs every 1h, consolidates Thought_Cabinet → wiki/
const WIKI_BASE_MS = 60 * 60 * 1000;
let nextWikiTime = Date.now() + 5 * 60 * 1000; // First run after 5min warmup

setInterval(async () => {
  if (!runtime.enableWiki) return;
  if (Date.now() < nextWikiTime) return;
  if (!autonomyAllowed()) return;

  const snap = pulse.snapshot();
  if (!snap.alive || snap.energy < 25) return;

  try {
    const results = await wikiEngine.cycle(infer, embeddings.getStore() ?? undefined, OLLAMA_API_URL);
    for (const result of results) {
      stream.log(`📖 Wiki created: **${result.title}** (${result.sourceCount} sources → wiki/${result.category})`);
      pulse.emitEvent({ type: "wiki_consolidated", pageTitle: result.title });

      // Re-embed the new wiki page
      if (embeddings.getStore()) {
        const relPath = result.wikiPath.replace(VAULT_PATH + "/", "");
        embeddings.enqueueUpsertFile(relPath);
      }
    }
    if (results.length > 0) {
      stream.log(`📖 Wiki cycle complete: ${results.length} pages created.`);
    }
  } catch (err: any) {
    console.error(`[WIKI] Cycle error: ${err?.message}`);
  }

  nextWikiTime = Date.now() + WIKI_BASE_MS;
  console.log(`[WIKI] Next cycle in 60min`);
}, 60_000); // Check every minute

// ── Ingest cycle: runs every 15min, processes ONE raw source ──────
const INGEST_BASE_MS = 15 * 60 * 1000;
let nextIngestTime = Date.now() + 2 * 60 * 1000; // warmup 2min

setInterval(async () => {
  if (!runtime.enableIngest) return;
  if (Date.now() < nextIngestTime) return;
  if (!autonomyAllowed()) return;

  const snap = pulse.snapshot();
  if (!snap.alive || snap.energy < 30) return;

  try {
    const result = await ingestEngine.cycle(infer, {
      embeddingStore: embeddings.getStore() ?? undefined,
      ollamaUrl: OLLAMA_API_URL,
    });
    if (result) {
      stream.log(`📚 Ingested raw source → **${result.title}**`);
      // Re-embed the new source summary
      if (embeddings.getStore()) {
        const relPath = result.summaryWikiPath.replace(VAULT_PATH + "/", "");
        embeddings.enqueueUpsertFile(relPath);
      }
    } else {
      stream.log("📚 Ingest idle — no new raw sources.");
    }
  } catch (err: any) {
    console.error(`[INGEST] Cycle error: ${err?.message}`);
  }

  nextIngestTime = Date.now() + INGEST_BASE_MS;
}, 60_000);

// ── Wiki Lint: runs weekly (or on-demand), writes report + logs ─────
const LINT_BASE_MS = 7 * 24 * 60 * 60 * 1000;
let nextLintTime = Date.now() + 10 * 60 * 1000; // first lint after 10min warmup

setInterval(async () => {
  if (!runtime.enableWikiLint) return;
  if (Date.now() < nextLintTime) return;
  if (!autonomyAllowed()) return;
  const snap = pulse.snapshot();
  if (!snap.alive || snap.energy < 25) return;

  try {
    const report = await runWikiLint(VAULT_PATH, { staleDays: 30 });
    const autofix = report.autoFix?.enabled
      ? ` autofix(normalized=${report.autoFix.normalizedPages}, index=${report.autoFix.indexRebuilt})`
      : "";
    stream.log(`🧹 Wiki lint complete: ${report.findings.length} findings${autofix} (see GZMO/wiki-lint-report.md)`);
  } catch (err: any) {
    console.error(`[LINT] Wiki lint failed: ${err?.message}`);
  }

  nextLintTime = Date.now() + LINT_BASE_MS;
}, 60_000);

// ── Initialize Pruning Engine (Purposeful Forgetting) ───────
const pruner = new PruningEngine(VAULT_PATH);
setInterval(async () => {
  if (!runtime.enablePruning) return;
  const snap = pulse.snapshot();
  // Pruning checks every minute, Pruner internally ticks and only prunes if enough time passed
  await pruner.tick(snap.tension, snap.energy);
}, 60_000);

// ── Anchor indexing + eval quality reports (bounded, low frequency) ─────────
let nextAnchorIndexTime = Date.now() + 25 * 60 * 1000; // warmup 25min
let nextEvalQualityTime = Date.now() + 30 * 60 * 1000; // warmup 30min
setInterval(async () => {
  const snap = pulse.snapshot();
  if (!snap.alive || snap.energy < 25) return;
  const store = embeddings.getStore();
  if (!store) return;

  // Anchor index every 24h.
  if (Date.now() >= nextAnchorIndexTime) {
    try {
      const { writeAnchorArtifacts } = await import("./src/anchor_index");
      await writeAnchorArtifacts({ vaultPath: VAULT_PATH, store });
      stream.log("🧷 Anchor index updated (GZMO/anchor-index.json).");
    } catch (err: any) {
      console.warn(`[ANCHOR] Failed: ${err?.message}`);
    }
    nextAnchorIndexTime = Date.now() + 24 * 60 * 60 * 1000;
  }

  // Eval harness every 12h.
  if (Date.now() >= nextEvalQualityTime) {
    try {
      const { runEvalHarness } = await import("./src/eval_harness");
      const res = await runEvalHarness();
      const { safeWriteText, atomicWriteJson } = await import("./src/vault_fs");
      await atomicWriteJson(VAULT_PATH, join(VAULT_PATH, "GZMO", "retrieval-metrics.json"), res, 2);
      await safeWriteText(VAULT_PATH, join(VAULT_PATH, "GZMO", "rag-quality.md"), [
        "---",
        "type: operational_report",
        `generated_at: ${new Date().toISOString()}`,
        "---",
        "",
        "# RAG Quality Gate",
        "",
        `- ok: **${res.ok}**`,
        `- summary: ${res.summary}`,
        "",
        "## Metrics",
        "",
        "```json",
        JSON.stringify(res.metrics, null, 2),
        "```",
        "",
        ...(res.details.length ? ["## Details", "", ...res.details.map((d) => `- ${d}`), ""] : []),
      ].join("\n"));
      stream.log(`🧪 Eval harness: ${res.ok ? "PASS" : "FAIL"} (see GZMO/rag-quality.md)`);
    } catch (err: any) {
      console.warn(`[EVAL] Failed: ${err?.message}`);
    }
    nextEvalQualityTime = Date.now() + 12 * 60 * 60 * 1000;
  }
}, 60_000);
// Upgrade 4: LiveStream dashboard pulse (every 60s)
setInterval(() => {
  if (!runtime.enableDashboardPulse) return;
  const snap = pulse.snapshot();
  const v = snap.llmValence >= 0 ? `+${snap.llmValence.toFixed(2)}` : snap.llmValence.toFixed(2);
  stream.log(
    `💓 T=${snap.tension.toFixed(0)} E=${snap.energy.toFixed(0)}% ${snap.phase} | temp=${snap.llmTemperature.toFixed(2)} val=${v} tok=${snap.llmMaxTokens} | 🧠 ${snap.thoughtsIncubating} incubating, ${snap.thoughtsCrystallized} crystallized`,
  );

  // Feed heartbeat back into chaos engine
  pulse.emitEvent({ type: "heartbeat_fired", energy: snap.energy });
}, 60_000);

// ── Health report (every 60s) ───────────────────────────────
setInterval(async () => {
  const snap = pulse.snapshot();
  const inboxDir = join(VAULT_PATH, "GZMO", "Inbox");
  const cabinetDir = join(VAULT_PATH, "GZMO", "Thought_Cabinet");
  const quarantineDir = join(VAULT_PATH, "GZMO", "Quarantine");

  let inboxPending = 0, inboxProcessing = 0, inboxCompleted = 0, inboxFailed = 0;
  try {
    const files = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      try {
        const raw = await Bun.file(join(inboxDir, f)).text();
        const m = raw.match(/^\s*status:\s*(\w+)\s*$/m);
        const s = (m?.[1] ?? "").toLowerCase();
        if (s === "pending") inboxPending++;
        else if (s === "processing") inboxProcessing++;
        else if (s === "completed") inboxCompleted++;
        else if (s === "failed") inboxFailed++;
      } catch {}
    }
  } catch {}

  const cabinetNotes = (() => {
    try { return readdirSync(cabinetDir).filter((f) => f.endsWith(".md")).length; } catch { return 0; }
  })();
  const quarantineNotes = (() => {
    try { return readdirSync(quarantineDir).filter((f) => f.endsWith(".md")).length; } catch { return 0; }
  })();

  await writeHealth({
    vaultPath: VAULT_PATH,
    profile: runtime.name,
    ollamaUrl: OLLAMA_API_URL,
    model: process.env.OLLAMA_MODEL ?? "hermes3:8b",
    pulse: {
      tension: snap.tension,
      energy: snap.energy,
      phase: snap.phase,
      alive: snap.alive,
      deaths: snap.deaths,
      tick: snap.tick,
      thoughtsIncubating: snap.thoughtsIncubating,
      thoughtsCrystallized: snap.thoughtsCrystallized,
    },
    scheduler: {
      dreamsEnabled: runtime.enableDreams,
      selfAskEnabled: runtime.enableSelfAsk,
      wikiEnabled: runtime.enableWiki,
      ingestEnabled: runtime.enableIngest,
      wikiLintEnabled: runtime.enableWikiLint,
      pruningEnabled: runtime.enablePruning,
      embeddingsLiveEnabled: runtime.enableEmbeddingsLiveSync,
    },
    counts: {
      inboxPending,
      inboxProcessing,
      inboxCompleted,
      inboxFailed,
      cabinetNotes,
      quarantineNotes,
    },
  }).catch(() => {});
}, 60_000);

// ── Graceful Shutdown ──────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`\n[DAEMON] Received ${signal}. Shutting down...`);
  stream.log(`🔴 Daemon shutting down (${signal}).`);

  // Abort any in-flight LLM inference calls
  daemonAbort.abort();

  stream.destroy(); // Flush buffered log entries
  pulse.stop();
  await watcher.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));