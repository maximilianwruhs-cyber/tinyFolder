import { join } from "path";
import { promises as fsp } from "fs";
import { atomicWriteText } from "./vault_fs";

export interface CoreWisdomRouting {
  coreWisdomVersion: number;
  entrypoints: Record<string, string>;
  pipelines?: any;
  constraints?: any;
}

const CORE_WISDOM_PATH = "wiki/overview.md";

function extractYamlFence(markdown: string): string | null {
  // Match a fenced YAML block like:
  // ```yaml
  // key: value
  // ```
  const m = markdown.match(/```yaml\s*([\s\S]*?)\s*```/);
  return m?.[1]?.trim() ?? null;
}

// Minimal YAML parser for the small, predictable routing block.
// Supports: key: value, nested maps (indent=2), numbers, booleans, strings.
export function parseCoreWisdomRouting(markdown: string): CoreWisdomRouting | null {
  const yaml = extractYamlFence(markdown);
  if (!yaml) return null;

  const root: any = {};
  const stack: Array<{ indent: number; obj: any }> = [{ indent: -1, obj: root }];

  const lines = yaml.split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
    const m = line.trim().match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let valRaw = m[2] ?? "";

    while (stack.length && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!.obj;

    if (valRaw === "" || valRaw === null) {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] });
      continue;
    }

    let v: any = valRaw.trim();
    if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (/^-?\d+$/.test(v)) v = Number.parseInt(v, 10);
    else if (/^-?\d+\.\d+$/.test(v)) v = Number.parseFloat(v);
    else v = v.replace(/^\"|\"$/g, "");

    parent[key] = v;
  }

  if (typeof root.coreWisdomVersion !== "number") return null;
  if (!root.entrypoints || typeof root.entrypoints !== "object") return null;
  return root as CoreWisdomRouting;
}

export async function readCoreWisdomRouting(vaultPath: string): Promise<CoreWisdomRouting | null> {
  try {
    const md = await Bun.file(join(vaultPath, CORE_WISDOM_PATH)).text();
    return parseCoreWisdomRouting(md);
  } catch {
    return null;
  }
}

async function listHoneypotNodes(vaultPath: string): Promise<string[]> {
  const root = join(vaultPath, "wiki", "honeypots");
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: any[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
    }
  }
  out.sort();
  return out;
}

function keepShort(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), `- *(+${lines.length - (maxLines - 1)} more)*`];
}

export async function compileCoreWisdom(vaultPath: string, note?: string): Promise<void> {
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);

  // Read current file to preserve routing block verbatim if present.
  let current = "";
  try { current = await Bun.file(join(vaultPath, CORE_WISDOM_PATH)).text(); } catch {}
  const routingYaml = extractYamlFence(current);

  const nodes = await listHoneypotNodes(vaultPath);
  const nodeLinks = nodes.map((p) => `- [[${p.split("/").pop()!.replace(/\\.md$/, "")}]]`);

  const fm = [
    "---",
    `title: "Core Wisdom"`,
    "type: executable_wisdom",
    "role: wisdom",
    "retrieval_priority: highest",
    "tags: [executable, wisdom, honeypot, governance]",
    "sources: 0",
    `created: ${isoDate}`,
    `updated: ${isoDate}`,
    "---",
    "",
  ].join("\\n");

  const yamlBlock = routingYaml
    ? ["```yaml", routingYaml, "```", ""].join("\\n")
    : [
      "```yaml",
      "coreWisdomVersion: 1",
      "entrypoints:",
      "  coreWisdom: wiki/overview.md",
      "  masterIndex: wiki/00_MASTER_INDEX.md",
      "  wikiIndex: wiki/index.md",
      "  cortex: docs/core_identity/CORTEX.md",
      "  soul: docs/core_identity/SOUL.md",
      "pipelines:",
      "  edgeIngest:",
      "    edgesJsonl: GZMO/Thought_Cabinet/honeypots/edges.jsonl",
      "    promoteBudget: 2",
      "    windowHours: 24",
      "  promotionTargets:",
      "    honeypotsRoot: wiki/honeypots",
      "constraints:",
      "  noDirectIdentityEdits: true",
      "  proposeViaDreams: wiki/dreams/",
      "```",
      "",
    ].join("\\n");

  const body = [
    "# Core Wisdom (Last Honeypot)",
    "",
    yamlBlock,
    note ? `**Update note**: ${note}` : "",
    note ? "" : "",
    "## Promoted Honeypots (traceability substrate)",
    "",
    ...(nodeLinks.length ? keepShort(nodeLinks, 40) : ["- *(none yet)*"]),
    "",
    "## Invariants",
    "",
    "- Keep this file short. Put details into honeypot nodes + canonical wiki pages.",
    "- Sovereignty: identity contracts under `docs/core_identity/` are user-owned; propose via `wiki/dreams/`.",
    "- Safety: fail-closed; no invented evidence; explicit confirmation for destructive/sensitive actions.",
    "",
  ].join("\\n");

  await atomicWriteText(vaultPath, join(vaultPath, CORE_WISDOM_PATH), fm + body);
}

