/**
 * Critique generation — when all branches fail, diagnose why.
 */

import type { ToTNode } from "./controller";
import type { InferenceResult } from "../inference";

export interface CritiqueResult {
  problems: string[];
  recommendation: string;
  shouldReplan: boolean;
}

export async function generateCritique(
  allNodes: ToTNode[],
  threshold: number,
  inferDetailedFn: (s: string, p: string, o?: import("../inference").InferDetailedOptions) => Promise<InferenceResult>,
  systemPrompt: string,
): Promise<CritiqueResult> {
  const verifyNodes = allNodes.filter((n) => n.type === "verify" && (n.retryGeneration ?? 0) === 0);
  const scores = verifyNodes.map((n) => n.score ?? 0);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const contextLines: string[] = [
    "All reasoning branches failed to pass the verification threshold.",
    `Branches attempted: ${verifyNodes.length}`,
    `Average score: ${avgScore.toFixed(2)} (threshold: ${threshold})`,
    "",
    "Per-branch summaries:",
  ];

  for (const n of verifyNodes.slice(0, 12)) {
    const claims = n.claims?.map((c) => `- ${c.text}`).join("\n") ?? "(no claims)";
    contextLines.push(`Branch ${n.node_id}: score=${n.score?.toFixed(2) ?? "?"}\n${claims}`);
  }

  const critiquePrompt = [
    contextLines.join("\n"),
    "",
    "Critique this reasoning process. Identify up to 3 problems.",
    "Then recommend ONE specific change for the next attempt.",
    "",
    "Format:",
    "PROBLEM 1: <concise problem>",
    "PROBLEM 2: <concise problem> (optional)",
    "PROBLEM 3: <concise problem> (optional)",
    "RECOMMENDATION: <specific actionable change>",
    "SHOULD_REPLAN: yes | no",
  ].join("\n");

  const result = await inferDetailedFn(systemPrompt, critiquePrompt, { temperature: 0.2, maxTokens: 300 });

  const text = result.answer;
  const problems = [...text.matchAll(/PROBLEM\s*\d*\s*:\s*(.+)/gi)].map((m) => m[1]!.trim());
  const recMatch = text.match(/RECOMMENDATION:\s*(.+)/i);
  const replanMatch = text.match(/SHOULD_REPLAN:\s*(yes|no)/i);

  return {
    problems: problems.slice(0, 3),
    recommendation: recMatch?.[1]?.trim() ?? "No recommendation. Return insufficient evidence.",
    shouldReplan: replanMatch?.[1]?.toLowerCase() === "yes",
  };
}
