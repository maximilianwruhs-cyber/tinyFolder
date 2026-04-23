import { join } from "path";
import { safeWriteText } from "../vault_fs";
import type { DoctorReport, DoctorStepResult } from "./types";

function mdEscape(s: string) {
  return s.replace(/\|/g, "\\|");
}

export function summarizeCounts(steps: DoctorStepResult[]) {
  const out = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 } as Record<DoctorStepResult["status"], number>;
  for (const s of steps) out[s.status] = (out[s.status] ?? 0) + 1;
  return out;
}

export function reportToMarkdown(r: DoctorReport): string {
  const counts = summarizeCounts(r.steps);
  const lines: string[] = [];
  lines.push("# GZMO Doctor Report", "");
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push(`- Profile: ${r.profile}`);
  lines.push(`- Mode: ${r.readonly ? "readonly" : "write"}`);
  lines.push(`- Summary: PASS=${counts.PASS} WARN=${counts.WARN} FAIL=${counts.FAIL} SKIP=${counts.SKIP}`, "");

  lines.push("## Environment", "");
  lines.push(`- Vault: \`${r.env.vaultPath}\``);
  lines.push(`- Inbox: \`${r.env.inboxPath}\``);
  lines.push(`- Ollama v1: \`${r.env.ollamaUrlV1 ?? "unknown"}\``);
  lines.push(`- Model: \`${r.env.model ?? "unknown"}\``, "");

  lines.push("## Steps", "");
  lines.push("| Status | Step | Duration | Summary |");
  lines.push("|--------|------|----------|---------|");
  for (const s of r.steps) {
    const dur = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : "";
    lines.push(`| ${s.status} | ${mdEscape(s.title)} | ${dur} | ${mdEscape(s.summary ?? "")} |`);
  }
  lines.push("");

  const fixes = r.steps.flatMap(s => s.fix ?? []);
  if (fixes.length) {
    lines.push("## Suggested fixes (not applied)", "");
    for (const f of fixes) {
      lines.push(`### ${f.title}`, "");
      lines.push(`- Severity: **${f.severity}**`);
      if (f.rationale) lines.push(`- Rationale: ${f.rationale}`);
      if (f.commands?.length) {
        lines.push("", "Commands:", "");
        lines.push("```bash");
        for (const c of f.commands) lines.push(c);
        lines.push("```", "");
      }
      if (f.fileEdits?.length) {
        lines.push("- Proposed file edits:");
        for (const e of f.fileEdits) lines.push(`  - \`${e.path}\`: ${e.description}`);
        lines.push("");
      }
    }
  }

  lines.push("## Step details", "");
  for (const s of r.steps) {
    lines.push(`### ${s.status} — ${s.title}`, "");
    if (s.summary) lines.push(`- Summary: ${s.summary}`);
    if (s.details) lines.push("", "```", s.details, "```", "");
    if (s.evidencePaths?.length) {
      lines.push("- Evidence:");
      for (const p of s.evidencePaths) lines.push(`  - \`${p}\``);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export async function writeDoctorReports(params: {
  report: DoctorReport;
  markdown: string;
  json: string;
  readonly: boolean;
  writeToVault: boolean;
  vaultPath: string;
  repoRoot: string;
}): Promise<{ mdPath: string; jsonPath: string }> {
  if (params.writeToVault) {
    const mdPath = join(params.vaultPath, "GZMO", "doctor-report.md");
    const jsonPath = join(params.vaultPath, "GZMO", "doctor-report.json");
    await safeWriteText(params.vaultPath, mdPath, params.markdown);
    await safeWriteText(params.vaultPath, jsonPath, params.json);
    return { mdPath, jsonPath };
  }

  const mdPath = join(params.repoRoot, "gzmo", "doctor-report.md");
  const jsonPath = join(params.repoRoot, "gzmo", "doctor-report.json");
  await Bun.write(mdPath, params.markdown);
  await Bun.write(jsonPath, params.json);
  return { mdPath, jsonPath };
}

