import { join } from "path";
import { promises as fsp } from "fs";

function normalizeQuery(q: string): string {
  return String(q ?? "").toLowerCase();
}

async function safeReaddir(dirAbs: string): Promise<string[]> {
  try {
    return await fsp.readdir(dirAbs);
  } catch {
    return [];
  }
}

/**
 * Deterministic "what exists / where are outputs" index.
 * Designed for ops-style questions. Cheap: bounded directory listings + a few known files.
 */
export async function gatherVaultStateIndex(params: {
  vaultPath: string;
  query: string;
}): Promise<string> {
  const q = normalizeQuery(params.query);
  const wantsOps =
    /\btelemetry\b/.test(q) ||
    /\bhealth\b/.test(q) ||
    /\bembeddings?\b/.test(q) ||
    /\bwhere\b/.test(q) ||
    /\bpath\b/.test(q) ||
    /\boutput\b/.test(q) ||
    /\bindex\b/.test(q);

  if (!wantsOps) return "";

  const gzmoDir = join(params.vaultPath, "GZMO");
  const top = await safeReaddir(gzmoDir);
  const interesting = top
    .filter((n) => !n.startsWith("."))
    .slice(0, 80)
    .map((n) => `- \`${join(gzmoDir, n)}\``);

  // Known outputs (canonical pointers)
  const known = [
    join(params.vaultPath, "GZMO", "TELEMETRY.json"),
    join(params.vaultPath, "GZMO", "health.md"),
    join(params.vaultPath, "GZMO", "embeddings.json"),
    join(params.vaultPath, "wiki", "entities", "GZMO-Ops-Outputs.md"),
  ];

  const knownLines = known.map((p) => `- \`${p}\``);

  return [
    "\n## Vault State Index (deterministic)",
    "Known canonical outputs:",
    ...knownLines,
    "",
    "Top-level `GZMO/` entries (directory listing):",
    ...(interesting.length ? interesting : ["- (missing or unreadable)"]),
    "",
  ].join("\n");
}

