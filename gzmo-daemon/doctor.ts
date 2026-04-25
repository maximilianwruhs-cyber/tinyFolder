/**
 * doctor.ts — Smart Doctor v2 (local-first)
 *
 * Default behavior:
 * - Deep profile
 * - Readonly (no vault mutations)
 * - Writes reports to repo (`gzmo/doctor-report.{md,json}`)
 *
 * Enable vault-writing checks (Inbox, Dream/SelfAsk, wiki engine) with `--write`.
 */

import { resolve, join } from "path";
import * as fs from "fs";

import { parseDoctorFlags } from "./src/doctor/flags";
import { runStep } from "./src/doctor/runner";
import { discoverOllama, ollamaChatJson } from "./src/doctor/ollama";
import { reportToMarkdown, writeDoctorReports } from "./src/doctor/report";
import { runLegacy } from "./src/doctor/legacy";
import type { DoctorEnvironment, DoctorReport, DoctorStepResult } from "./src/doctor/types";

import { runWikiLint } from "./src/wiki_lint";
import { syncEmbeddings } from "./src/embeddings";
import { EmbeddingsQueue } from "./src/embeddings_queue";
import { describeRuntimeProfile, resolveRuntimeProfile } from "./src/runtime_profile";
import { defaultConfig } from "./src/types";
import { PulseLoop } from "./src/pulse";
import { VaultWatcher } from "./src/watcher";
import { processTask } from "./src/engine";
import { TaskMemory } from "./src/memory";
import type { TaskEvent } from "./src/watcher";
import type { EmbeddingStore } from "./src/embeddings";
import type { ChaosSnapshot } from "./src/types";

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
  console.log("  GZMO Doctor v2");
  console.log("════════════════════════════════════════════════════");
  console.log(`Profile: ${flags.profile}`);
  console.log(`Mode:    ${flags.readonly ? "readonly" : "write"}`);
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

async function main() {
  const flags = parseDoctorFlags();
  const env = computeEnv();
  printHeader(flags, env);

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
        return {
          status: "PASS",
          summary: `doctor=${flags.profile} → implied daemon profile=${implied}`,
          details: `GZMO_PROFILE env: ${process.env.GZMO_PROFILE ?? "(unset)"}\nResolved: ${describeRuntimeProfile(runtime)}`,
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
          return { status: "FAIL", summary: "Inbox missing", details: env.inboxPath };
        }
        return { status: "PASS", summary: "OK" };
      },
    }),
  );

  // 2) Ollama discovery (readonly)
  const requiredModels = [flags.profile === "deep" ? "hermes3:8b" : (process.env.OLLAMA_MODEL ?? "hermes3:8b"), "nomic-embed-text"];
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
        // CI/local dev without Ollama should still be able to run Doctor meaningfully.
        // Only deep profile treats missing Ollama as a hard failure.
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
  } else if (flags.runLegacy === "unit" || flags.runLegacy === "all") {
    // handled by legacy runner below
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
        // syncEmbeddings uses base URL (no /v1)
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

          // Two files → initial full sync, then rapid queue operations.
          writeFileSync(join(vault, "wiki", "topics", "A.md"), "# A\n\nAlpha.\n\nMore content to exceed minimal length.\n".repeat(5), "utf-8");
          writeFileSync(join(vault, "wiki", "topics", "B.md"), "# B\n\nBravo.\n\nMore content to exceed minimal length.\n".repeat(5), "utf-8");

          const storePath = join(vault, "GZMO", "embeddings.json");
          const q = new EmbeddingsQueue(vault, storePath, env.ollamaBaseUrl);
          await q.initByFullSync();

          // Burst: enqueue multiple upserts/removes; serialization guarantees no interleaving writes.
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
            // JSON compliance is a quality signal; default to WARN rather than hard-fail.
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
    // Minimal pipeline: think/search/chain using processTask (writes into Inbox; cleaned after)
    const pulse = new PulseLoop(defaultConfig());
    pulse.start(join(env.vaultPath, "GZMO", "CHAOS_STATE.json"));
    await new Promise(r => setTimeout(r, 800));
    const snap = pulse.snapshot();
    const calmSnap: ChaosSnapshot = { ...snap, tension: 5, energy: 100, alive: true };
    const watcher = new VaultWatcher(env.inboxPath);
    watcher.start();
    await new Promise(r => setTimeout(r, 200));
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
      // think
      steps.push(
        await runStep(stepCtx, {
          id: "pipeline.think",
          title: "processTask: think",
          timeoutMs: 90_000,
          run: async () => {
            const fp = writeTask("_doctor_think", { status: "pending", action: "think" }, "State your identity and phase in <= 40 words.");
            const ev: TaskEvent = { filePath: fp, fileName: "_doctor_think", status: "pending", body: "State your identity and phase in <= 40 words.", frontmatter: { status: "pending", action: "think" } };
            await processTask(ev, watcher, env.vaultPath, pulse, store, memory);
            return { status: "PASS", summary: "Completed" };
          },
        }),
      );

      // search
      steps.push(
        await runStep(stepCtx, {
          id: "pipeline.search",
          title: "processTask: search",
          timeoutMs: 120_000,
          run: async () => {
            const fp = writeTask("_doctor_search", { status: "pending", action: "search" }, "From the vault, explain PulseLoop and name 2 state variables.");
            const ev: TaskEvent = { filePath: fp, fileName: "_doctor_search", status: "pending", body: "From the vault, explain PulseLoop and name 2 state variables.", frontmatter: { status: "pending", action: "search" } };
            await processTask(ev, watcher, env.vaultPath, pulse, store, memory);
            return { status: "PASS", summary: "Completed" };
          },
        }),
      );

      // chain
      steps.push(
        await runStep(stepCtx, {
          id: "pipeline.chain",
          title: "processTask: chain creates next file",
          timeoutMs: 120_000,
          run: async () => {
            const next = "_doctor_chain_step2.md";
            const fp = writeTask("_doctor_chain", { status: "pending", action: "chain", chain_next: next }, "Step 1: List exactly 3 subsystems.");
            const ev: TaskEvent = { filePath: fp, fileName: "_doctor_chain", status: "pending", body: "Step 1: List exactly 3 subsystems.", frontmatter: { status: "pending", action: "chain", chain_next: next } };
            await processTask(ev, watcher, env.vaultPath, pulse, store, memory);
            const ok = fs.existsSync(join(env.inboxPath, next));
            if (!ok) return { status: "FAIL", summary: "Missing chain_next file", details: next };
            return { status: "PASS", summary: "Chain file created", details: next };
          },
        }),
      );
    } finally {
      await watcher.stop().catch(() => {});
      pulse.stop();
      // cleanup
      for (const fp of created) {
        try { fs.unlinkSync(fp); } catch {}
      }
      try { fs.unlinkSync(join(env.inboxPath, "_doctor_chain_step2.md")); } catch {}
    }
  }

  // 8) Optional legacy orchestration
  if (flags.runLegacy) {
    steps.push(
      await runStep(stepCtx, {
        id: "legacy.run",
        title: `Legacy test orchestration (${flags.runLegacy})`,
        timeoutMs: flags.profile === "deep" ? 600_000 : 240_000,
        run: async (signal) => {
          const res = await runLegacy({
            kind: flags.runLegacy!,
            cwd: import.meta.dir,
            readonly: flags.readonly,
            env: {
              VAULT_PATH: env.vaultPath,
              OLLAMA_URL: env.ollamaUrlV1 ?? "",
              OLLAMA_MODEL: env.model ?? "",
            },
            signal,
          });
          const failures = Object.entries(res).filter(([, r]) => !r.ok && r.summary !== "Skipped (requires --write)");
          const skipped = Object.values(res).filter((r) => r.summary === "Skipped (requires --write)").length;
          const fix = Object.values(res).flatMap((r) => r.fix ?? []);
          return {
            status: failures.length ? "FAIL" : skipped ? "WARN" : "PASS",
            summary: failures.length ? `${failures.length} legacy runs failed` : skipped ? `${skipped} legacy runs skipped (requires --write)` : "All legacy runs passed",
            details: JSON.stringify(res, null, 2).slice(0, 6000),
            fix: fix.length ? fix : undefined,
          };
        },
      }),
    );
  }

  const report: DoctorReport = {
    generatedAt: new Date().toISOString(),
    profile: flags.profile,
    readonly: flags.readonly,
    writeReports: flags.writeReports,
    runLegacy: flags.runLegacy,
    env,
    steps,
  };

  const markdown = reportToMarkdown(report);
  const json = JSON.stringify(report, null, 2);

  if (flags.writeReports) {
    const repoRoot = resolve(import.meta.dir, "..");
    const writeToVault = !flags.readonly; // only write into vault when explicitly in write mode
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

  const failed = steps.some((s) => s.status === "FAIL");
  process.exit(failed ? 1 : 0);
}

await main();
