import { join } from "path";
import { safeWriteText } from "./src/vault_fs";
import { latencyPack, deepPack, type ProofTaskSpec } from "./proof_packs";

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderTask(spec: ProofTaskSpec): string {
  const fm = [
    "---",
    "status: pending",
    `action: ${spec.action}`,
    `title: "${spec.title}"`,
    `created_at: "${new Date().toISOString()}"`,
    "auto: false",
    "source_subsystem: operator",
    "priority: high",
    "---",
    "",
  ].join("\n");
  return fm + spec.body.trim() + "\n";
}

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error("VAULT_PATH is required.");
    process.exit(2);
  }
  const pack = (process.env.PROOF_PACK ?? "latency").toLowerCase();
  const date = isoDate();
  const specs = pack === "deep" ? deepPack(date) : latencyPack(date);

  const inbox = join(vaultPath, "GZMO", "Inbox");
  for (const s of specs) {
    const abs = join(inbox, s.fileName);
    await safeWriteText(vaultPath, abs, renderTask(s));
    console.log(`[proof_pack] wrote ${abs}`);
  }
  console.log(`[proof_pack] done pack=${pack} n=${specs.length}`);
}

main();

