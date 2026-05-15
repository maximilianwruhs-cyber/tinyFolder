/**
 * Boot-time REPORT envelope (passive telemetry for Obsidian).
 */

import { join } from "path";
import { mkdir } from "fs/promises";
import { write } from "bun";
import { readBoolEnv } from "./pipelines/helpers";
import { loadTrustState, trustLedgerEnabled } from "./learning/trust_ledger";
import { loadLedger, learningEnabled } from "./learning/ledger";
import { runSparkSelfCheckAsync, selfHelpPath } from "./spark_self_help";
import { existsSync } from "fs";
import {
  readAutoInboxFromDreams,
  readAutoInboxFromSelfAsk,
  readAutoInboxFromWikiRepair,
  maxAutoTasksPerHourDefault,
} from "./pipelines/helpers";

export function bootReportEnabled(): boolean {
  return readBoolEnv("GZMO_ENABLE_BOOT_REPORT", true);
}

export async function writeBootReport(vaultPath: string, extras?: Record<string, string>): Promise<void> {
  if (!bootReportEnabled()) return;

  const reportsDir = join(vaultPath, "GZMO", "Reports");
  await mkdir(reportsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(reportsDir, `boot_report_${ts}.md`);

  let trustBlock = "_Trust ledger disabled._";
  if (trustLedgerEnabled()) {
    const t = await loadTrustState(vaultPath);
    trustBlock = `score=${t.score.toFixed(2)} interactions=${t.interactions} unbound_streak=${t.unboundStreak}`;
  }

  let ledgerBlock = "_Learning ledger disabled._";
  if (learningEnabled()) {
    const entries = await loadLedger(vaultPath, 50);
    ledgerBlock = `${entries.length} recent strategy entries`;
  }

  const lines = [
    "---",
    "status: informational",
    "type: REPORT",
    "envelope_state: RESOLVED",
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
    "## GZMO Boot Report",
    "",
    `- **Trust:** ${trustBlock}`,
    `- **Strategy ledger:** ${ledgerBlock}`,
    `- **Profile:** ${process.env.GZMO_PROFILE ?? "core"}`,
    `- **Model:** ${process.env.OLLAMA_MODEL ?? "?"}`,
    "",
    "**Auto-inbox gates** (effective after env defaults):",
    "",
    `- wiki repair → Inbox: **${readAutoInboxFromWikiRepair() ? "on" : "off"}** (\`GZMO_AUTO_INBOX_FROM_WIKI_REPAIR\`)`,
    `- self-ask → Inbox: **${readAutoInboxFromSelfAsk() ? "on" : "off"}** (\`GZMO_AUTO_INBOX_FROM_SELF_ASK\`)`,
    `- dreams → Inbox: **${readAutoInboxFromDreams() ? "on" : "off"}** (\`GZMO_AUTO_INBOX_FROM_DREAMS\`)`,
    `- default auto-task cap/hour (if \`GZMO_AUTO_TASKS_PER_HOUR\` unset): **${maxAutoTasksPerHourDefault()}**`,
    "",
  ];

  if (extras) {
    lines.push("### Runtime", "");
    for (const [k, v] of Object.entries(extras)) {
      lines.push(`- **${k}:** ${v}`);
    }
    lines.push("");
  }

  await write(filePath, lines.join("\n"));
  console.log(`[GZMO] Boot report: ${filePath}`);

  runSparkSelfCheckAsync();
  const help = selfHelpPath(vaultPath);
  if (existsSync(help)) {
    console.log(`[GZMO] Self-help (agents): ${help}`);
  }
}
