/**
 * yaml_frontmatter.ts — thin replacement for `gray-matter`.
 *
 * The daemon previously imported `gray-matter` in 9 places. That package is
 * unmaintained (last release 2018, still on `js-yaml@3`). We migrated to the
 * actively-maintained `yaml` package (Eemeli Aro, MIT) and keep our internal
 * surface tiny:
 *
 *   parseFrontmatter(raw)           → { data, content }
 *   stringifyFrontmatter(body, fm)  → string starting with `---\n…\n---\n`
 *   matter(raw)                     → { data, content }              (alias)
 *   matter.stringify(body, fm)      → string                         (alias)
 *
 * The gray-matter-compatible default export lets callers keep existing
 * `import matter from "../yaml_frontmatter"` shapes; new code should prefer
 * the named exports.
 *
 * Behavior parity notes:
 *  - We accept `\r\n` and `\n` line endings.
 *  - A leading BOM is stripped before parsing.
 *  - When no frontmatter is present, `data` is `{}` and `content` equals the
 *    full input (matching gray-matter's default).
 *  - `stringify` always emits `---\n<yaml>---\n<body>` with a trailing newline
 *    on the body if the caller didn't include one (gray-matter does the same).
 *  - YAML serialization options match gray-matter's defaults closely:
 *    block style, no flow collapsing, line width disabled to keep diffs sane.
 */

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export interface FrontmatterParsed {
  data: Record<string, any>;
  content: string;
}

const FENCE = "---";
const BOM = /^\uFEFF/;

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

/**
 * Parse a Markdown string with optional YAML frontmatter.
 * Mirrors `gray-matter(raw)` — returns `{ data, content }`.
 */
export function parseFrontmatter(raw: string): FrontmatterParsed {
  const text = (raw ?? "").replace(BOM, "");
  if (!text.startsWith(FENCE)) {
    return { data: {}, content: text };
  }

  // The opening fence must be on its own line followed by an EOL.
  const afterOpenIdx = FENCE.length;
  const openTerm = text.charCodeAt(afterOpenIdx);
  if (openTerm !== 0x0A /*\n*/ && openTerm !== 0x0D /*\r*/ && afterOpenIdx !== text.length) {
    // Not a proper fence (e.g. "---foo"); treat as plain content.
    return { data: {}, content: text };
  }

  // Find the next "\n---\n" (or "\n---\r\n", or "\n---" at EOF) closing fence.
  // We scan line-by-line so we handle CRLF and EOF-as-fence correctly.
  let cursor = afterOpenIdx;
  if (text[cursor] === "\r") cursor++;
  if (text[cursor] === "\n") cursor++;
  const startBody = cursor;

  let closeStart = -1;
  let closeEnd = -1;
  while (cursor < text.length) {
    const lineEnd = text.indexOf("\n", cursor);
    const lineEndIdx = lineEnd === -1 ? text.length : lineEnd;
    const lineCore = text.charCodeAt(lineEndIdx - 1) === 0x0D /*\r*/
      ? text.slice(cursor, lineEndIdx - 1)
      : text.slice(cursor, lineEndIdx);
    if (lineCore === FENCE) {
      closeStart = cursor;
      closeEnd = lineEnd === -1 ? text.length : lineEnd + 1;
      break;
    }
    if (lineEnd === -1) break;
    cursor = lineEnd + 1;
  }

  if (closeStart < 0) {
    // No closing fence — gray-matter treats this as no frontmatter.
    return { data: {}, content: text };
  }

  // Slice from start of body to (just before) the line terminator that
  // immediately precedes the closing fence. We then normalize CRLF → LF so
  // YAML scalar values don't accidentally include trailing `\r` characters.
  const trailingCR = text.charCodeAt(closeStart - 1) === 0x0D ? 1 : 0;
  const trailingLF = closeStart > startBody && text.charCodeAt(closeStart - 1 - trailingCR) === 0x0A ? 0 : 1;
  // (closeStart points at the `-` of the closing fence; the byte at
  // closeStart-1 is the LF that ended the previous line, possibly preceded
  // by a CR for CRLF inputs.)
  const yamlEnd = Math.max(startBody, closeStart - trailingCR - trailingLF);
  const yamlBlockRaw = text.slice(startBody, yamlEnd);
  const yamlBlock = yamlBlockRaw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // yamlBlock may be empty (frontmatter present but no keys), which
  // yaml.parse handles as null → coerce to {}.
  let data: Record<string, any> = {};
  try {
    const parsed = yamlParse(yamlBlock, { prettyErrors: false });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, any>;
    }
  } catch {
    // Malformed YAML → fall back to no-op (gray-matter throws but our callers
    // historically tolerate parse failures by re-trying or skipping the file).
    data = {};
  }

  const content = text.slice(closeEnd);
  return { data, content };
}

/**
 * Serialize body + frontmatter back to a string with `---` fences.
 * Mirrors `gray-matter.stringify(body, data)`.
 */
export function stringifyFrontmatter(body: string, data: Record<string, any> | null | undefined): string {
  const fm = data && typeof data === "object" ? data : {};
  let yamlBlock: string;
  try {
    yamlBlock = yamlStringify(fm, {
      lineWidth: 0,        // never wrap (matches gray-matter)
      defaultStringType: "PLAIN",
      defaultKeyType: "PLAIN",
    });
  } catch {
    yamlBlock = "";
  }
  // `yaml.stringify({})` returns "{}\n" (flow style for empty map). Normalize.
  if (yamlBlock.trim() === "{}") yamlBlock = "";
  if (yamlBlock.length > 0) yamlBlock = ensureTrailingNewline(yamlBlock);

  const bodyOut = body == null ? "" : ensureTrailingNewline(body.replace(BOM, ""));
  return `${FENCE}\n${yamlBlock}${FENCE}\n${bodyOut}`;
}

/**
 * Default export — gray-matter compatibility shim.
 *
 * Usage:
 *   import matter from "./yaml_frontmatter";
 *   const { data, content } = matter(raw);
 *   const out = matter.stringify(body, data);
 */
function matter(raw: string): FrontmatterParsed {
  return parseFrontmatter(raw);
}
matter.stringify = stringifyFrontmatter;

export default matter;
