/**
 * Richer Markdown synthesis for ToT best path + pruned transparency.
 */

import type { ToTNode } from "./controller";

export interface SynthesisResult {
  markdown: string;
}

function confidenceLabel(c: number): string {
  return c >= 0.7 ? "High" : c >= 0.4 ? "Medium" : "Low";
}

export function synthesizeToTAnswer(
  path: ToTNode[],
  allNodes: ToTNode[],
  evidenceIdsFallback: string[],
): SynthesisResult {
  const seenDiscarded = new Set<string>();
  const discarded: Array<{ text: string; reason: string }> = [];

  for (const node of path) {
    const parent = allNodes.find((n) => n.node_id === node.parent_id);
    if (!parent) continue;
    for (const sib of parent.children) {
      if (sib.node_id === node.node_id) continue;
      if (!sib.pruned || sib.type !== "verify") continue;
      if (!sib.claims?.length) continue;
      if (seenDiscarded.has(sib.node_id)) continue;
      seenDiscarded.add(sib.node_id);
      discarded.push({
        text: sib.claims.map((c) => c.text).join("; "),
        reason: `score ${sib.score?.toFixed(2) ?? "?"} below threshold`,
      });
    }
  }

  const synthesisNote =
    discarded.length > 0
      ? `Selected from ${path.length} reasoning step(s). ${discarded.length} alternative branch(es) were pruned or not selected.`
      : `Selected from ${path.length} reasoning step(s).`;

  const lines: string[] = [`## Reasoned answer`, ``, synthesisNote, ``];

  for (const n of path) {
    for (const c of n.claims ?? []) {
      const ev = c.sources?.length ? c.sources.join(", ") : evidenceIdsFallback.join(", ") || "—";
      lines.push(
        `- ${c.text} _(confidence: ${confidenceLabel(c.confidence)} — evidence: ${ev})_`,
      );
    }
  }

  if (discarded.length > 0) {
    lines.push(``, `---`, `*Alternatives not selected:*`);
    for (const d of discarded) {
      lines.push(`- ${d.text} _(${d.reason})_`);
    }
  }

  return { markdown: lines.join("\n") };
}
