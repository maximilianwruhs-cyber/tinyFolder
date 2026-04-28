import { readFileSync } from "fs";
import { join } from "path";
import { evaluateFitness, type FitnessResult, type ScoringConfig, type TrialResult } from "./fitness_scorer";
import { PERF_JSONL_PATH, type TaskPerfEvent } from "./perf";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function readWeight(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface PerfFitnessParams {
  vaultRoot: string;
  limit?: number; // number of most recent trials to consider
  requireRouteJudge?: boolean; // skip events without route_judge
  actions?: string[]; // default ["search"]
  scoringConfig: ScoringConfig;
  energyJoules: number;
}

export interface PerfFitnessResult {
  trials: TrialResult[];
  fitness: FitnessResult;
}

function safeJsonParse(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isTaskPerfEvent(v: any): v is TaskPerfEvent {
  return v && typeof v === "object" && v.type === "task_perf" && typeof v.fileName === "string";
}

export function loadPerfJsonlTrials(params: PerfFitnessParams): TrialResult[] {
  const limit = Math.max(1, Math.min(500, params.limit ?? 60));
  const requireRouteJudge = params.requireRouteJudge ?? true;
  const actions = (params.actions?.length ? params.actions : ["search"]).map((a) => a.toLowerCase());

  // Composite similarity weights (RouteJudge metrics → similarity 0..1).
  const wCite = readWeight("GZMO_PERF_SIM_W_CITE", 0.6);
  const wBackticks = readWeight("GZMO_PERF_SIM_W_BACKTICKS", 0.2);
  const wAdv = readWeight("GZMO_PERF_SIM_W_ADVERSARIAL", 0.2);
  const wSum = wCite + wBackticks + wAdv;
  const denom = wSum > 0 ? wSum : 1;

  const path = join(params.vaultRoot, PERF_JSONL_PATH);
  let raw = "";
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const trials: TrialResult[] = [];

  // Walk backwards (most recent first)
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = safeJsonParse(lines[i] ?? "");
    if (!isTaskPerfEvent(obj)) continue;
    const action = String(obj.action ?? "").toLowerCase();
    if (!actions.includes(action)) continue;
    if (obj.ok === false) continue;

    const rj = obj.route_judge;
    if (requireRouteJudge && !rj) continue;

    const cite = rj ? clamp01(Number(rj.partValidCitationRate ?? 0)) : 0;
    const back = rj ? clamp01(Number(rj.partBackticksComplianceRate ?? 0)) : 0;
    const adv = rj ? clamp01(Number(rj.partAdversarialRejectRate ?? 0)) : 0;
    const sim = rj ? clamp01((wCite * cite + wBackticks * back + wAdv * adv) / denom) : 0;
    const passed = rj ? sim >= 0.9 : false;
    const executionTimeMs = Number(obj.total_ms ?? 0);

    trials.push({
      passed,
      executionTimeMs: Number.isFinite(executionTimeMs) ? Math.max(0, executionTimeMs) : 0,
      outputSimilarity: sim,
    });

    if (trials.length >= limit) break;
  }

  // Reverse to chronological order (optional, but nicer for variance intuition)
  return trials.reverse();
}

export function computePerfFitness(params: PerfFitnessParams): PerfFitnessResult {
  const trials = loadPerfJsonlTrials(params);
  const fitness = evaluateFitness({ trials, energyJoules: params.energyJoules, config: params.scoringConfig });
  return { trials, fitness };
}

