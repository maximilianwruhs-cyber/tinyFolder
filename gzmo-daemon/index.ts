/**
 * GZMO Daemon v0.3.0 — Core + Art Edition
 *
 * Boot modes are controlled by GZMO_PROFILE:
 *   core     — inbox, tasks, embeddings, memory (work mode)
 *   standard — core + pruning + dashboard pulse
 *   full     — everything (art project)
 *   minimal  — core without embeddings sync
 *   heartbeat— watcher + task processing off, pulse only
 *
 * Usage (foreground):
 *   GZMO_PROFILE=core bun run index.ts
 */

import { resolve, join, relative, basename } from "path";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { VaultWatcher } from "./src/watcher";
import { processTask, infer } from "./src/engine";
import { LiveStream } from "./src/stream";
import { PulseLoop } from "./src/pulse";
import { defaultConfig, type ChaosSnapshot } from "./src/types";
import type { TriggerFired } from "./src/triggers";
import { TaskMemory } from "./src/memory";
import { safeWriteText } from "./src/vault_fs";
import { describeRuntimeProfile, resolveRuntimeProfile } from "./src/runtime_profile";
import { EmbeddingsQueue } from "./src/embeddings_queue";
import { writeHealth } from "./src/health";
import { writeOpsOutputsArtifacts } from "./src/ops_outputs_artifact";
import { readBoolEnv } from "./src/pipelines/helpers";
import { atomicWriteJson } from "./src/vault_fs";
import { invalidateEmbeddingSearchCache } from "./src/search";

// ── Global Abort Controller (for graceful shutdown of in-flight inference) ──
export const daemonAbort = new AbortController();

// ── Resolve Vault Path ─────────────────────────────────────
const VAULT_PATH = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../vault");
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

// Defaults for the "max finesse" retrieval stack (can be overridden by env).
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
    await new Promise((r) => setTimeout(r, delay));
  }
  return false;
}

// ── Initialize LiveStream ──────────────────────────────────
const stream = new LiveStream(VAULT_PATH);

// ── Initialize PulseLoop (only when art subsystems need it) ──
const needsPulse =
  runtime.enableDashboardPulse ||
  runtime.enableDreams ||
  runtime.enableSelfAsk ||
  runtime.enableWiki ||
  runtime.enableIngest ||
  runtime.enableWikiLint ||
  runtime.enablePruning;

let pulse: PulseLoop | undefined;
if (needsPulse) {
  pulse = new PulseLoop(defaultConfig());
  const snapshotPath = join(VAULT_PATH, "GZMO", "CHAOS_STATE.json");
  pulse.start(snapshotPath);

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
        `time: "${now.toISOString().slice(11, 19)}"`,
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
        `**Thought**: "${c.text}"`,
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
     safeWriteText(VAULT_PATH, filepath, content).catch(() => {});
   }
  });
  stream.log("🟢 Daemon started. Chaos Engine at 174 BPM.");
} else {
  stream.log("🟢 Daemon started (core mode — no chaos pulse).");
}

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

    if (readBoolEnv("GZMO_ENABLE_TRACE_MEMORY", false)) {
      const { syncTracesIntoStore } = await import("./src/learning/sync_traces");
      const added = await syncTracesIntoStore(VAULT_PATH, store, OLLAMA_API_URL);
      if (added > 0) {
        invalidateEmbeddingSearchCache(store);
        await atomicWriteJson(VAULT_PATH, "GZMO/embeddings.json", store, 0);
        store.dirty = false;
      }
    }

    if (readBoolEnv("GZMO_LEARNING_BACKFILL", false)) {
      const { backfillLedgerFromPerf } = await import("./src/learning/build_ledger");
      await backfillLedgerFromPerf(VAULT_PATH, true);
    }
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
    if (embeddings.getStore()) {
      embeddings.enqueueUpsertFile(`GZMO/Inbox/${event.fileName}.md`);
    }
  } catch (err: any) {
    stream.log(`❌ Task failed: **${event.fileName}** — ${err?.message}`);
  }
  activeTaskCount--;
  if (activeTaskCount === 0) stream.log("💤 Idle. Waiting for tasks...");
});

function autonomyAllowed(): boolean {
  const cooldownMs = Number.parseInt(process.env.GZMO_AUTONOMY_COOLDOWN_MS ?? "20000", 10);
  const cool = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 20000;
  if (activeTaskCount > 0) return false;
  if (lastTaskCompletedAt && Date.now() - lastTaskCompletedAt < cool) return false;
  return true;
}

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

// ── Boot Sequence (Ollama-gated) ──────────────────────────────
(async () => {
  const ollamaReady = await waitForOllama(OLLAMA_API_URL);
  if (!ollamaReady) {
    console.error("[CRITICAL] Ollama unreachable after all retries. Inference and RAG DISABLED.");
    stream.log("🔴 **Ollama unreachable** — inference disabled.");
  } else {
    if (runtime.enableEmbeddingsInitialSync) await bootEmbeddings();
    else console.log("[EMBED] Initial embeddings sync disabled by profile.");
  }

  if (embeddings.getStore() && runtime.enableEmbeddingsLiveSync) {
    const chokidarMod = await import("chokidar");
    const { watch } = chokidarMod;
    const embedWatcher = watch([join(VAULT_PATH, "wiki"), join(VAULT_PATH, "GZMO", "Thought_Cabinet")], {
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
        } catch {}
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
      } catch {}
    });
    console.log("[EMBED] Live-sync watcher started on wiki/ + Thought_Cabinet/");
  } else if (!runtime.enableEmbeddingsLiveSync) {
    console.log("[EMBED] Live-sync watcher disabled by profile.");
  }

  if (runtime.enableInboxWatcher) {
    watcher.start();
  } else {
    console.log("[WATCHER] Inbox watcher disabled by profile.");
  }
})();

// ── Art Module: Dream Engine ───────────────────────────────
let dreamsModule: any;
if (runtime.enableDreams) {
  const DREAM_BASE_MS = 30 * 60 * 1000;
  let nextDreamTime = Date.now() + DREAM_BASE_MS;

  setInterval(async () => {
    if (!runtime.enableDreams || !pulse) return;
    if (!dreamsModule?.dream) {
      const mod = await import("./src/dreams");
      dreamsModule = { dream: mod.DreamEngine.prototype.dream, engine: new mod.DreamEngine(VAULT_PATH) };
    }
    if (Date.now() < nextDreamTime) return;
    if (!autonomyAllowed()) return;
    const snap = pulse.snapshot();
    if (!snap.alive || snap.energy < 20) return;
    try {
      const result = await dreamsModule.engine.dream(snap, infer, embeddings.getStore() ?? undefined, OLLAMA_API_URL);
      if (result) {
        stream.log(`🌙 Dream crystallized from **${result.taskFile}**`);
        pulse.emitEvent({ type: "dream_proposed", dreamText: result.insights.slice(0, 200) });
        if (embeddings.getStore()) {
          embeddings.enqueueUpsertFile(`GZMO/Thought_Cabinet/${basename(result.vaultPath)}`);
        }
      }
    } catch (err: any) {
      console.error(`[DREAM] Error: ${err?.message}`);
    }
    const snap2 = pulse.snapshot();
    const tensionFactor = 1.0 - (snap2.tension / 100) * 0.5;
    nextDreamTime = Date.now() + Math.round(DREAM_BASE_MS * tensionFactor);
  }, 60_000);
}

// ── Art Module: Self-Ask Engine ────────────────────────────
let selfAskModule: any;
if (runtime.enableSelfAsk) {
  setInterval(async () => {
    if (!runtime.enableSelfAsk || !pulse) return;
    if (!selfAskModule) {
      const mod = await import("./src/self_ask");
      const edges = await import("./src/honeypot_edges");
      selfAskModule = new mod.SelfAskEngine(VAULT_PATH, new edges.JsonlEdgeStore(VAULT_PATH));
    }
    if (!autonomyAllowed()) return;
    const snap = pulse.snapshot();
    if (!snap.alive || !embeddings.getStore()) return;
    if (snap.energy < 30) return;
    try {
      const results = await selfAskModule.cycle(snap, embeddings.getStore()!, OLLAMA_API_URL, infer);
      for (const result of results) {
        stream.log(`🔍 Self-Ask (${result.strategy}): ${result.output.slice(0, 80).replace(/\n/g, " ")}`);
        pulse.emitEvent({ type: "self_ask_completed", strategy: result.strategy, result: result.output });
        if (result.vaultPath && embeddings.getStore()) {
          embeddings.enqueueUpsertFile(`GZMO/Thought_Cabinet/${basename(result.vaultPath)}`);
        }
      }
    } catch (err: any) {
      console.error(`[SELF-ASK] Error: ${err?.message}`);
    }
  }, 60_000);
}

// ── Art Module: Wiki Engine ────────────────────────────────
let wikiEngineInstance: any;
if (runtime.enableWiki) {
  const srcPath = resolve(import.meta.dir, "src");
  import("./src/wiki_engine").then((mod) => {
    wikiEngineInstance = new mod.WikiEngine(VAULT_PATH, srcPath);
  });

  let nextWikiTime = Date.now() + 5 * 60 * 1000;
  setInterval(async () => {
    if (!runtime.enableWiki || !pulse || !wikiEngineInstance) return;
    if (Date.now() < nextWikiTime) return;
    if (!autonomyAllowed()) return;
    const snap = pulse.snapshot();
    if (!snap.alive || snap.energy < 25) return;
    try {
      const results = await wikiEngineInstance.cycle(infer, embeddings.getStore() ?? undefined, OLLAMA_API_URL);
      for (const result of results) {
        stream.log(`📖 Wiki created: **${result.title}**`);
        pulse.emitEvent({ type: "wiki_consolidated", pageTitle: result.title });
        if (embeddings.getStore()) {
          embeddings.enqueueUpsertFile(result.wikiPath.replace(VAULT_PATH + "/", ""));
        }
      }
    } catch (err: any) {
      console.error(`[WIKI] Error: ${err?.message}`);
    }
    nextWikiTime = Date.now() + 60 * 60 * 1000;
  }, 60_000);
}

// ── Art Module: Ingest Engine ──────────────────────────────
let ingestEngineInstance: any;
if (runtime.enableIngest) {
  import("./src/ingest_engine").then((mod) => {
    ingestEngineInstance = new mod.IngestEngine(VAULT_PATH);
  });

  let nextIngestTime = Date.now() + 2 * 60 * 1000;
  setInterval(async () => {
    if (!runtime.enableIngest || !pulse || !ingestEngineInstance) return;
    if (Date.now() < nextIngestTime) return;
    if (!autonomyAllowed()) return;
    const snap = pulse.snapshot();
    if (!snap.alive || snap.energy < 30) return;
    try {
      const result = await ingestEngineInstance.cycle(infer, {
        embeddingStore: embeddings.getStore() ?? undefined,
        ollamaUrl: OLLAMA_API_URL,
      });
      if (result) {
        stream.log(`📚 Ingested raw source → **${result.title}**`);
        if (embeddings.getStore()) {
          embeddings.enqueueUpsertFile(result.summaryWikiPath.replace(VAULT_PATH + "/", ""));
        }
      }
    } catch (err: any) {
      console.error(`[INGEST] Error: ${err?.message}`);
    }
    nextIngestTime = Date.now() + 15 * 60 * 1000;
  }, 60_000);
}

// ── Art Module: Wiki Lint ──────────────────────────────────
if (runtime.enableWikiLint) {
  let nextLintTime = Date.now() + 10 * 60 * 1000;
  setInterval(async () => {
    if (!runtime.enableWikiLint || !pulse || Date.now() < nextLintTime) return;
    if (!autonomyAllowed()) return;
    const snap = pulse.snapshot();
    if (!snap.alive || snap.energy < 25) return;
    try {
      const { runWikiLint } = await import("./src/wiki_lint");
      await runWikiLint(VAULT_PATH, { staleDays: 30 });
      stream.log("🧹 Wiki lint complete");
    } catch (err: any) {
      console.error(`[LINT] Error: ${err?.message}`);
    }
    nextLintTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }, 60_000);
}

// ── Art Module: Pruning Engine ─────────────────────────────
let pruner: any;
if (runtime.enablePruning) {
  import("./src/prune").then((mod) => {
    pruner = new mod.PruningEngine(VAULT_PATH);
  });
  setInterval(async () => {
    if (!runtime.enablePruning || !pulse || !pruner) return;
    const snap = pulse.snapshot();
    await pruner.tick(snap.tension, snap.energy);
  }, 60_000);
}

// ── Art Module: Dashboard Pulse ────────────────────────────
if (runtime.enableDashboardPulse) {
  setInterval(() => {
    if (!runtime.enableDashboardPulse || !pulse) return;
    const snap = pulse.snapshot();
    const v = snap.llmValence >= 0 ? `+${snap.llmValence.toFixed(2)}` : snap.llmValence.toFixed(2);
    stream.log(
      `💓 T=${snap.tension.toFixed(0)} E=${snap.energy.toFixed(0)}% ${snap.phase} | temp=${snap.llmTemperature.toFixed(2)} val=${v} tok=${snap.llmMaxTokens} | 🧠 ${snap.thoughtsIncubating} incubating, ${snap.thoughtsCrystallized} crystallized`,
    );
    pulse.emitEvent({ type: "heartbeat_fired", energy: snap.energy });
  }, 60_000);
}

// ── Health report (every 60s) ───────────────────────────────
setInterval(async () => {
  const snap = pulse?.snapshot();
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
    pulse: snap
      ? {
          tension: snap.tension,
          energy: snap.energy,
          phase: snap.phase,
          alive: snap.alive,
          deaths: snap.deaths,
          tick: snap.tick,
          thoughtsIncubating: snap.thoughtsIncubating,
          thoughtsCrystallized: snap.thoughtsCrystallized,
        }
      : undefined,
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
  daemonAbort.abort();
  stream.destroy();
  pulse?.stop();
  await watcher.stop();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
