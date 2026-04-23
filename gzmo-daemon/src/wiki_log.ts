import { join } from "path";
import { atomicWriteText } from "./vault_fs";

export type WikiOperation = "ingest" | "query" | "lint" | "update" | "create" | "dream";

function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function ensureWikiLogExists(vaultPath: string): Promise<void> {
  const logPath = join(vaultPath, "wiki", "log.md");
  const file = Bun.file(logPath);
  if (await file.exists()) return;

  const content = [
    "---",
    "title: Wiki Operations Log",
    "type: log",
    `updated: ${isoDate()}`,
    "---",
    "",
    "# Wiki Operations Log",
    "",
    "Chronological record of all wiki operations. Append-only.",
    "",
  ].join("\n");

  await atomicWriteText(vaultPath, logPath, content);
}

export async function appendWikiLogEntry(params: {
  vaultPath: string;
  operation: WikiOperation;
  title: string;
  summary?: string;
  pagesTouched?: string[]; // wikilinks or paths
  contradictions?: string;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const logPath = join(params.vaultPath, "wiki", "log.md");
  await ensureWikiLogExists(params.vaultPath);

  const existing = await Bun.file(logPath).text().catch(() => "");
  const lines: string[] = [];
  lines.push(`## [${isoDate(now)}] ${params.operation} | ${params.title}`);
  if (params.summary) lines.push(`- Summary: ${params.summary}`);
  if (params.pagesTouched && params.pagesTouched.length > 0) {
    lines.push(`- Pages touched: ${params.pagesTouched.join(", ")}`);
  }
  if (params.contradictions) lines.push(`- Contradictions: ${params.contradictions}`);
  lines.push("");

  // We append; we also bump the `updated` field if present by regenerating the frontmatter line.
  const updated = isoDate(now);
  const newContent = existing.replace(/^updated:\s*\d{4}-\d{2}-\d{2}\s*$/m, `updated: ${updated}`) + "\n" + lines.join("\n");
  await atomicWriteText(params.vaultPath, logPath, newContent.trimEnd() + "\n");
}

