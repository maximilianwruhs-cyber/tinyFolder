import { join, basename } from "path";
import { readdirSync } from "fs";
import { TaskDocument } from "./src/frontmatter";
import { processTask } from "./src/engine";
import { EmbeddingsQueue } from "./src/embeddings_queue";

class NoopWatcher {
  lockFile(_filePath: string) {}
  unlockFile(_filePath: string) {}
}

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error("VAULT_PATH is required");
    process.exit(2);
  }

  const inboxAbs = join(vaultPath, "GZMO", "Inbox");
  const ollamaApiUrl = process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434";
  const embeddingsPath = join(vaultPath, "GZMO", "embeddings.json");

  // Load embeddings store (required for action: search tasks).
  const embeddings = new EmbeddingsQueue(vaultPath, embeddingsPath, ollamaApiUrl);
  await embeddings.initByFullSync();

  const files = readdirSync(inboxAbs)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => /^PROOF_DEEP__/.test(f))
    .sort();

  if (files.length === 0) {
    console.log("[proof_deep] no PROOF_DEEP tasks found.");
    return;
  }

  const watcher = new NoopWatcher() as any;
  for (const f of files) {
    const abs = join(inboxAbs, f);
    const doc = await TaskDocument.load(abs);
    if (!doc) continue;
    if (String(doc.frontmatter.status ?? "").toLowerCase() !== "pending") continue;

    console.log(`[proof_deep] running ${f}`);
    await processTask(
      {
        filePath: abs,
        fileName: basename(f, ".md"),
        status: doc.status as any,
        body: doc.body,
        frontmatter: doc.frontmatter as any,
        document: doc,
      },
      watcher,
      undefined,
      embeddings.getStore(),
      undefined,
    );
    console.log(`[proof_deep] done ${f}`);
  }

  console.log(`[proof_deep] processed ${files.length} tasks`);
}

main().catch((err) => {
  console.error("[proof_deep] failed:", err?.message ?? err);
  process.exit(1);
});

