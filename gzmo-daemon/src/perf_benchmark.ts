/**
 * Performance benchmark: compare single-shot vs ToT vs ToT+tools.
 *
 * Usage:
 *   cd gzmo-daemon
 *   GZMO_BENCHMARK_RUNS=5 bun run src/perf_benchmark.ts
 *
 * This uses a temporary vault directory so it does not pollute a real vault.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { VaultWatcher } from "./watcher";
import { processTask } from "./engine";
import type { TaskEvent } from "./watcher";

// Benchmark helper — minimal inline document wrapper (avoids dependency cycle)
class BenchDocument {
  constructor(public readonly filePath: string) {}
  async markProcessing() {}
  async markCompleted(_output: string) {}
  async markFailed(_reason?: string) {}
}

type Scenario = {
  name: string;
  action: "think" | "search";
  body: string;
  envOverrides: Record<string, string>;
};

const SCENARIOS: Scenario[] = [
  {
    name: "simple_think",
    action: "think",
    body: "Explain the Lorenz attractor in one paragraph.",
    envOverrides: {},
  },
  {
    name: "simple_search_single",
    action: "search",
    body: "What files does the daemon write?",
    envOverrides: { GZMO_ENABLE_TOT: "off", GZMO_ENABLE_TOOLS: "off" },
  },
  {
    name: "simple_search_tot",
    action: "search",
    body: "What files does the daemon write?",
    envOverrides: { GZMO_ENABLE_TOT: "on", GZMO_ENABLE_TOOLS: "off" },
  },
  {
    name: "simple_search_tot_tools",
    action: "search",
    body: "Find references to \"ollama\" in the vault and summarize what they mean.",
    envOverrides: { GZMO_ENABLE_TOT: "on", GZMO_ENABLE_TOOLS: "on" },
  },
];

function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)] ?? 0;
}

function percentile(nums: number[], p: number): number {
  const a = [...nums].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)));
  return a[idx] ?? 0;
}

async function runOne(vault: string, scenario: Scenario, i: number): Promise<number> {
  const inbox = join(vault, "GZMO", "Inbox");
  const fileName = `benchmark_${scenario.name}_${i}.md`;
  const filePath = join(inbox, fileName);

  const content = `---\nstatus: pending\naction: ${scenario.action}\n---\n\n${scenario.body}\n`;
  writeFileSync(filePath, content);

  const event = {
    filePath,
    fileName,
    body: scenario.body,
    frontmatter: { status: "pending", action: scenario.action },
    document: new BenchDocument(filePath) as any,
    type: "add",
  } as unknown as TaskEvent;

  const watcher = new VaultWatcher(inbox);
  const t0 = Date.now();
  await processTask(event, watcher, undefined, undefined, undefined);
  return Date.now() - t0;
}

export async function runBenchmark(): Promise<void> {
  const runs = Number(process.env.GZMO_BENCHMARK_RUNS ?? "3");
  const vault = mkdtempSync(join(tmpdir(), "gzmo-benchmark-"));

  for (const dir of [
    join(vault, "GZMO", "Inbox"),
    join(vault, "GZMO", "Subtasks"),
    join(vault, "GZMO", "Thought_Cabinet"),
    join(vault, "GZMO", "Quarantine"),
    join(vault, "GZMO", "Reasoning_Traces"),
    join(vault, "wiki"),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  // Minimal wiki content so retrieval has something.
  writeFileSync(join(vault, "wiki", "overview.md"), "# Overview\n\nGZMO is a sovereign local daemon.\n");
  writeFileSync(join(vault, "wiki", "ops.md"), "# Outputs\n\nThe daemon writes health.md and telemetry.\n");

  process.env.VAULT_PATH = vault;
  process.env.OLLAMA_URL ??= "http://localhost:11434";

  console.log(`Benchmark vault: ${vault}`);
  console.log(`Runs per scenario: ${runs}`);
  console.log("");

  for (const s of SCENARIOS) {
    const times: number[] = [];

    const originalEnv: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(s.envOverrides)) {
      originalEnv[k] = process.env[k];
      process.env[k] = v;
    }

    for (let i = 0; i < runs; i++) {
      try {
        const ms = await runOne(vault, s, i);
        times.push(ms);
        console.log(`${s.name} run ${i + 1}/${runs}: ${ms}ms`);
      } catch (err: any) {
        console.warn(`${s.name} run ${i + 1}/${runs}: failed — ${err?.message ?? err}`);
      }
    }

    for (const [k, old] of Object.entries(originalEnv)) {
      if (old === undefined) delete process.env[k];
      else process.env[k] = old;
    }

    const med = median(times);
    const p95 = percentile(times, 0.95);
    console.log(`${s.name}: median=${med}ms p95=${p95}ms range=${Math.min(...times)}-${Math.max(...times)}ms`);
    console.log("");
  }

  console.log(`Done. Temp vault: ${vault}`);
  console.log(`Cleanup: rm -rf ${vault}`);
}

if (import.meta.main) {
  runBenchmark();
}

