/**
 * Per-node quality score via shadow judge + internal confidence.
 */

import { shadowJudge } from "../shadow_judge";
import type { ToTNode } from "./controller";

export interface EvaluateNodeResult {
  score: number;
  trace: string;
}

export async function evaluateNodeWithJudge(
  node: ToTNode,
  model: any,
  userPrompt: string,
  evidenceContext: string,
): Promise<EvaluateNodeResult> {
  if (!node.claims || node.claims.length === 0) {
    return { score: 0.5, trace: "" };
  }

  const answer = node.claims.map((c) => `- ${c.text} (confidence: ${c.confidence})`).join("\n");
  const internalConfidence = node.claims.reduce((sum, c) => sum + c.confidence, 0) / node.claims.length;

  try {
    const judge = await shadowJudge({
      model,
      userPrompt,
      answer,
      evidenceContext,
      maxTokens: 200,
    });
    return {
      score: Math.min(1, (judge.score + internalConfidence) / 2),
      trace: judge.trace,
    };
  } catch {
    return { score: internalConfidence, trace: "" };
  }
}

export async function evaluateNode(
  node: ToTNode,
  model: any,
  userPrompt: string,
  evidenceContext: string,
): Promise<number> {
  const r = await evaluateNodeWithJudge(node, model, userPrompt, evidenceContext);
  return r.score;
}
