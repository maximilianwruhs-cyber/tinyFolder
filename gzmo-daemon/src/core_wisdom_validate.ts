import { join } from "path";
import { readCoreWisdomRouting } from "./core_wisdom";

export interface CoreWisdomFinding {
  kind: "missing_core_wisdom" | "invalid_routing_block" | "missing_entrypoint";
  details: string;
}

export async function validateCoreWisdom(vaultPath: string): Promise<CoreWisdomFinding[]> {
  const findings: CoreWisdomFinding[] = [];
  const routing = await readCoreWisdomRouting(vaultPath);
  if (!routing) {
    findings.push({ kind: "invalid_routing_block", details: "wiki/overview.md missing or lacks a valid ```yaml routing block." });
    return findings;
  }

  const required = ["coreWisdom", "masterIndex", "wikiIndex", "cortex", "soul"];
  for (const k of required) {
    if (!routing.entrypoints?.[k]) findings.push({ kind: "missing_entrypoint", details: `Missing entrypoints.${k}` });
  }

  // Basic existence checks (best-effort; avoid throwing).
  for (const [k, rel] of Object.entries(routing.entrypoints ?? {})) {
    try {
      const p = join(vaultPath, rel);
      const exists = await Bun.file(p).exists();
      if (!exists) findings.push({ kind: "missing_entrypoint", details: `entrypoints.${k} points to missing file: ${rel}` });
    } catch {}
  }

  return findings;
}

