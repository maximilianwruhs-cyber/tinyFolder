/**
 * Beam-style priority for which ToT branch to expand next.
 */

import type { ToTController, ToTNode } from "./controller";

export function estimatePriority(node: ToTNode, tot: ToTController): number {
  const parent = node.parent_id ? tot.findNode(node.parent_id) : undefined;
  const parentScore = parent?.score ?? 0.5;
  const depthBonus = 1.0 / (node.depth + 1);
  const evidenceBonus = (node.evidence_cited?.length ?? 0) * 0.05;
  return parentScore * 0.6 + depthBonus * 0.3 + evidenceBonus * 0.1;
}
