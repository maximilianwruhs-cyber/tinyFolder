import { join, basename, extname } from "path";
import { existsSync, readFileSync } from "fs";
import matter from "gray-matter";
import { writeSchemaCompliantWikiPage } from "./wiki_contract";

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}

function pageBaseNameFromAbs(absPath: string): string {
  return basename(absPath, extname(absPath));
}

/**
 * Append a wikilink into a page's "## Sources" section.
 * - If "## Sources" exists, add the entry if missing.
 * - Otherwise, append a new "## Sources" section at the end.
 *
 * This is intentionally deterministic and minimal-diff.
 */
export function upsertSourceLink(markdown: string, sourceWikilink: string): string {
  const parsed = matter(markdown);
  const body = ensureTrailingNewline((parsed.content ?? "").trimEnd());

  const linkLine = `- ${sourceWikilink}`;
  if (body.includes(linkLine) || body.includes(sourceWikilink)) {
    // Already referenced somewhere; keep stable.
    return matter.stringify(body, parsed.data);
  }

  const sourcesHeader = /^##\s+Sources\s*$/m;
  if (!sourcesHeader.test(body)) {
    const appended = `${body}\n\n## Sources\n\n${linkLine}\n`;
    return matter.stringify(appended.trimEnd() + "\n", parsed.data);
  }

  // Insert under Sources section: after the header line, and after any blank line.
  const lines = body.split("\n");
  const out: string[] = [];
  let inSources = false;
  let inserted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out.push(line);
    if (!inSources && /^##\s+Sources\s*$/.test(line)) {
      inSources = true;
      continue;
    }
    if (inSources && !inserted) {
      // Insert before next section header (## ...) or at end.
      const next = lines[i + 1];
      const isNextHeader = typeof next === "string" && /^##\s+/.test(next);
      if (isNextHeader) {
        out.push("");
        out.push(linkLine);
        inserted = true;
      }
    }
    if (inSources && /^##\s+/.test(line) && !/^##\s+Sources\s*$/.test(line)) {
      inSources = false;
    }
  }

  if (!inserted) {
    out.push(linkLine);
  }

  return matter.stringify(out.join("\n").trimEnd() + "\n", parsed.data);
}

export async function linkSourceIntoWikiPage(params: {
  vaultPath: string;
  pageAbs: string;
  sourceSummaryAbs: string;
}): Promise<{ pageBase: string; title: string }> {
  if (!existsSync(params.pageAbs)) throw new Error(`Target page missing: ${params.pageAbs}`);

  const pageRaw = readFileSync(params.pageAbs, "utf-8");
  const sourceBase = pageBaseNameFromAbs(params.sourceSummaryAbs);
  const wikilink = `[[${sourceBase}]]`;

  const updated = upsertSourceLink(pageRaw, wikilink);
  const normalized = await writeSchemaCompliantWikiPage({
    vaultPath: params.vaultPath,
    wikiFileAbs: params.pageAbs,
    rawMarkdown: updated,
  });

  return { pageBase: pageBaseNameFromAbs(params.pageAbs), title: normalized.frontmatter.title };
}

