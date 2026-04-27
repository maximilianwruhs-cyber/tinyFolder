import { join } from "path";
import type { EmbeddingStore } from "./embeddings";
import { extractAnchors } from "./anchors";
import { safeWriteText, atomicWriteJson } from "./vault_fs";

export interface AnchorIndex {
  generatedAt: string;
  totalAnchors: number;
  anchors: Array<{ anchor: string; count: number; files: string[] }>;
}

export function buildAnchorIndex(store: EmbeddingStore): AnchorIndex {
  const byAnchor = new Map<string, { anchor: string; count: number; files: Set<string> }>();

  for (const c of store.chunks) {
    const anchors = extractAnchors({ file: c.file, heading: c.heading, text: c.text, maxAnchors: 25 });
    for (const a of anchors) {
      const k = a.toLowerCase();
      const rec = byAnchor.get(k) ?? { anchor: a, count: 0, files: new Set<string>() };
      rec.count += 1;
      rec.files.add(c.file);
      byAnchor.set(k, rec);
    }
  }

  const anchors = [...byAnchor.values()]
    .map((r) => ({ anchor: r.anchor, count: r.count, files: [...r.files].slice(0, 12) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 400);

  return {
    generatedAt: new Date().toISOString(),
    totalAnchors: anchors.length,
    anchors,
  };
}

export async function writeAnchorArtifacts(params: {
  vaultPath: string;
  store: EmbeddingStore;
}): Promise<void> {
  const idx = buildAnchorIndex(params.store);

  const jsonPath = join(params.vaultPath, "GZMO", "anchor-index.json");
  const mdPath = join(params.vaultPath, "GZMO", "anchor-report.md");

  await atomicWriteJson(params.vaultPath, jsonPath, idx, 2);

  const top = idx.anchors.slice(0, 40);
  const md = [
    "---",
    "type: operational_report",
    `generated_at: ${idx.generatedAt}`,
    "---",
    "",
    "# Anchor Report",
    "",
    `Total anchors tracked: **${idx.totalAnchors}**`,
    "",
    "## Top anchors (by chunk frequency)",
    "",
    ...top.map((a) => `- **${a.count}×** \`${a.anchor}\` — files: ${a.files.slice(0, 4).map((f) => `\`${f}\``).join(", ")}${a.files.length > 4 ? ", …" : ""}`),
    "",
    "## Notes",
    "- High-frequency anchors that appear across multiple files make Self-Ask connections more likely and more grounded.",
    "- If most anchors occur only once, the vault likely lacks shared identifiers (connection scarcity is expected).",
    "",
  ].join("\n");

  await safeWriteText(params.vaultPath, mdPath, md);
}

