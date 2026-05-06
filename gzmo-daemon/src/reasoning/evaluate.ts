/**
 * Per-node quality score via shadow judge + internal confidence.
 */

import { shadowJudge } from "../shadow_judge";
import type { ToTNode } from "./controller";

export async function evaluateNode(
  node: ToTNode,
  model: any,
  userPrompt: string,
  evidenceContext: string,
): Promise<number> {
  if (!node.claims || node.claims.length === 0) return 0.5;

  const answer = node.claims.map((c) => `- ${c.text} (confidence: ${c.confidence})`).join("\n");

  try {
    const judge = await shadowJudge({
      model,
      userPrompt,
      answer,
      evidenceContext,
      maxTokens: 200,
    });

    const internalConfidence = node.claims.reduce((sum, c) => sum + c.confidence, 0) / node.claims.length;
    return Math.min(1, (judge.score + internalConfidence) / 2);
  } catch {
    const internalConfidence = node.claims.reduce((sum, c) => sum + c.confidence, 0) / node.claims.length;
    return internalConfidence;
  }
}
