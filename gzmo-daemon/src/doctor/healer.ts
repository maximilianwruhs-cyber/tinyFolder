/**
 * healer.ts — Self-Healing Engine for GZMO Doctor
 *
 * Registry-based fix handlers attempt to resolve FAIL/WARN steps.
 * Each handler returns { success, output, error } so the loop can track
 * what changed and whether to re-run diagnostics.
 *
 * Only safe, side-effect-local fixes are registered by default.
 */

import { join, resolve } from "path";
import * as fs from "fs";
import type { DoctorFixSuggestion, DoctorEnvironment, StepStatus } from "./types";

export interface HealingAttempt {
  fixId: string;
  fixTitle: string;
  appliedAt: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface HealingExecution {
  iteration: number; // 1-based healing pass
  applied: HealingAttempt[];
  resolvedIds: string[]; // step ids that went from FAIL/WARN → PASS
  remainingIds: string[]; // step ids still FAIL/WARN after this pass
}

export interface HealingContext {
  env: DoctorEnvironment;
  readonly: boolean;
  signal: AbortSignal;
}

export type FixHandler = (
  fix: DoctorFixSuggestion,
  ctx: HealingContext,
) => Promise<{ success: boolean; output?: string; error?: string }>;

const FIX_REGISTRY = new Map<string, FixHandler>();

export function registerFixHandler(idPrefix: string, handler: FixHandler): void {
  FIX_REGISTRY.set(idPrefix, handler);
}

export function getFixHandler(id: string): FixHandler | undefined {
  for (const [prefix, handler] of FIX_REGISTRY) {
    if (id === prefix || id.startsWith(prefix + ".")) return handler;
  }
  return undefined;
}

// ── Built-in fix handlers ──────────────────────────────────────

/** Create missing vault scaffold directories. */
registerFixHandler("fix.vault.mkdir", async (fix, ctx) => {
  const dirs: string[] = (fix.commands ?? [])
    .map((c) => {
      const m = c.match(/mkdir\s+-p\s+(.+)/);
      return m ? m[1] : undefined;
    })
    .filter((s): s is string => typeof s === "string");
  if (dirs.length === 0) {
    return { success: false, error: "No mkdir commands in fix" };
  }
  const out: string[] = [];
  for (const d of dirs) {
    const resolved = resolve(d.replace(/\$\{VAULT_PATH\}/g, ctx.env.vaultPath).replace(/\$VAULT_PATH/g, ctx.env.vaultPath));
    try {
      fs.mkdirSync(resolved, { recursive: true });
      out.push(`created: ${resolved}`);
    } catch (e: any) {
      return { success: false, error: `mkdir failed: ${e?.message ?? String(e)}` };
    }
  }
  return { success: true, output: out.join("\n") };
});

/** Set NO_PROXY environment variable (process-local). */
registerFixHandler("proxy.no_proxy", async (fix) => {
  try {
    const cmd = fix.commands?.find((c) => c.includes("NO_PROXY"));
    if (!cmd) return { success: false, error: "No NO_PROXY command" };
    const m = cmd.match(/NO_PROXY=["']?([^"']+)["']?/);
    if (m) {
      process.env.NO_PROXY = m[1];
      return { success: true, output: `NO_PROXY=${process.env.NO_PROXY}` };
    }
    return { success: false, error: "Could not parse NO_PROXY from command" };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
});

/** Start Ollama (best-effort background spawn). */
registerFixHandler("ollama.serve", async (fix, ctx) => {
  if (ctx.readonly) return { success: false, error: "Refusing to start ollama in readonly mode" };
  try {
    // Check if already running
    for (const base of [ctx.env.ollamaBaseUrl ?? "http://127.0.0.1:11434"]) {
      try {
        const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return { success: true, output: `Ollama already responsive at ${base}` };
      } catch { /* not running */ }
    }
    // Spawn
    const p = Bun.spawn({ cmd: ["ollama", "serve"], stdout: "pipe", stderr: "pipe" });
    // Give it a moment
    await new Promise((r) => setTimeout(r, 3000));
    if (p.killed) {
      const err = await new Response(p.stderr).text().catch(() => "");
      return { success: false, error: `ollama serve exited early${err ? `: ${err.slice(0, 400)}` : ""}` };
    }
    // Detach intentionally — we spawned a background service.
    return { success: true, output: "Spawned ollama serve (background)" };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
});

/** Pull missing Ollama models. */
registerFixHandler("ollama.pull_models", async (fix, ctx) => {
  if (ctx.readonly) return { success: false, error: "Refusing to pull models in readonly mode" };
  const cmds = fix.commands?.filter((c) => c.startsWith("ollama pull ")) ?? [];
  if (cmds.length === 0) return { success: false, error: "No ollama pull commands" };
  const out: string[] = [];
  for (const cmd of cmds) {
    const model = cmd.replace("ollama pull ", "").trim();
    try {
      const p = Bun.spawn({ cmd: ["ollama", "pull", model], stdout: "pipe", stderr: "pipe", signal: ctx.signal });
      const text = await new Response(p.stdout).text();
      const code = await p.exited;
      if (code !== 0) {
        const err = await new Response(p.stderr).text().catch(() => "");
        return { success: false, error: `ollama pull ${model} failed (exit ${code}): ${err.slice(0, 400)}` };
      }
      out.push(`pulled ${model}: ${text.slice(0, 200)}`);
    } catch (e: any) {
      return { success: false, error: `ollama pull ${model} error: ${e?.message ?? String(e)}` };
    }
  }
  return { success: true, output: out.join("\n") };
});

// ── Orchestration ──────────────────────────────────────────────

/** Score a status: higher = worse. */
function severity(s: StepStatus): number {
  switch (s) {
    case "PASS":
      return 0;
    case "SKIP":
      return 1;
    case "WARN":
      return 2;
    case "FAIL":
      return 3;
  }
}

export interface StepSignature {
  id: string;
  status: StepStatus;
  summary?: string;
}

export function compareStepSets(before: StepSignature[], after: StepSignature[]): { resolved: string[]; worsened: string[]; same: string[] } {
  const bMap = new Map(before.map((s) => [s.id, s]));
  const aMap = new Map(after.map((s) => [s.id, s]));

  const resolved: string[] = [];
  const worsened: string[] = [];
  const same: string[] = [];

  for (const [id, a] of aMap) {
    const b = bMap.get(id);
    if (!b) continue; // new step
    if (severity(a.status) < severity(b.status)) resolved.push(id);
    else if (severity(a.status) > severity(b.status)) worsened.push(id);
    else same.push(id);
  }
  return { resolved, worsened, same };
}

/**
 * Apply fixes for all FAIL/WARN steps that have registered handlers.
 * Returns the healing execution record for this iteration.
 */
export async function applyHealing(
  steps: { id: string; title: string; status: StepStatus; fix?: DoctorFixSuggestion[] }[],
  ctx: HealingContext,
): Promise<HealingExecution> {
  const applied: HealingAttempt[] = [];
  const failedIds = steps.filter((s) => s.status === "FAIL" || s.status === "WARN").map((s) => s.id);

  for (const step of steps) {
    if (step.status !== "FAIL" && step.status !== "WARN") continue;
    const fixes = step.fix ?? [];
    for (const fix of fixes) {
      const handler = getFixHandler(fix.id);
      if (!handler) continue;
      const result = await handler(fix, ctx);
      applied.push({
        fixId: fix.id,
        fixTitle: fix.title,
        appliedAt: new Date().toISOString(),
        success: result.success,
        output: result.output,
        error: result.error,
      });
    }
  }

  // After applying, we don't know yet which resolved; caller re-runs diagnostics.
  return { iteration: 0, applied, resolvedIds: [], remainingIds: failedIds };
}

/**
 * Decide if we should attempt another healing pass.
 */
export function shouldHealAgain(executions: HealingExecution[], maxRetries: number): boolean {
  if (executions.length >= maxRetries) return false;
  const last = executions[executions.length - 1];
  if (!last) return true;
  // Stop if last pass resolved nothing and applied nothing
  const hadActivity = last.applied.length > 0 || last.resolvedIds.length > 0;
  return hadActivity;
}

/**
 * Summarize the entire healing history into a compact string.
 */
export function healingSummary(executions: HealingExecution[]): string {
  const totalApplied = executions.reduce((n, e) => n + e.applied.length, 0);
  const totalResolved = new Set(executions.flatMap((e) => e.resolvedIds)).size;
  return `Healing passes: ${executions.length}, fixes applied: ${totalApplied}, unique resolved: ${totalResolved}`;
}
