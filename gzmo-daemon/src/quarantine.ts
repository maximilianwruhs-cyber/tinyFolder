import { join } from "path";
import { safeWriteText } from "./vault_fs";
import { createAutoInboxTasks, type AutoTaskSpec } from "./auto_tasks";

export type QuarantineReason =
  | "wiki_missing_evidence"
  | "wiki_missing_next_actions"
  | "wiki_generic_next_actions"
  | "wiki_unsupported_external_evidence"
  | "wiki_too_short"
  | "dream_quality_rejected"
  | "other";

export async function quarantineArtifact(params: {
  vaultPath: string;
  kind: "wiki" | "dream";
  sourceId: string; // e.g. cabinet file or task id
  reason: QuarantineReason;
  details: string;
  rawMarkdown: string;
}): Promise<string> {
  const dir = join(params.vaultPath, "GZMO", "Quarantine");
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "-");
  const file = `${dateStr}_${timeStr}__${params.kind}__${params.reason}.md`;
  const abs = join(dir, file);

  const content = [
    "---",
    `date: ${dateStr}`,
    `time: "${now.toISOString().slice(11, 19)}"`,
    `kind: ${params.kind}`,
    `reason: ${params.reason}`,
    `source_id: "${params.sourceId.replace(/\"/g, '\\"')}"`,
    "tags: [quarantine, quality]",
    "---",
    "",
    `# Quarantine: ${params.kind} (${params.reason})`,
    "",
    "## Details",
    "",
    params.details.trim() || "(none)",
    "",
    "## Raw output",
    "",
    "```",
    params.rawMarkdown.trim(),
    "```",
    "",
  ].join("\n");

  await safeWriteText(params.vaultPath, abs, content);
  return abs;
}

export async function createRepairTask(params: {
  vaultPath: string;
  title: string;
  reason: QuarantineReason;
  quarantineFile: string; // basename
  suggestion: string;
}): Promise<void> {
  const tasks: AutoTaskSpec[] = [{
    type: "maintenance",
    title: params.title,
    body: [
      `Reason: ${params.reason}`,
      `Quarantine: \`GZMO/Quarantine/${params.quarantineFile}\``,
      "",
      "Instruction:",
      params.suggestion.trim(),
    ].join("\n"),
    source: { subsystem: "wiki", sourceFile: params.quarantineFile },
  }];
  await createAutoInboxTasks({ vaultPath: params.vaultPath, tasks });
}

export function assessWikiDraft(raw: string): { ok: boolean; reason?: QuarantineReason; details?: string } {
  const unsupportedExternalEvidence = [
    /\buser_interaction_logs?[_-]/i,
    /\bsearch_results\.csv\b/i,
    /\bthird[- ]party apps?\b/i,
    /\bcloud data backups?\b/i,
    /\bSpacedRepetition\.log\b/i,
    /\bdatabase entries?\b/i,
  ];
  if (unsupportedExternalEvidence.some((pattern) => pattern.test(raw))) {
    return {
      ok: false,
      reason: "wiki_unsupported_external_evidence",
      details: "Draft references external evidence sources that were not present in the supplied cabinet entries.",
    };
  }

  const hasEvidence = /##\s*Evidence\b/i.test(raw) && /- .+\(Entry\s+\d+:/i.test(raw);
  if (!hasEvidence) {
    return { ok: false, reason: "wiki_missing_evidence", details: "Missing Evidence section with per-entry citations." };
  }
  const hasNext = /##\s*Next actions\b/i.test(raw) && /- /m.test(raw);
  if (!hasNext) {
    return { ok: false, reason: "wiki_missing_next_actions", details: "Missing Next actions section or bullets." };
  }
  const nextActionsSection = raw.match(/##\s*Next actions\s+([\s\S]*?)(?:\n## |\n---|$)/i)?.[1] ?? "";
  const genericNextAction = [
    /\bif this result is actionable\b/i,
    /\bconvert (it|this) into a concrete inbox task\b/i,
    /\bNo connection found\b/i,
    /\bNo Information\b/i,
    /\btighten query scope\b/i,
    /\bimprove source coverage\b/i,
  ];
  if (genericNextAction.some((pattern) => pattern.test(nextActionsSection))) {
    return {
      ok: false,
      reason: "wiki_generic_next_actions",
      details: "Next actions are generic loop-control instructions rather than concrete grounded follow-ups.",
    };
  }

  if (raw.trim().length < 200) {
    return { ok: false, reason: "wiki_too_short", details: "Draft too short to be useful." };
  }
  return { ok: true };
}

