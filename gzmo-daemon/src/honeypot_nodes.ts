import { safeWriteText } from "./vault_fs";

export type HoneypotNodeStatus = "draft" | "compiled" | "verified" | "executable";

export interface HoneypotNode {
  type: "honeypot_node";
  layer: number; // 1..N (Layer3+ in spec; layer=1 can be first promoted)
  title: string; // Obsidian wikilink target
  slug: string; // filename stem
  created_at: string; // ISO
  last_updated: string; // ISO
  confidence: number; // 0..1
  status: HoneypotNodeStatus;
  tags: string[];
  summary: string;
  distilled_claims: string[];
  invariants: string[];
  contradictions: string[];
  sources: string[];
  primary_links: string[];
  context_links: string[];
  child_nodes: string[]; // slugs or titles
  child_edges: string[]; // edge ids if used later
}

// Store promoted honeypots in the wiki (Intermediate Honeypots layer).
export const HONEYPOT_NODES_DIR = "wiki/honeypots";

export function slugifyTitle(title: string): string {
  return String(title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\[\]]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function mdLink(title: string): string {
  const t = String(title ?? "").trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  return `[[${t}]]`;
}

export function renderHoneypotNodeMarkdown(node: HoneypotNode): string {
  const linksPrimary = [...new Set(node.primary_links)].filter(Boolean).map(mdLink);
  const linksContext = [...new Set(node.context_links)].filter(Boolean).map(mdLink);
  const linksChildren = [...new Set(node.child_nodes)].filter(Boolean).map(mdLink);
  const createdDate = String(node.created_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const updatedDate = String(node.last_updated ?? "").slice(0, 10) || createdDate;

  const fm = [
    "---",
    `title: "${node.title.replace(/"/g, '\\"')}"`,
    `type: honeypot_node`,
    `layer: ${node.layer}`,
    `status: ${node.status}`,
    `sources: ${(node.sources ?? []).length}`,
    `created: ${createdDate}`,
    `updated: ${updatedDate}`,
    `created_at: ${node.created_at}`,
    `last_updated: ${node.last_updated}`,
    `confidence: ${Number.isFinite(node.confidence) ? node.confidence.toFixed(2) : "0.50"}`,
    `tags: [${(node.tags ?? []).map((t) => String(t).replace(/[\[\],]/g, "").trim()).filter(Boolean).join(", ")}]`,
    "---",
  ].join("\n");

  const section = (h: string, body: string[]) => [
    `## ${h}`,
    "",
    ...(body.length ? body : ["(empty)"]),
    "",
  ].join("\n");

  return [
    fm,
    "",
    `# ${mdLink(node.title)}`,
    "",
    section("Summary", [String(node.summary ?? "").trim() || "(empty)"]),
    section("Distilled Claims", (node.distilled_claims ?? []).filter(Boolean).map((c) => `- ${c}`)),
    section("Invariants", (node.invariants ?? []).filter(Boolean).map((c) => `- ${c}`)),
    section("Contradictions & Uncertainties", (node.contradictions ?? []).filter(Boolean).map((c) => `- ${c}`)),
    section("Sources & Traceability", (node.sources ?? []).filter(Boolean).map((s) => `- ${s}`)),
    section("Connection Points", [
      "### PrimaryLinks",
      ...(linksPrimary.length ? linksPrimary.map((l) => `- ${l}`) : ["- (none)"]),
      "",
      "### ContextLinks",
      ...(linksContext.length ? linksContext.map((l) => `- ${l}`) : ["- (none)"]),
      "",
      "### Children",
      ...(linksChildren.length ? linksChildren.map((l) => `- ${l}`) : ["- (none)"]),
    ]),
  ].join("\n");
}

export async function writeHoneypotNode(vaultPath: string, node: HoneypotNode): Promise<string> {
  const file = `${node.slug}.md`;
  const rel = `${HONEYPOT_NODES_DIR}/layer-${node.layer}/${file}`;
  await safeWriteText(vaultPath, rel, renderHoneypotNodeMarkdown(node));
  return rel;
}

