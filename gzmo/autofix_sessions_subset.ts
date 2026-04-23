import { resolve, join } from "path";
import { writeSchemaCompliantWikiPage } from "./src/wiki_contract";

const vaultPath = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : "";
if (!vaultPath) {
  console.error("VAULT_PATH is required. Example: VAULT_PATH=../vault bun run autofix:sessions");
  process.exit(2);
}

const targets = [
  "wiki/sessions/2026-04-18_session-distill_audits.md",
  "wiki/sessions/2026-04-18_session-distill_architecture.md",
  "wiki/sessions/2026-04-18_session-distill_chaos-engine.md",
  "wiki/sessions/2026-04-18_session-walkthroughs-history.md",
];

function sanitizeHtmlish(raw: string): string {
  // The wiki contract rejects HTML outside code fences. Some session-distill pages
  // include mermaid labels with <br/> or leaked <think> tags in plain text.
  // We convert these to non-HTML equivalents to make the page schema-compliant.
  const lines = raw.split("\n");
  let inFence = false;
  const out: string[] = [];
  for (let line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence) {
      // Replace HTML linebreaks often used in mermaid labels
      line = line.replace(/<br\s*\/?>/gi, "\\n");
      // Escape think tags if they leak into plain text
      line = line.replace(/<\/?think(ing)?>/gi, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
      // Escape any remaining HTML-ish tags the contract would reject
      line = line.replace(/<([a-zA-Z][^>]*)>/g, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    }
    out.push(line);
  }
  return out.join("\n");
}

let changed = 0;
for (const rel of targets) {
  const abs = join(vaultPath, rel);
  try {
    const before = await Bun.file(abs).text().catch(() => null);
    const out = await writeSchemaCompliantWikiPage({
      vaultPath,
      wikiFileAbs: abs,
      rawMarkdown: sanitizeHtmlish(before ?? ""),
    });
    const after = await Bun.file(abs).text().catch(() => null);
    if (before !== after) changed++;
    console.log(`[autofix:sessions] OK ${rel}`);
  } catch (e: any) {
    console.error(`[autofix:sessions] FAIL ${rel}: ${e?.message ?? String(e)}`);
    process.exitCode = 1;
  }
}

console.log(`[autofix:sessions] done (targets=${targets.length}, changed=${changed})`);
