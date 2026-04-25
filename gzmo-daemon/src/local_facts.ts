import { join } from "path";

function normalizeQuery(q: string): string {
  return String(q ?? "").toLowerCase();
}

async function readFirstN(fileAbs: string, maxChars: number): Promise<string | null> {
  try {
    const f = Bun.file(fileAbs);
    if (f.size === 0) return null;
    const raw = await f.text();
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, maxChars);
  } catch {
    return null;
  }
}

async function fileFact(label: string, abs: string, previewChars = 600): Promise<string | null> {
  if (previewChars <= 0) {
    // Inventory mode: keep facts compact; existence is enough.
    try {
      const f = Bun.file(abs);
      const ok = f.size > 0;
      return `- ${label}: \`${abs}\` (${ok ? "exists" : "missing or empty"})`;
    } catch {
      return `- ${label}: \`${abs}\` (missing or unreadable)`;
    }
  }

  const preview = await readFirstN(abs, previewChars);
  if (!preview) return `- ${label}: \`${abs}\` (missing or empty)`;
  return [
    `- ${label}: \`${abs}\` (exists)`,
    "```",
    preview,
    "```",
  ].join("\n");
}

/**
 * Deterministic, non-RAG grounding for operational/system questions.
 *
 * This is intentionally:
 * - cheap (bounded reads)
 * - local-first (filesystem + a few code loci)
 * - additive (prepended to RAG context, never replaces it)
 */
export async function gatherLocalFacts(params: {
  vaultPath: string;
  query: string;
}): Promise<string> {
  const q = normalizeQuery(params.query);
  const wantsInventory =
    /\boperational\b/.test(q) ||
    /\boutputs?\b/.test(q) ||
    /\bwrites?\b/.test(q) ||
    /\bwritten\b/.test(q);

  const wantsOps =
    /\btelemetry\b/.test(q) ||
    /\bhealth\b/.test(q) ||
    /\bembeddings?\b/.test(q) ||
    /\bwhere\b/.test(q) && /\bwrite|writes|written|store|stored|output\b/.test(q) ||
    /\bpath\b/.test(q) ||
    /\bjson\b/.test(q);

  if (!wantsOps) return "";

  const facts: string[] = [];

  const telemetryAbs = join(params.vaultPath, "GZMO", "TELEMETRY.json");
  const healthAbs = join(params.vaultPath, "GZMO", "health.md");
  const embeddingsAbs = join(params.vaultPath, "GZMO", "embeddings.json");
  const opsOutputsAbs = join(params.vaultPath, "GZMO", "OPS_OUTPUTS.json");

  if (q.includes("telemetry") || q.includes("health") || q.includes("json") || q.includes("write") || q.includes("where")) {
    // In inventory-mode, keep the deterministic facts extremely compact so they don't crowd out
    // the vault state index in the Evidence Packet.
    facts.push(await fileFact("telemetry", telemetryAbs, wantsInventory ? 0 : 900) as string);
    facts.push(await fileFact("health", healthAbs, wantsInventory ? 0 : 700) as string);
  }
  if (q.includes("embed")) {
    facts.push(await fileFact("embeddings_store", embeddingsAbs, wantsInventory ? 0 : 500) as string);
  }
  if (wantsInventory || q.includes("output")) {
    // The code-defined contract surface for "what does the daemon write?"
    facts.push(await fileFact("ops_outputs_registry", opsOutputsAbs, wantsInventory ? 900 : 600) as string);
  }

  // Minimal code loci (cheap, stable): where health/telemetry is written.
  const codeSnippetTargets: Array<{ label: string; abs: string }> = [
    { label: "code:health_writer", abs: join(import.meta.dir, "health.ts") },
    { label: "code:daemon_entry", abs: join(import.meta.dir, "..", "index.ts") },
  ];

  if (!wantsInventory && (q.includes("telemetry") || q.includes("health") || q.includes("where") || q.includes("write") || q.includes("json"))) {
    for (const t of codeSnippetTargets) {
      const preview = await readFirstN(t.abs, 800);
      if (!preview) continue;
      // Keep only the most relevant lines when possible.
      const lines = preview.split("\n").filter((l) =>
        l.includes("TELEMETRY") || l.includes("writeHealth") || l.includes("health.md") || l.includes("atomicWriteJson")
      );
      const shown = (lines.length > 0 ? lines.slice(0, 30).join("\n") : preview).trim();
      if (!shown) continue;
      facts.push([
        `- ${t.label}: \`${t.abs}\``,
        "```",
        shown.slice(0, 800),
        "```",
      ].join("\n"));
    }
  }

  const compact = facts.filter(Boolean);
  if (compact.length === 0) return "";

  return `\n## Local Facts (deterministic)\n${compact.join("\n")}\n`;
}

