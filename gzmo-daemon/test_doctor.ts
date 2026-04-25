/**
 * test_doctor.ts — GZMO Doctor
 *
 * One smart diagnostic that combines:
 * - unit-level invariants from:
 *   - wiki_lint.test.ts, wiki_graph.test.ts, ingest_engine.test.ts, wiki_contract.test.ts
 * - optional subsystem / pipeline checks inspired by:
 *   - test_full_pipeline.ts, test_nightshift.ts, test_hermes3_stress.ts
 *
 * Usage:
 *   cd gzmo
 *   bun run doctor
 *
 * Flags:
 *   --quick        Skip LLM-dependent steps (Ollama, embeddings, tasks, dream/self-ask)
 *   --deep         Also run WikiEngine cycle (writes/updates wiki pages)
 *   --no-cleanup   Keep created _doctor_ files in Inbox (debugging)
 */

import { resolve, join } from "path";
import * as fs from "fs";
import { expect } from "bun:test";

import { extractWikiLinks, runWikiLint } from "./src/wiki_lint";
import { normalizeWikiMarkdown } from "./src/wiki_contract";
import { upsertSourceLink } from "./src/wiki_graph";
import { __testing as ingestTesting } from "./src/ingest_engine";

import { infer, processTask } from "./src/engine";
import { VaultWatcher } from "./src/watcher";
import { PulseLoop } from "./src/pulse";
import { DreamEngine } from "./src/dreams";
import { SelfAskEngine } from "./src/self_ask";
import { WikiEngine } from "./src/wiki_engine";
import { syncEmbeddings } from "./src/embeddings";
import { TaskMemory } from "./src/memory";
import { defaultConfig } from "./src/types";
import type { ChaosSnapshot } from "./src/types";
import type { TaskEvent } from "./src/watcher";
import type { EmbeddingStore } from "./src/embeddings";

type StepStatus = "PASS" | "FAIL" | "WARN" | "SKIP";
type Step = { name: string; status: StepStatus; ms: number; details?: string };

function parseFlags(argv = process.argv.slice(2)) {
  const set = new Set(argv);
  return {
    quick: set.has("--quick"),
    deep: set.has("--deep"),
    cleanup: !set.has("--no-cleanup"),
  };
}

function nowMs() {
  return Date.now();
}

async function withTiming<T>(fn: () => Promise<T> | T): Promise<{ ms: number; value: T }> {
  const start = nowMs();
  const value = await fn();
  return { ms: nowMs() - start, value };
}

function ok(step: string, ms: number, details?: string): Step {
  return { name: step, status: "PASS", ms, details };
}
function warn(step: string, ms: number, details?: string): Step {
  return { name: step, status: "WARN", ms, details };
}
function fail(step: string, ms: number, details?: string): Step {
  return { name: step, status: "FAIL", ms, details };
}
function skip(step: string, details?: string): Step {
  return { name: step, status: "SKIP", ms: 0, details };
}

async function checkOllamaBase(url: string): Promise<{ ok: boolean; details: string }> {
  try {
    const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return { ok: false, details: `HTTP ${resp.status}` };
    return { ok: true, details: "reachable" };
  } catch (e: any) {
    return { ok: false, details: e?.message ?? String(e) };
  }
}

function gradeOutput(output: string): { quality: "CLEAN" | "WARN" | "BAD"; issues: string[] } {
  const issues: string[] = [];
  if (output.includes("\\boxed")) issues.push("LaTeX garbage");
  if (/<\/think(ing)?>/.test(output)) issues.push("Leaked think tags");
  if (/Star Trek|Godzilla|Deep Space Nine/i.test(output)) issues.push("Identity hallucination");
  if (/Llama-3|meta-llama|GPT-4|ChatGPT|I am a large language model/i.test(output)) issues.push("Model identity leak");
  if (output.length < 20) issues.push("Output too short (<20 chars)");
  if (output.length > 8000) issues.push("Output suspiciously long (>8k)");
  if (/^(Okay|Hmm|I think|Let me|I recall|The user)/m.test(output)) issues.push("Leaked internal reasoning");
  if (issues.length === 0) return { quality: "CLEAN", issues: [] };
  if (issues.some(i => i.includes("hallucination") || i.includes("garbage") || i.includes("identity leak"))) return { quality: "BAD", issues };
  return { quality: "WARN", issues };
}

function banner(title: string) {
  console.log("\n════════════════════════════════════════════════════");
  console.log(`  ${title}`);
  console.log("════════════════════════════════════════════════════");
}

function summarize(steps: Step[]) {
  const counts = steps.reduce(
    (acc, s) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<StepStatus, number>,
  );

  const totalMs = steps.reduce((a, s) => a + s.ms, 0);
  console.log("\n\n════════════════════════════════════════════════════");
  console.log("  DOCTOR REPORT");
  console.log("════════════════════════════════════════════════════");
  for (const s of steps) {
    const t = s.ms ? `${(s.ms / 1000).toFixed(2)}s` : "";
    const line = `${s.status.padEnd(4)}  ${s.name}${t ? `  (${t})` : ""}`;
    console.log(line);
    if (s.details) console.log(`      ${s.details}`);
  }
  console.log("");
  console.log(
    `Summary: PASS=${counts.PASS ?? 0} WARN=${counts.WARN ?? 0} FAIL=${counts.FAIL ?? 0} SKIP=${counts.SKIP ?? 0} | time=${(totalMs / 1000).toFixed(2)}s`,
  );
  return { counts, totalMs };
}

function resolveVaultPath(): string {
  // Prefer env; fall back to repo bundle vault (like index.ts does)
  return process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(import.meta.dir, "../vault");
}

function cleanupInbox(inboxPath: string) {
  let removed = 0;
  try {
    const files = fs.readdirSync(inboxPath).filter(f => f.startsWith("_doctor_"));
    for (const f of files) {
      try {
        fs.unlinkSync(join(inboxPath, f));
        removed++;
      } catch {}
    }
  } catch {}
  return removed;
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
const flags = parseFlags();
const steps: Step[] = [];

banner("GZMO Doctor");
console.log(`Flags: quick=${flags.quick} deep=${flags.deep} cleanup=${flags.cleanup}`);

// 0) Unit-level invariants (ported directly from existing tests)
banner("Unit invariants");
{
  const { ms } = await withTiming(() => {
    const md = "See [[Page One|alias]] and [[PageTwo#Section]] and [[Third]].";
    expect(extractWikiLinks(md)).toEqual(["Page One", "PageTwo", "Third"]);
  });
  steps.push(ok("wiki_lint: extractWikiLinks aliases/anchors", ms));
}

{
  const { ms } = await withTiming(() => {
    const raw = "---\n---\n\nHello world\n";
    const out = normalizeWikiMarkdown({
      vaultPath: "/vault",
      wikiFileAbs: "/vault/wiki/topics/x.md",
      rawMarkdown: raw,
      now: new Date("2026-04-22T00:00:00Z"),
      existingMarkdown: null,
    });
    expect(out.markdown).toContain("title:");
    expect(out.markdown).toContain("type: topic");
    expect(out.markdown).toContain("# x");
  });
  steps.push(ok("wiki_contract: normalization safe baseline", ms));
}

{
  const { ms } = await withTiming(() => {
    const raw = "This is a body without frontmatter.";
    const normalized = normalizeWikiMarkdown({
      vaultPath: "/vault",
      wikiFileAbs: "/vault/wiki/entities/MyPage.md",
      rawMarkdown: raw,
      now: new Date("2026-04-22T10:00:00Z"),
      existingMarkdown: null,
    });
    expect(normalized.frontmatter.title).toBe("MyPage");
    expect(normalized.frontmatter.type).toBe("entity");
    expect(normalized.frontmatter.created).toBe("2026-04-22");
    expect(normalized.frontmatter.updated).toBe("2026-04-22");
    expect(Array.isArray(normalized.frontmatter.tags)).toBe(true);
    expect(typeof normalized.frontmatter.sources).toBe("number");
    expect(normalized.markdown).toContain("---\n");
    expect(normalized.markdown).toContain("\n# MyPage\n");
  });
  steps.push(ok("wiki_contract: required frontmatter + H1", ms));
}

{
  const { ms } = await withTiming(() => {
    expect(() =>
      normalizeWikiMarkdown({
        vaultPath: "/vault",
        wikiFileAbs: "/vault/wiki/topics/x.md",
        rawMarkdown: "---\n---\n\n# X\n\n<div>nope</div>\n",
        now: new Date("2026-04-22T10:00:00Z"),
        existingMarkdown: null,
      }),
    ).toThrow();
  });
  steps.push(ok("wiki_contract: rejects HTML outside fences", ms));
}

{
  const { ms } = await withTiming(() => {
    const md = "---\n---\n\n# A\n\nBody\n";
    const out = upsertSourceLink(md, "[[source-foo]]");
    expect(out).toContain("## Sources");
    expect(out).toContain("- [[source-foo]]");
  });
  steps.push(ok("wiki_graph: adds Sources section", ms));
}

{
  const { ms } = await withTiming(() => {
    const md = "---\n---\n\n# A\n\n## Sources\n\n- [[x]]\n\n## Other\n\nHi\n";
    const out = upsertSourceLink(md, "[[source-foo]]");
    expect(out).toContain("- [[x]]");
    expect(out).toContain("- [[source-foo]]");
  });
  steps.push(ok("wiki_graph: inserts into existing Sources", ms));
}

{
  const { ms } = await withTiming(() => {
    const md = "---\n---\n\n# A\n\n## Sources\n\n- [[source-foo]]\n";
    const out = upsertSourceLink(md, "[[source-foo]]");
    expect(out.match(/\[\[source-foo\]\]/g)?.length).toBe(1);
  });
  steps.push(ok("wiki_graph: idempotent", ms));
}

{
  const { ms } = await withTiming(() => {
    expect(ingestTesting.sanitizeSlug("Hello World!! 2026")).toBe("hello-world-2026");
    expect(ingestTesting.sanitizeSlug("___a__b__")).toBe("a-b");
    expect(ingestTesting.deriveSourceTitle("raw/agent-logs/foo_bar-baz.md")).toBe("foo bar baz");
  });
  steps.push(ok("ingest_engine: slug + title helpers", ms));
}

// 1) Environment & subsystem checks
banner("Environment checks");
const VAULT_PATH = resolveVaultPath();
const INBOX_PATH = join(VAULT_PATH, "GZMO", "Inbox");
const OLLAMA_API_URL = (process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434").trim();

{
  const { ms } = await withTiming(() => {
    if (!fs.existsSync(VAULT_PATH)) throw new Error(`VAULT_PATH missing: ${VAULT_PATH}`);
  });
  steps.push(ok("vault path exists", ms, VAULT_PATH));
}

{
  const { ms } = await withTiming(() => {
    if (!fs.existsSync(INBOX_PATH)) throw new Error(`Inbox missing: ${INBOX_PATH}`);
  });
  steps.push(ok("inbox exists", ms, INBOX_PATH));
}

if (flags.quick) {
  steps.push(skip("ollama reachable", "skipped by --quick"));
  steps.push(skip("embeddings load", "skipped by --quick"));
  steps.push(skip("pipeline: processTask think/search/chain", "skipped by --quick"));
  steps.push(skip("nightshift: dream + self-ask", "skipped by --quick"));
  steps.push(skip("wiki lint scan", "skipped by --quick"));
  steps.push(skip("wiki engine cycle", "skipped by --quick"));
  const { counts } = summarize(steps);
  process.exit(counts.FAIL ? 1 : 0);
}

// 2) Ollama reachability
{
  const { ms, value } = await withTiming(() => checkOllamaBase(OLLAMA_API_URL));
  steps.push(value.ok ? ok("ollama reachable", ms, `${OLLAMA_API_URL} (${value.details})`) : fail("ollama reachable", ms, `${OLLAMA_API_URL} (${value.details})`));
}

// 3) Embeddings availability
const embeddingsPath = join(VAULT_PATH, "GZMO", "embeddings.json");
let store: EmbeddingStore | undefined;
{
  const { ms, value } = await withTiming(async () => {
    // If file doesn't exist, syncEmbeddings might create it, but we still attempt and report the outcome.
    return await syncEmbeddings(VAULT_PATH, embeddingsPath, OLLAMA_API_URL);
  }).catch((e: any) => ({ ms: 0, value: e as any }));

  if (value && typeof (value as any).chunks?.length === "number") {
    store = value as any;
    const s = store;
    steps.push(ok("embeddings load/sync", ms, `chunks=${s?.chunks.length ?? 0}`));
  } else {
    const msg = (value as any)?.message ?? String(value);
    steps.push(warn("embeddings load/sync", ms, msg));
  }
}

// 4) Pipeline checks (creates a few tasks in Inbox and cleans up)
banner("Pipeline checks");
const pulse = new PulseLoop(defaultConfig());
const snapshotPath = join(VAULT_PATH, "GZMO", "CHAOS_STATE.json");
pulse.start(snapshotPath);
await new Promise(r => setTimeout(r, 800));
const snap = pulse.snapshot();
const calmSnap: ChaosSnapshot = { ...snap, tension: 5, energy: 100, alive: true };

const memory = new TaskMemory(join(VAULT_PATH, "GZMO", "memory.json"));
const watcher = new VaultWatcher(INBOX_PATH);
watcher.start();
await new Promise(r => setTimeout(r, 200));

try {
  // think
  {
    const filePath = join(INBOX_PATH, "_doctor_think.md");
    fs.writeFileSync(filePath, `---\nstatus: pending\naction: think\n---\n\nState your name and current phase. Keep it under 40 words.\n`);
    const ev: TaskEvent = {
      filePath,
      fileName: "_doctor_think",
      status: "pending",
      body: "State your name and current phase. Keep it under 40 words.",
      frontmatter: { status: "pending", action: "think" },
    };
    const { ms } = await withTiming(async () => processTask(ev, watcher, VAULT_PATH, pulse, store, memory));
    const content = fs.readFileSync(filePath, "utf-8");
    const response = content.match(/## GZMO Response[\s\S]*$/)?.[0] ?? "";
    const g = gradeOutput(response);
    steps.push(g.quality === "BAD" ? fail("processTask: think", ms, g.issues.join(", ")) : g.quality === "WARN" ? warn("processTask: think", ms, g.issues.join(", ")) : ok("processTask: think", ms, "clean"));
  }

  // search (requires store)
  if (!store) {
    steps.push(skip("processTask: search", "no embedding store"));
  } else {
    const filePath = join(INBOX_PATH, "_doctor_search.md");
    fs.writeFileSync(filePath, `---\nstatus: pending\naction: search\n---\n\nFrom the vault, summarize what PulseLoop does and name 2 state variables it tracks.\n`);
    const ev: TaskEvent = {
      filePath,
      fileName: "_doctor_search",
      status: "pending",
      body: "From the vault, summarize what PulseLoop does and name 2 state variables it tracks.",
      frontmatter: { status: "pending", action: "search" },
    };
    const { ms } = await withTiming(async () => processTask(ev, watcher, VAULT_PATH, pulse, store, memory));
    const content = fs.readFileSync(filePath, "utf-8");
    const response = content.match(/## GZMO Response[\s\S]*$/)?.[0] ?? "";
    const g = gradeOutput(response);
    steps.push(g.quality === "BAD" ? fail("processTask: search", ms, g.issues.join(", ")) : g.quality === "WARN" ? warn("processTask: search", ms, g.issues.join(", ")) : ok("processTask: search", ms, "clean"));
  }

  // chain
  {
    const filePath = join(INBOX_PATH, "_doctor_chain.md");
    const next = "_doctor_chain_step2.md";
    fs.writeFileSync(filePath, `---\nstatus: pending\naction: chain\nchain_next: ${next}\n---\n\nStep 1: List exactly 3 subsystems of GZMO.\n`);
    const ev: TaskEvent = {
      filePath,
      fileName: "_doctor_chain",
      status: "pending",
      body: "Step 1: List exactly 3 subsystems of GZMO.",
      frontmatter: { status: "pending", action: "chain", chain_next: next },
    };
    const { ms } = await withTiming(async () => processTask(ev, watcher, VAULT_PATH, pulse, store, memory));
    const chainCreated = fs.existsSync(join(INBOX_PATH, next));
    steps.push(chainCreated ? ok("processTask: chain creates next file", ms, next) : fail("processTask: chain creates next file", ms, "missing chain_next file"));
  }

  // dream + self-ask (requires store)
  if (!store) {
    steps.push(skip("DreamEngine.dream", "no embedding store"));
    steps.push(skip("SelfAskEngine.cycle", "no embedding store"));
  } else {
    {
      const dreams = new DreamEngine(VAULT_PATH);
      const { ms, value } = await withTiming(async () => dreams.dream(calmSnap, infer, store, OLLAMA_API_URL));
      if (!value) {
        steps.push(warn("DreamEngine.dream", ms, "no unprocessed tasks (ok if nothing completed recently)"));
      } else {
        const g = gradeOutput(value.insights);
        steps.push(g.quality === "BAD" ? fail("DreamEngine.dream", ms, g.issues.join(", ")) : g.quality === "WARN" ? warn("DreamEngine.dream", ms, g.issues.join(", ")) : ok("DreamEngine.dream", ms, `source=${value.taskFile}`));
      }
    }

    {
      const selfAsk = new SelfAskEngine(VAULT_PATH);
      const { ms, value } = await withTiming(async () => selfAsk.cycle(calmSnap, store!, OLLAMA_API_URL, infer));
      const bad = value.filter(r => gradeOutput(r.output).quality === "BAD");
      steps.push(bad.length === 0 ? ok("SelfAskEngine.cycle", ms, `strategies=${value.length}`) : warn("SelfAskEngine.cycle", ms, `bad=${bad.length}/${value.length}`));
    }
  }
} catch (e: any) {
  steps.push(fail("pipeline checks", 0, e?.message ?? String(e)));
} finally {
  await watcher.stop();
  pulse.stop();
}

// 5) Wiki lint scan (fast-ish, no writes unless autofix is enabled elsewhere)
banner("Wiki scan");
{
  const { ms, value } = await withTiming(async () => runWikiLint(VAULT_PATH, { staleDays: 365 }));
  const findings = value.findings.length;
  steps.push(findings === 0 ? ok("runWikiLint: findings=0", ms) : warn("runWikiLint: findings present", ms, `findings=${findings}`));
}

// 6) Optional deep: wiki engine cycle (can write/update wiki pages)
if (!flags.deep) {
  steps.push(skip("WikiEngine.cycle", "enable with --deep"));
} else {
  const srcPath = resolve(import.meta.dir, "src");
  const wikiEng = new WikiEngine(VAULT_PATH, srcPath);
  try {
    const { ms, value } = await withTiming(async () => wikiEng.cycle(infer, store, OLLAMA_API_URL));
    steps.push(ok("WikiEngine.cycle", ms, `pages=${value.length}`));
  } catch (e: any) {
    steps.push(fail("WikiEngine.cycle", 0, e?.message ?? String(e)));
  }
}

// 7) Cleanup
if (flags.cleanup) {
  const removed = cleanupInbox(INBOX_PATH);
  steps.push(ok("cleanup _doctor_ inbox files", 0, `removed=${removed}`));
} else {
  steps.push(skip("cleanup _doctor_ inbox files", "disabled by --no-cleanup"));
}

const { counts } = summarize(steps);
process.exit(counts.FAIL ? 1 : 0);
