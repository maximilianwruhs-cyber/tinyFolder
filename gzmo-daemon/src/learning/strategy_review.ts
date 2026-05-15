/**
 * Human-visible REVIEW envelopes for strategy ledger entries.
 */

import { join } from "path";
import { mkdir } from "fs/promises";
import { write } from "bun";
import { readBoolEnv } from "../pipelines/helpers";
import type { StrategyEntry } from "./ledger";

export function strategyReviewsEnabled(): boolean {
  return readBoolEnv("GZMO_ENABLE_STRATEGY_REVIEWS", false);
}

export async function writeStrategyReview(vaultPath: string, entry: StrategyEntry): Promise<string | null> {
  if (!strategyReviewsEnabled()) return null;

  const reviewsDir = join(vaultPath, "GZMO", "Reviews");
  await mkdir(reviewsDir, { recursive: true });

  const fileName = `review_${entry.entry_id.slice(0, 8)}_${Date.now()}.md`;
  const filePath = join(reviewsDir, fileName);

  const body = [
    "## Proposed Strategy Update",
    "",
    `**Task type:** ${entry.task_type}`,
    `**Decomposition:** ${entry.decomposition_style}`,
    `**Success:** ${entry.ok} (z=${entry.z_score.toFixed(2)}, citations=${entry.citation_rate.toFixed(2)})`,
    `**Model:** ${entry.model}`,
    `**Duration:** ${entry.total_ms}ms`,
    "",
    "> To approve: change `status: approved`",
    "> To reject: change `status: rejected`",
    "",
    "### Raw telemetry",
    "```json",
    JSON.stringify(entry, null, 2),
    "```",
  ].join("\n");

  const content = [
    "---",
    "status: pending_human_review",
    "type: REVIEW",
    "envelope_state: UNRESOLVED",
    `entry_id: ${entry.entry_id}`,
    `created_at: ${entry.timestamp}`,
    "---",
    "",
    body,
    "",
  ].join("\n");

  await write(filePath, content);
  return filePath;
}
