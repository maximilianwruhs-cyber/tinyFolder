/**
 * Deterministic dialectic orchestrator (DSJ + optional PDU).
 * Extracted from engine.ts for maintainability — sequential states only.
 */

import { readBoolEnv } from "../pipelines/helpers";
import { inferByRole } from "../inference_router";
import { inferDetailed } from "../inference";
import { shadowJudge, type ShadowJudgeResult } from "../shadow_judge";
import type { InferenceResult } from "../inference";

export type DialecticState =
  | "IDLE"
  | "PROSECUTING"
  | "DEFENDING"
  | "SYNTHESIZING"
  | "RESOLVED"
  | "UNBOUND";

export interface DsjMetrics {
  initial?: number;
  rewrite?: number;
  accepted?: boolean;
}

export type DialecticOutcome =
  | { kind: "accept"; answer: string; metrics: DsjMetrics; state: "RESOLVED" }
  | {
      kind: "unbound";
      clarification: string;
      haltType: string;
      haltReason: string;
      metrics: DsjMetrics;
      state: "UNBOUND";
    }
  | { kind: "noop"; state: "IDLE" };

export interface DialecticParams {
  userPrompt: string;
  initialAnswer: string;
  systemPrompt: string;
  evidenceContext?: string;
  threshold: number;
  temperature: number;
  maxTokens: number;
  pduEnabled?: boolean;
  infer?: (system: string, user: string, opts: { temperature: number; maxTokens: number }) => Promise<InferenceResult>;
}

function defaultInfer(system: string, user: string, opts: { temperature: number; maxTokens: number }) {
  return readBoolEnv("GZMO_ENABLE_MODEL_ROUTING", false)
    ? inferByRole("reason", system, user, opts)
    : inferDetailed(system, user, opts);
}

function judgeInferRole(role: "reason" | "judge", system: string, user: string, opts: { temperature: number; maxTokens: number }) {
  return readBoolEnv("GZMO_ENABLE_MODEL_ROUTING", false)
    ? inferByRole(role, system, user, opts)
    : inferDetailed(system, user, opts);
}

export async function runDialecticLoop(params: DialecticParams): Promise<DialecticOutcome> {
  const {
    userPrompt,
    initialAnswer,
    systemPrompt,
    evidenceContext,
    threshold,
    temperature,
    maxTokens,
    pduEnabled = readBoolEnv("GZMO_ENABLE_PDU", false),
    infer = defaultInfer,
  } = params;

  let state: DialecticState = "PROSECUTING";
  const metrics: DsjMetrics = {};

  const dsjResult: ShadowJudgeResult = await shadowJudge({
    userPrompt,
    answer: initialAnswer,
    evidenceContext,
    maxTokens: 300,
  });

  console.log(
    `[DSJ] Score: ${dsjResult.score.toFixed(2)} (threshold: ${threshold}, parseOk: ${dsjResult.parseOk})`,
  );
  metrics.initial = dsjResult.score;

  if (!dsjResult.parseOk || dsjResult.score >= threshold) {
    return { kind: "noop", state: "IDLE" };
  }

  state = "DEFENDING";
  const defensePrompt = [
    "A quality review found issues with your previous answer.",
    "",
    "CRITIQUE:",
    dsjResult.trace || "(no detailed critique available)",
    "",
    "ORIGINAL QUESTION:",
    userPrompt,
    "",
    "YOUR PREVIOUS ANSWER:",
    initialAnswer.slice(0, 2000),
    "",
    "Rewrite your answer to address the critique. Keep the same format.",
    "If the critique is about missing evidence, say 'insufficient evidence' for those claims.",
  ].join("\n");

  const rewrite = await infer(systemPrompt, defensePrompt, {
    temperature: Math.max(0.3, temperature - 0.2),
    maxTokens,
  });

  const reJudge = await shadowJudge({
    userPrompt,
    answer: rewrite.answer,
    evidenceContext,
    maxTokens: 200,
  });

  console.log(`[DSJ] Re-judge score: ${reJudge.score.toFixed(2)}`);
  metrics.rewrite = reJudge.score;

  if (reJudge.parseOk && reJudge.score >= threshold) {
    metrics.accepted = true;
    console.log(`[DSJ] Rewrite accepted (${reJudge.score.toFixed(2)} >= ${threshold})`);
    return { kind: "accept", answer: rewrite.answer, metrics, state: "RESOLVED" };
  }

  if (pduEnabled) {
    state = "SYNTHESIZING";
    const umpirePrompt = [
      "PROPOSAL:",
      initialAnswer.slice(0, 1500),
      "",
      "CRITIQUE (Prosecutor):",
      dsjResult.trace || "(none)",
      "",
      "DEFENSE (Defender):",
      rewrite.answer.slice(0, 1500),
      "",
      "Synthesize these perspectives into one final answer. Keep citations and format rules.",
    ].join("\n");

    const umpire = await judgeInferRole("judge", systemPrompt, umpirePrompt, {
      temperature: Math.max(0.25, temperature - 0.25),
      maxTokens,
    });

    const umpireJudge = await shadowJudge({
      userPrompt,
      answer: umpire.answer,
      evidenceContext,
      maxTokens: 200,
    });

    if (umpireJudge.parseOk && umpireJudge.score >= threshold) {
      metrics.accepted = true;
      metrics.rewrite = umpireJudge.score;
      console.log(`[PDU] Umpire synthesis accepted (${umpireJudge.score.toFixed(2)})`);
      return { kind: "accept", answer: umpire.answer, metrics, state: "RESOLVED" };
    }

    metrics.accepted = false;
    return {
      kind: "unbound",
      haltType: "pdu_quality_halt",
      haltReason: "pdu_quality_halt",
      state: "UNBOUND",
      metrics,
      clarification: [
        "GZMO could not synthesize a confident answer (PDU umpire pass failed).",
        "",
        `**Umpire score:** ${umpireJudge.score.toFixed(2)}`,
        `**Threshold:** ${threshold}`,
        "",
        "**Prosecutor notes:**",
        dsjResult.trace || "(none)",
      ].join("\n"),
    };
  }

  metrics.accepted = false;
  return {
    kind: "unbound",
    haltType: "dsj_quality_halt",
    haltReason: "dsj_quality_halt",
    state: "UNBOUND",
    metrics,
    clarification: [
      "GZMO could not produce a confident answer after two attempts.",
      "",
      `**Initial score:** ${dsjResult.score.toFixed(2)}`,
      `**Rewrite score:** ${reJudge.score.toFixed(2)}`,
      `**Threshold:** ${threshold}`,
      "",
      "**Quality review notes:**",
      dsjResult.trace || "(none)",
      "",
      "**Suggestions:**",
      "- Rephrase the question with more specific terms",
      "- Add more relevant documents to the vault",
      "- Lower the threshold via `GZMO_DSJ_THRESHOLD` if answers are consistently blocked",
      "",
      "_For stronger critique, enable `GZMO_ENABLE_MODEL_ROUTING=on` and configure a dedicated judge model._",
    ].join("\n"),
  };
}
