/**
 * doctor.ts — Smart Doctor v3 (self-healing loop)
 *
 * Default behavior:
 * - Deep profile
 * - Readonly (no vault mutations)
 * - Writes reports to repo (`gzmo/doctor-report.{md,json}`)
 *
 * Enable vault-writing checks (Inbox, Dream/SelfAsk, wiki engine) with `--write`.
 *
 * Self-healing mode:
 *   --heal              Attempt safe auto-fixes for FAIL/WARN steps, then re-run.
 *   --heal-retries N    Max iterations (default 3).
 *   --heal-delay-ms N   Milliseconds to wait between heal and re-run (default 2000).
 */

import { resolve, join } from "path";
import * as fs from "fs";

import { parseDoctorFlags } from "./src/doctor/flags";
import { runStep } from "./src/doctor/runner";
import { discoverOllama, ollamaChatJson } from "./src/doctor/ollama";
import { reportToMarkdown, writeDoctorReports } from "./src/doctor/report";
import type { DoctorEnvironment, DoctorReport, DoctorStepResult, HealingExecution } from "./src/doctor/types";
import { applyHealing, compareStepSets, shouldHealAgain } from "./src/doctor/healer";

import { runWikiLint } from "./src/wiki_lint";
import { syncEmbeddings } from "./src/embeddings";
import { EmbeddingsQueue } from "./src/embeddings_queue";
import { describeRuntimeProfile, resolveRuntimeProfile } from "./src/runtime_profile";
import {
  readAutoInboxFromDreams,
  readAutoInboxFromSelfAsk,
  readAutoInboxFromWikiRepair,
  maxAutoTasksPerHourDefault,
} from "./src/pipelines/helpers";
import { defaultConfig } from "./src/types";
import { PulseLoop } from "./src/pulse";
import { VaultWatcher } from "./src/watcher";
import { processTask } from "./src/engine";
import { TaskMemory } from "./src/memory";
import type { TaskEvent } from "./src/watcher";
import type { EmbeddingStore } from "./src/embeddings";
import type { ChaosSnapshot } from "./src/types";
import { TaskDocument } from "./src/frontmatter";

function resolveVaultPath(): string {
  return process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(import.meta.dir, "../vault");
}

function computeEnv(): DoctorEnvironment {
  const vaultPath = resolveVaultPath();
  const inboxPath = join(vaultPath, "GZMO", "Inbox");
  const thoughtCabinetPath = join(vaultPath, "GZMO", "Thought_Cabinet");
  const embeddingsPath = join(vaultPath, "GZMO", "embeddings.json");
  const preferredV1 = process.env.OLLAMA_URL;
  return {
    cwd: process.cwd(),
    vaultPath,
    inboxPath,
    thoughtCabinetPath,
    embeddingsPath,
    ollamaUrlV1: preferredV1,
    model: process.env.OLLAMA_MODEL,
    proxy: {
      http: process.env.http_proxy ?? process.env.HTTP_PROXY,
      https: process.env.https_proxy ?? process.env.HTTPS_PROXY,
      noProxy: process.env.no_proxy ?? process.env.NO_PROXY,
    },
  };
}

function printHeader(flags: ReturnType<typeof parseDoctorFlags>, env: DoctorEnvironment) {
  console.log("════════════════════════════════════════════════════");
  console.log("  GZMO Doctor v3");
  console.log("════════════════════════════════════════════════════");
  console.log(`Profile: ${flags.profile}`);
  console.log(`Mode:    ${flags.readonly ? "readonly" : "write"}`);
  if (flags.heal) {
    console.log(`Healing: enabled (retries=${flags.healRetries}, delay=${flags.healDelayMs}ms)`);
  }
  console.log(`Vault:   ${env.vaultPath}`);
  console.log("");
}

function ensureDirExists(p: string) {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function mapDoctorToGzmoProfile(profile: ReturnType<typeof parseDoctorFlags>["profile"]) {
  switch (profile) {
    case "fast":
      return "minimal";
    case "standard":
      return "standard";
    case "deep":
      return "full";
  }
}

interface DiagnosticsBag {
  steps: DoctorStepResult[];
  ollamaOk: boolean;
  ollamaV1?: string;
  model: string;
  store?: EmbeddingStore;
}

async function runDiagnostics(flags: ReturnType<typeof parseDoctorFlags>, env: DoctorEnvironment): Promise<DiagnosticsBag> {
  const steps: DoctorStepResult[] = [];
  const stepCtx = { readonly: flags.readonly, timeoutMs: flags.timeoutMs };

  // 0) Runtime profile visibility (diagnostic only)
  steps.push(
    await runStep(stepCtx, {
      id: "runtime.profile",
      title: "Runtime profile (safe-mode) visibility",
      run: async () => {
        const implied = mapDoctorToGzmoProfile(flags.profile);
        const runtime = resolveRuntimeProfile();
        const auto =
          `wiki_repair→inbox=${readAutoInboxFromWikiRepair()}; ` +
          `self_ask→inbox=${readAutoInboxFromSelfAsk()}; ` +
          `dreams→inbox=${readAutoInboxFromDreams()}; ` +
          `auto_tasks/hour default=${maxAutoTasksPerHourDefault()} (set GZMO_AUTO_TASKS_PER_HOUR to override)`;
        return {
          status: "PASS",
          summary: `doctor=${flags.profile} → implied daemon profile=${implied}`,
          details: `GZMO_PROFILE env: ${process.env.GZMO_PROFILE ?? "(unset)"}\nResolved: ${describeRuntimeProfile(runtime)}\nAuto-inbox: ${auto}`,
        };
      },
    }),
  );

  // 1) Vault structure checks (readonly)
  steps.push(
    await runStep(stepCtx, {
      id: "vault.exists",
      title: "Vault path exists",
      run: async () => {
        if (!ensureDirExists(env.vaultPath)) {
          return {
            status: "FAIL",
            summary: "Vault directory missing",
            details: env.vaultPath,
            fix: [
              {
                id: "vault.set_path",
                title: "Set VAULT_PATH to your vault",
                severity: "error",
                commands: [`export VAULT_PATH=\"${env.vaultPath}\"`],
              },
            ],
          };
        }
        return { status: "PASS", summary: "OK" };
      },
    }),
  );

  steps.push(
    await runStep(stepCtx, {
      id: "vault.inbox",
      title: "Inbox directory exists",
      run: async () => {
        if (!ensureDirExists(env.inboxPath)) {
          return {
            status: "FAIL",
            summary: "Inbox missing",
            details: env.inboxPath,
            fix: [
              {
                id: "fix.vault.mkdir",
                title: "Create missing vault directories",
                severity: "error",
                commands: [`mkdir -p "${env.inboxPath}"`, `mkdir -p "${join(env.vaultPath, "GZMO", "Subtasks")}"`, `mkdir -p "${env.thoughtCabinetPath}"`, `mkdir -p "${join(env.vaultPath, "GZMO", "Quarantine")}"`, `mkdir -p "${join(env.vaultPath, "wiki")}"`],
              },
            ],
          };
        }
        return { status: "PASS", summary: "OK" };
      },
    }),
  );

  steps.push(
    await runStep(stepCtx, {
      id: "dropzone.policy",
      title: "Dropzone conversion / dedup / ZIP (env snapshot)",
      run: async () => {
        const { getDropzoneConvertConfig } = await import("./src/dropzone_convert");
        const { getDropzoneDedupConfig, DROPZONE_INDEX_REL } = await import("./src/dropzone_dedup");
        const { getDropzoneZipConfig } = await import("./src/dropzone_zip");
        const c = getDropzoneConvertConfig();
        const d = getDropzoneDedupConfig();
        const z = getDropzoneZipConfig();
        const exts = [...c.extensions].sort().join(", ");
        const details = [
          `convert: ${c.enabled ? "on" : "off"}  max_bytes=${c.maxBytes}  timeout_ms=${c.timeoutMs}`,
          `extensions: ${exts}`,
          `dedup: ${d.enabled ? "on" : "off"}  max_bytes=${d.maxBytes}  index: ${DROPZONE_INDEX_REL}`,
          `zip ingest: ${z.enabled ? "on" : "off"}  max_zip_bytes=${z.maxZipBytes}  max_entry_bytes=${z.maxEntryUncompressedBytes}  max_entries_scanned=${z.maxEntriesScanned}  max_ratio=${z.maxCompressionRatio}`,
        ].join("\n");

        const { resolveDropzoneRoot } = await import("./src/dropzone_paths");
        const dropRoot = resolveDropzoneRoot(env.vaultPath);
        const layoutChecks: Array<{ label: string; path: string }> = [
          { label: "GZMO/Dropzone/", path: dropRoot },
          { label: "GZMO/Dropzone/files/", path: join(dropRoot, "files") },
          { label: "GZMO/Dropzone/_tmp/", path: join(dropRoot, "_tmp") },
          { label: "wiki/incoming/", path: join(env.vaultPath, "wiki", "incoming") },
          { label: "GZMO/ (index parent)", path: join(env.vaultPath, "GZMO") },
        ];
        const missing = layoutChecks.filter((x) => !ensureDirExists(x.path));
        const warnBlock =
          missing.length > 0
            ? `\n\nMissing paths (daemon mkdirs these on first drop, but creating them now avoids surprises):\n${missing.map((m) => `- ${m.label} ${m.path}`).join("\n")}`
            : "";

        return {
          status: missing.length === 0 ? "PASS" : "WARN",
          summary:
            missing.length === 0
              ? "Dropzone policy readable from env (see README)"
              : "Dropzone policy OK — some Dropzone/wiki paths are missing",
          details: details + warnBlock,
          fix:
            missing.length > 0
              ? [
                  {
                    id: "dropzone.layout.mkdir",
                    title: "Create Dropzone + wiki/incoming layout",
                    severity: "warn",
                    commands: [
                      `mkdir -p "${join(dropRoot, "files")}" "${join(dropRoot, "_tmp")}" "${join(dropRoot, "_processed")}" "${join(dropRoot, "_failed")}" "${join(env.vaultPath, "wiki", "incoming")}"`,
                    ],
                  },
                ]
              : undefined,
        };
      },
    }),
  );

  // 2) Ollama discovery (readonly)
  const embedModel = process.env.GZMO_EMBED_MODEL?.trim() || "nomic-embed-text";
  const requiredModels = [
    flags.profile === "deep" ? "hermes3:8b" : (process.env.OLLAMA_MODEL ?? "hermes3:8b"),
    embedModel,
  ];
  const ollama = await runStep(stepCtx, {
    id: "ollama.discover",
    title: "Discover Ollama endpoint + required models",
    timeoutMs: 12_000,
    run: async (signal) => {
      const d = await discoverOllama({
        preferredV1Url: env.ollamaUrlV1,
        modelRequired: requiredModels,
        env: { httpProxy: env.proxy?.http, httpsProxy: env.proxy?.https, noProxy: env.proxy?.noProxy },
        signal,
      });
      if (!d.baseUrl) {
        return { status: flags.profile === "deep" ? "FAIL" : "WARN", summary: d.details, fix: d.fix };
      }
      env.ollamaBaseUrl = d.baseUrl;
      env.ollamaUrlV1 = d.v1Url;
      if (!env.model) env.model = "hermes3:8b";
      return {
        status: d.ok ? "PASS" : "FAIL",
        summary: d.details,
        details: `base=${d.baseUrl}\nv1=${d.v1Url}\nmodels=${(d.models ?? []).slice(0, 20).join(", ")}`,
        fix: d.fix,
      };
    },
  });
  steps.push(ollama);

  const ollamaOk = ollama.status === "PASS";
  const ollamaV1 = env.ollamaUrlV1;
  const model = env.model ?? "hermes3:8b";

  // 3) Unit tests (via bun test) in deep/standard; in fast we skip by default
  if (flags.profile === "fast") {
    steps.push({ id: "unit.tests", title: "Unit tests (bun test)", status: "SKIP", durationMs: 0, summary: "Skipped in fast profile" });
  } else {
    steps.push(
      await runStep(stepCtx, {
        id: "unit.tests",
        title: "Unit tests (bun test)",
        timeoutMs: 60_000,
        run: async (signal) => {
          const p = Bun.spawn({ cmd: ["bun", "test"], cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", signal });
          const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
          const code = await p.exited;
          const all = (out + (err ? `\n${err}` : "")).trim();
          return {
            status: code === 0 ? "PASS" : "FAIL",
            summary: code === 0 ? "All unit tests passed" : `Unit tests failed (exit ${code})`,
            details: all.slice(0, 3000),
            fix: code === 0 ? undefined : [{ id: "unit.fix", title: "Fix failing unit tests", severity: "error" }],
          };
        },
      }),
    );
  }

  // 4) Wiki lint (readonly; no autofix)
  steps.push(
    await runStep(stepCtx, {
      id: "wiki.lint",
      title: "Wiki lint scan (readonly)",
      timeoutMs: 30_000,
      run: async () => {
        const report = await runWikiLint(env.vaultPath, { staleDays: 365 });
        const n = report.findings.length;
        return {
          status: n === 0 ? "PASS" : "WARN",
          summary: `${n} findings across ${report.wikiPages} pages`,
          evidencePaths: [join(env.vaultPath, "GZMO", "wiki-lint-report.md")],
          fix:
            n === 0
              ? undefined
              : [
                  {
                    id: "wiki.lint.review",
                    title: "Review wiki lint report and apply fixes",
                    severity: "warn",
                    rationale: "Doctor runs lint in readonly mode; it only reports.",
                    commands: [`sed -n '1,200p' "${join(env.vaultPath, "GZMO", "wiki-lint-report.md")}"`],
                  },
                ],
        };
      },
    }),
  );

  // 5) Embeddings / RAG readiness
  let store: EmbeddingStore | undefined;
  steps.push(
    await runStep(stepCtx, {
      id: "embeddings.sync",
      title: "Embeddings sync/load",
      timeoutMs: ollamaOk ? 60_000 : 5_000,
      run: async (signal) => {
        if (!ollamaOk || !env.ollamaBaseUrl) {
          return {
            status: "SKIP",
            summary: "Skipped (Ollama unavailable)",
          };
        }
        store = await syncEmbeddings(env.vaultPath, env.embeddingsPath, env.ollamaBaseUrl);
        return { status: "PASS", summary: `chunks=${store.chunks.length}` };
      },
    }),
  );

  // 5b) Embeddings queue serialization stress (readonly-ish; uses a temp vault)
  steps.push(
    await runStep(stepCtx, {
      id: "embeddings.queue",
      title: "Embeddings queue serialization (temp vault)",
      timeoutMs: ollamaOk ? 120_000 : 5_000,
      run: async () => {
        if (!ollamaOk || !env.ollamaBaseUrl) {
          return { status: "SKIP", summary: "Skipped (Ollama unavailable)" };
        }

        const os = await import("os");
        const { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } = await import("fs");
        const { join } = await import("path");
        const vault = mkdtempSync(join(os.tmpdir(), "gzmo-doctor-vault-"));
        try {
          mkdirSync(join(vault, "GZMO", "Thought_Cabinet"), { recursive: true });
          mkdirSync(join(vault, "wiki", "topics"), { recursive: true });

          writeFileSync(
            join(vault, "wiki", "topics", "A.md"),
            "# A\n\nAlpha.\n\nMore content to exceed minimal length.\n".repeat(5),
            "utf-8",
          );
          writeFileSync(
            join(vault, "wiki", "topics", "B.md"),
            "# B\n\nBravo.\n\nMore content to exceed minimal length.\n".repeat(5),
            "utf-8",
          );

          const storePath = join(vault, "GZMO", "embeddings.json");
          const q = new EmbeddingsQueue(vault, storePath, env.ollamaBaseUrl);
          await q.initByFullSync();

          q.enqueueUpsertFile("wiki/topics/A.md");
          q.enqueueUpsertFile("wiki/topics/B.md");
          q.enqueueRemoveFile("wiki/topics/A.md");
          q.enqueueUpsertFile("wiki/topics/A.md");
          await q.whenIdle();

          const raw = readFileSync(storePath, "utf-8");
          const parsed = JSON.parse(raw) as { chunks?: unknown };
          const ok = Array.isArray((parsed as any)?.chunks);
          return {
            status: ok ? "PASS" : "FAIL",
            summary: ok ? "Serialized writes produced valid store JSON" : "Embeddings store JSON invalid",
            details: `storePath=${storePath}\nbytes=${raw.length}\nchunksArray=${ok}`,
          };
        } finally {
          rmSync(vault, { recursive: true, force: true });
        }
      },
    }),
  );

  // 6) Deep readonly LLM checks (no inbox writes): identity + JSON compliance
  if (flags.profile !== "deep") {
    steps.push({ id: "llm.identity", title: "LLM identity compliance (dry)", status: "SKIP", durationMs: 0, summary: "Only in deep profile" });
    steps.push({ id: "llm.json", title: "LLM JSON compliance (dry)", status: "SKIP", durationMs: 0, summary: "Only in deep profile" });
  } else if (!ollamaOk || !ollamaV1) {
    steps.push({ id: "llm.identity", title: "LLM identity compliance (dry)", status: "SKIP", durationMs: 0, summary: "Skipped (Ollama unavailable)" });
    steps.push({ id: "llm.json", title: "LLM JSON compliance (dry)", status: "SKIP", durationMs: 0, summary: "Skipped (Ollama unavailable)" });
  } else {
    steps.push(
      await runStep(stepCtx, {
        id: "llm.identity",
        title: "LLM identity compliance (dry)",
        timeoutMs: 45_000,
        run: async (signal) => {
          const out = await ollamaChatJson({
            v1Url: ollamaV1,
            model,
            system: "You are GZMO. Answer directly. Do not invent system details. If unknown, say 'unknown'.",
            prompt: "Answer:\n1) Your name\n2) Are you fictional?\n3) Your current operational phase\n4) Runtime environment\nKeep it concise.",
            signal,
          });
          const bad = /(ChatGPT|GPT-4|Llama-3|meta-llama|Star Trek|Godzilla|Deep Space Nine)/i.test(out);
          const suspiciousEnv = /(cloud|kubernetes|aws|gcp|azure)/i.test(out);
          return {
            status: bad || suspiciousEnv ? "WARN" : "PASS",
            summary: bad ? "Suspicious identity leakage" : suspiciousEnv ? "Possible environment fabrication" : "OK",
            details: out.slice(0, 1200),
          };
        },
      }),
    );

    steps.push(
      await runStep(stepCtx, {
        id: "llm.json",
        title: "LLM JSON compliance (dry)",
        timeoutMs: 45_000,
        run: async (signal) => {
          const out = await ollamaChatJson({
            v1Url: ollamaV1,
            model,
            system: "You are GZMO. Output ONLY valid JSON when asked.",
            prompt:
              "You MUST respond with ONLY valid JSON.\nSchema:\n{\n  \"daemon_name\": string,\n  \"status\": \"operational\"|\"degraded\"|\"offline\",\n  \"subsystems\": [{\"name\": string, \"healthy\": boolean}],\n  \"recommendation\": string\n}",
            signal,
          });
          let ok = false;
          let issues: string[] = [];
          try {
            const parsed = JSON.parse(out);
            ok = !!parsed?.daemon_name && Array.isArray(parsed?.subsystems);
            if (!parsed?.recommendation) issues.push("missing recommendation");
          } catch (e: any) {
            issues.push(`JSON parse failed: ${e?.message ?? String(e)}`);
          }
          return {
            status: ok && issues.length === 0 ? "PASS" : "WARN",
            summary: ok ? (issues.length ? "Valid JSON (schema issues)" : "Valid JSON") : "Invalid JSON",
            details: issues.length ? `${issues.join(", ")}\n\n${out.slice(0, 1200)}` : out.slice(0, 1200),
          };
        },
      }),
    );
  }

  // 7) Write-enabled integration checks (Inbox tasks, dream/self-ask) gated behind --write
  if (flags.readonly) {
    steps.push({
      id: "write.gated",
      title: "Write-enabled checks (Inbox/pipeline/dream/self-ask/wiki-engine)",
      status: "SKIP",
      durationMs: 0,
      summary: "Skipped (run with --write to enable)",
      fix: [
        {
          id: "doctor.enable_write",
          title: "Run doctor with write-enabled checks",
          severity: "info",
          commands: ["bun run doctor --write --profile deep"],
        },
      ],
    });
  } else if (!ollamaOk || !env.ollamaBaseUrl) {
    steps.push({
      id: "write.pipeline",
      title: "Pipeline checks (processTask/dream/self-ask)",
      status: "SKIP",
      durationMs: 0,
      summary: "Skipped (Ollama unavailable)",
    });
  } else {
    const pulse = new PulseLoop(defaultConfig());
    pulse.start(join(env.vaultPath, "GZMO", "CHAOS_STATE.json"));
    await new Promise((r) => setTimeout(r, 800));
    const snap = pulse.snapshot();
    const calmSnap: ChaosSnapshot = { ...snap, tension: 5, energy: 100, alive: true };
    const watcher = new VaultWatcher(env.inboxPath);
    watcher.start();
    await new Promise((r) => setTimeout(r, 200));
    const memory = new TaskMemory(join(env.vaultPath, "GZMO", "memory.json"));

    const created: string[] = [];
    const writeTask = (name: string, fm: Record<string, any>, body: string) => {
      const fp = join(env.inboxPath, `${name}.md`);
      const yaml = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`), "---", "", body, ""].join("\n");
      fs.writeFileSync(fp, yaml, "utf-8");
      created.push(fp);
      return fp;
    };

    try {
      steps.push(
        await runStep(stepCtx, {
          id: "pipeline.think",
          title: "processTask: think",
          timeoutMs: 90_000,
          run: async () => {
            const fp = writeTask("_doctor_think", { status: "pending", action: "think" }, "State your identity and phase in <= 40 words.");
            const doc = await TaskDocument.load(fp);
            if (!doc) throw new Error(`Doctor failed to load task document: ${fp}`);
            const ev: TaskEvent = { filePath: fp, fileName: "_doctor_think", status: "pending", body: "State your identity and phase in <= 40 words.", frontmatter: { status: "pending", action: "think" }, document: doc };
            await processTask(ev, watcher, pulse, store, memory);
            return { status: "PASS", summary: "Completed" };
          },
        }),
      );

      steps.push(
        await runStep(stepCtx, {
          id: "pipeline.search",
          title: "processTask: search",
          timeoutMs: 120_000,
          run: async () => {
            const fp = writeTask("_doctor_search", { status: "pending", action: "search" }, "From the vault, explain PulseLoop and name 2 state variables.");
            const doc = await TaskDocument.load(fp);
            if (!doc) throw new Error(`Doctor failed to load task document: ${fp}`);
            const ev: TaskEvent = { filePath: fp, fileName: "_doctor_search", status: "pending", body: "From the vault, explain PulseLoop and name 2 state variables.", frontmatter: { status: "pending", action: "search" }, document: doc };
            await processTask(ev, watcher, pulse, store, memory);
            return { status: "PASS", summary: "Completed" };
          },
        }),
      );

      steps.push(
        await runStep(stepCtx, {
          id: "pipeline.chain",
          title: "processTask: chain creates next file",
          timeoutMs: 120_000,
          run: async () => {
            const next = "_doctor_chain_step2.md";
            const fp = writeTask("_doctor_chain", { status: "pending", action: "chain", chain_next: next }, "Step 1: List exactly 3 subsystems.");
            const doc = await TaskDocument.load(fp);
            if (!doc) throw new Error(`Doctor failed to load task document: ${fp}`);
            const ev: TaskEvent = { filePath: fp, fileName: "_doctor_chain", status: "pending", body: "Step 1: List exactly 3 subsystems.", frontmatter: { status: "pending", action: "chain", chain_next: next }, document: doc };
            await processTask(ev, watcher, pulse, store, memory);
            const ok = fs.existsSync(join(env.inboxPath, next));
            if (!ok) return { status: "FAIL", summary: "Missing chain_next file", details: next };
            return { status: "PASS", summary: "Chain file created", details: next };
          },
        }),
      );
    } finally {
      await watcher.stop().catch(() => {});
      pulse.stop();
      for (const fp of created) {
        try { fs.unlinkSync(fp); } catch {}
      }
      try { fs.unlinkSync(join(env.inboxPath, "_doctor_chain_step2.md")); } catch {}
    }
  }

  return { steps, ollamaOk, ollamaV1, model, store };
}

function printSummary(steps: DoctorStepResult[]) {
  const counts = steps.reduce(
    (acc, s) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    },
    { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 } as Record<string, number>,
  );
  console.log(`Summary: PASS=${counts.PASS} WARN=${counts.WARN} FAIL=${counts.FAIL} SKIP=${counts.SKIP}`);
  for (const s of steps) {
    console.log(`[${s.status}] ${s.title}: ${s.summary}`);
  }
}

async function main() {
  const flags = parseDoctorFlags();
  const env = computeEnv();
  printHeader(flags, env);

  let stepSignatures: { id: string; status: string; summary?: string }[] = [];
  const healingExecutions: HealingExecution[] = [];

  // Primary diagnostic pass
  let bag = await runDiagnostics(flags, env);

  // Self-healing loop
  if (flags.heal) {
    for (let iteration = 1; iteration <= flags.healRetries; iteration++) {
      const hadIssues = bag.steps.some((s) => s.status === "FAIL" || s.status === "WARN");
      if (!hadIssues) break;

      console.log(`\n--- Healing pass ${iteration}/${flags.healRetries} ---`);
      const before = bag.steps.map((s) => ({ id: s.id, status: s.status, summary: s.summary }));

      const controller = new AbortController();
      const healCtx = { env, readonly: flags.readonly, signal: controller.signal };
      const exec = await applyHealing(bag.steps, healCtx);

      if (exec.applied.length === 0) {
        console.log("No applicable fix handlers found. Stopping healing loop.");
        break;
      }

      // Wait for fixes to take effect
      if (flags.healDelayMs > 0) {
        console.log(`Waiting ${flags.healDelayMs}ms for fixes to settle...`);
        await new Promise((r) => setTimeout(r, flags.healDelayMs));
      }

      // Re-run diagnostics
      bag = await runDiagnostics(flags, env);
      const after = bag.steps.map((s) => ({ id: s.id, status: s.status, summary: s.summary }));
      const comparison = compareStepSets(before, after);

      exec.iteration = iteration;
      exec.resolvedIds = comparison.resolved;
      exec.remainingIds = bag.steps.filter((s) => s.status === "FAIL" || s.status === "WARN").map((s) => s.id);
      healingExecutions.push(exec);

      console.log(`Resolved: ${comparison.resolved.length}, Worsened: ${comparison.worsened.length}, Same: ${comparison.same.length}`);
      for (const a of exec.applied) {
        console.log(`  [${a.success ? "OK" : "FAIL"}] ${a.fixTitle}: ${a.output ?? a.error ?? ""}`);
      }

      // Stop if nothing improved and nothing new was applied
      if (comparison.resolved.length === 0) {
        console.log("No improvements in this pass. Stopping healing loop.");
        break;
      }

      // If all clear, break early
      if (!bag.steps.some((s) => s.status === "FAIL" || s.status === "WARN")) {
        console.log("All issues resolved.");
        break;
      }
    }
  }

  const report: DoctorReport = {
    generatedAt: new Date().toISOString(),
    profile: flags.profile,
    readonly: flags.readonly,
    writeReports: flags.writeReports,
    env,
    steps: bag.steps,
    healingExecutions: flags.heal ? healingExecutions : undefined,
  };

  const markdown = reportToMarkdown(report);
  const json = JSON.stringify(report, null, 2);

  printSummary(bag.steps);

  if (flags.writeReports) {
    const repoRoot = resolve(import.meta.dir, "..");
    const writeToVault = !flags.readonly;
    const paths = await writeDoctorReports({
      report,
      markdown,
      json,
      readonly: flags.readonly,
      writeToVault,
      vaultPath: env.vaultPath,
      repoRoot,
    });
    console.log("");
    console.log(`Report written: ${paths.mdPath}`);
  }

  const failed = bag.steps.some((s) => s.status === "FAIL");
  process.exit(failed ? 1 : 0);
}

await main();
