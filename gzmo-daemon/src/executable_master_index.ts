import { promises as fsp } from "fs";
import { join, basename, extname } from "path";
import { atomicWriteText } from "./vault_fs";

const MASTER_INDEX_PATH = "wiki/00_MASTER_INDEX.md";
const HONEYPOT_ROOT = "wiki/honeypots";

async function listHoneypotNodes(vaultPath: string): Promise<Array<{ fileBase: string; rel: string }>> {
  const root = join(vaultPath, HONEYPOT_ROOT);
  const out: Array<{ fileBase: string; rel: string }> = [];
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
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push({
          fileBase: basename(full, extname(full)),
          rel: full.replace(vaultPath + "/", ""),
        });
      }
    }
  }
  out.sort((a, b) => a.fileBase.localeCompare(b.fileBase));
  return out;
}

export async function updateExecutableMasterIndex(vaultPath: string, params?: { note?: string }): Promise<void> {
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const nodes = await listHoneypotNodes(vaultPath);

  const fm = [
    "---",
    `title: "Executable Master Index"`,
    "type: executable_index",
    "role: wisdom",
    "retrieval_priority: highest",
    "tags: [executable, honeypot, index]",
    "sources: 0",
    `created: ${isoDate}`,
    `updated: ${isoDate}`,
    "---",
    "",
  ].join("\n");

  const body = [
    "# Executable Master Index",
    "",
    "This is the **last-honeypot entrypoint**. Queries should route here first:",
    "- select 5–10 relevant honeypot nodes",
    "- read `Summary` + `Invariants`",
    "- answer",
    "- file back improvements",
    "",
    params?.note ? `**Update note**: ${params.note}` : "",
    params?.note ? "" : "",
    "## Topological Taxonomy",
    "",
    "- (curate) Add 5–20 thematic pots here as the system matures.",
    "",
    "## Intermediate Honeypots (Promoted Nodes)",
    "",
    nodes.length
      ? nodes.map((n) => `- [[${n.fileBase}]]`).join("\n")
      : "- *(none yet — waiting for promotion)*",
    "",
    "## Cross-Domain Intersections",
    "",
    "- (curate) Add explicit bridges between thematic pots.",
    "",
    "## System Health",
    "",
    "- (auto) broken links: see `wiki-lint-report.md` under `vault/GZMO/`",
    "- (auto) promotion digest: `GZMO/.gzmo_honeypot_digest.json`",
    "",
  ].join("\n");

  await atomicWriteText(vaultPath, join(vaultPath, MASTER_INDEX_PATH), fm + body);
}

