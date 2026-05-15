/**
 * ACP Step 2 — entity collision check against Knowledge Graph constraints.
 */

import { readBoolEnv } from "./pipelines/helpers";

export interface EntityCollision {
  entity: string;
  constraint?: string;
  edgeType?: string;
  evidence?: string;
}

export function kgCollisionEnabled(): boolean {
  return readBoolEnv("GZMO_ENABLE_KG_COLLISION", false);
}

export async function checkKgCollisions(
  vaultRoot: string,
  body: string,
  taskRelPath: string,
): Promise<EntityCollision[]> {
  if (!kgCollisionEnabled() || !vaultRoot) return [];

  const { KnowledgeGraph, extractEntities } = await import("./knowledge_graph/graph");
  const kg = KnowledgeGraph.forVault(vaultRoot);
  await kg.init();

  const entities = extractEntities(body, taskRelPath);
  const collisions: EntityCollision[] = [];
  const seen = new Set<string>();

  for (const ent of entities) {
    const key = ent.text.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    for (const c of kg.queryCollisions(key)) {
      collisions.push(c);
    }
  }

  return collisions;
}

export function formatCollisionClarification(collisions: EntityCollision[]): string {
  return [
    "I detected conflicts with known constraints in the knowledge graph:",
    "",
    ...collisions.map((c) => {
      const parts = [`- **${c.entity}**`];
      if (c.constraint) parts.push(`: ${c.constraint}`);
      else if (c.evidence) parts.push(` (${c.edgeType ?? "contradicts"}: ${c.evidence})`);
      return parts.join("");
    }),
    "",
    "Please clarify how to proceed given these constraints, then set `status: pending`.",
  ].join("\n");
}
