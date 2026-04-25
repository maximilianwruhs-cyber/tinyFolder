import { join, resolve } from "path";
import { mkdirSync } from "fs";
import { processTask } from "./src/engine";
import type { TaskEvent, VaultWatcher } from "./src/watcher";
import type { EmbeddingStore } from "./src/embeddings";
import { syncEmbeddings } from "./src/embeddings";

async function ollamaReady(base: string): Promise<boolean> {
  try {
    const resp = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return resp.ok;
  } catch {
    return false;
  }
}

function nowId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(16).slice(2, 8)}`;
}

function makeWatcherStub(): VaultWatcher {
  return {
    lockFile() {},
    unlockFile() {},
  } as any;
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function loadOrBuildEmbeddings(vaultPath: string, ollamaApi: string): Promise<EmbeddingStore> {
  const storeAbs = join(vaultPath, "GZMO", "embeddings.json");
  const f = Bun.file(storeAbs);
  if (await f.exists()) {
    const parsed = await f.json();
    return parsed as EmbeddingStore;
  }
  // Fallback: build embeddings (can be slow on big vaults).
  return await syncEmbeddings(vaultPath, storeAbs, ollamaApi);
}

async function run(): Promise<void> {
  const vaultPath = resolve(process.env.VAULT_PATH ?? join(import.meta.dir, "..", "vault"));
  const inboxPath = join(vaultPath, "GZMO", "Inbox");
  const ollamaApi = (process.env.OLLAMA_URL?.replace("/v1", "") ?? "http://localhost:11434").replace(/\/$/, "");

  console.log(`[PROOF] vaultPath=${vaultPath}`);
  console.log(`[PROOF] inboxPath=${inboxPath}`);
  console.log(`[PROOF] ollamaApi=${ollamaApi}`);
  console.log(`[PROOF] model=${process.env.OLLAMA_MODEL ?? "hermes3:8b"}`);

  assert(await ollamaReady(ollamaApi), "Ollama is not reachable at OLLAMA_URL (expected /api/tags to succeed).");

  mkdirSync(inboxPath, { recursive: true });

  // Ensure the pipeline is ON (proof should reflect the actual smart stack).
  process.env.GZMO_PIPELINE_V2 ??= "on";
  process.env.GZMO_EVIDENCE_PACKET ??= "on";
  process.env.GZMO_ENABLE_SELF_EVAL ??= "on";
  process.env.GZMO_VERIFY_SAFETY ??= "on";

  const embeddings = await loadOrBuildEmbeddings(vaultPath, ollamaApi);
  assert(Array.isArray((embeddings as any)?.chunks), "Embeddings store not loaded (missing chunks).");

  const id = nowId();
  const fileName = `PROOF__search__telemetry__${id}`;
  const filePath = join(inboxPath, `${fileName}.md`);

  const task = [
    "---",
    "status: pending",
    "action: search",
    "title: \"Proof: smartness & finesse\"",
    "---",
    "",
    "Where does the daemon write `TELEMETRY.json` in this vault, and what is it used for?",
    "",
    "Constraints:",
    "- Cite evidence using [E#] snippet IDs.",
    "- If insufficient evidence, say so explicitly.",
  ].join("\n");

  await Bun.write(filePath, task);

  const event: TaskEvent = {
    filePath,
    fileName,
    status: "pending",
    body: "Where does the daemon write `TELEMETRY.json` in this vault, and what is it used for?",
    frontmatter: { status: "pending", action: "search", title: "Proof: smartness & finesse" },
  };

  const watcher = makeWatcherStub();

  await processTask(event, watcher, undefined, embeddings, undefined);

  const out = await Bun.file(filePath).text();

  // Proof checks (objective, text-based):
  const responseIdx = out.indexOf("## GZMO Response");
  assert(responseIdx >= 0, "No '## GZMO Response' section was written.");
  const response = out.slice(responseIdx);

  const saysInsufficient = /\binsufficient evidence\b/i.test(response);
  const hasEvidenceCites = /\[E\d+\]/.test(response);
  const mentionsTelemetry = /TELEMETRY\.json/.test(response);
  const inventedPath = /NOT_REAL\.json/i.test(response);

  assert(!inventedPath, "Safety failure: response contains an invented path marker (NOT_REAL.json).");
  assert(mentionsTelemetry, "Response did not mention TELEMETRY.json at all.");
  assert(saysInsufficient || hasEvidenceCites, "Response lacked evidence citations [E#] and did not declare insufficient evidence.");

  const keep = String(process.env.GZMO_PROOF_KEEP_TASK ?? "").toLowerCase() === "on";
  if (!keep) {
    // Delete the proof task to avoid polluting the vault.
    await Bun.spawn(["rm", "-f", filePath]).exited;
  }

  console.log("[PROOF] ✅ PASS");
  console.log(`[PROOF] kept_task=${keep ? "yes" : "no"}`);
  console.log(`[PROOF] task_file=${filePath}`);
}

run().catch((err) => {
  console.error("[PROOF] ❌ FAIL");
  console.error(String((err as any)?.stack ?? err));
  process.exit(1);
});

