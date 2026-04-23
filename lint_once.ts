import { runWikiLint } from "./src/wiki_lint";
import { resolve } from "path";

const vaultPath = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : "";
if (!vaultPath) {
  console.error("VAULT_PATH is required. Example: VAULT_PATH=../vault bun run lint:once");
  process.exit(2);
}

const staleDays = Number.parseInt(process.env.WIKI_LINT_STALE_DAYS ?? "30", 10);
const sd = Number.isFinite(staleDays) ? staleDays : 30;
console.log(`[lint:once] vaultPath=${vaultPath}`);
console.log(`[lint:once] staleDays=${sd}`);
console.log(`[lint:once] autofix=${process.env.WIKI_LINT_AUTOFIX === "1" ? "enabled" : "disabled"}`);

try {
  const report = await runWikiLint(vaultPath, { staleDays: sd });
  console.log(`[lint:once] done: findings=${report.findings.length}`);
} catch (err: any) {
  console.error(`[lint:once] failed: ${err?.message ?? String(err)}`);
  process.exit(1);
}

