import { join } from "path";
import { promises as fsp } from "fs";
import { safeWriteText } from "./vault_fs";
import { scoreSelfAskOutput } from "./self_ask_quality";

async function safeRead(fileAbs: string): Promise<string> {
  try {
    return await Bun.file(fileAbs).text();
  } catch {
    return "";
  }
}

function extractQualityScore(raw: string): number | null {
  const m = raw.match(/^\s*quality_score:\s*(\d+)\s*$/m);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export async function writeSelfAskQualityReport(params: {
  vaultPath: string;
  lookbackFiles?: number;
}): Promise<void> {
  const cabinetDir = join(params.vaultPath, "GZMO", "Thought_Cabinet");
  const lookback = params.lookbackFiles ?? 80;

  let files: string[] = [];
  try {
    files = (await fsp.readdir(cabinetDir))
      .filter((f) => f.endsWith("_gap_detective.md") || f.endsWith("_spaced_repetition.md") || f.endsWith("_contradiction_scan.md"))
      .sort()
      .reverse()
      .slice(0, lookback);
  } catch {
    files = [];
  }

  const rows: Array<{ file: string; score: number; hasCites: boolean; noConn: boolean; issues: string[] }> = [];
  for (const f of files) {
    const abs = join(cabinetDir, f);
    const raw = await safeRead(abs);
    if (!raw) continue;

    const fmScore = extractQualityScore(raw);
    const body = raw.split("\n---\n").slice(1).join("\n---\n");
    const scored = scoreSelfAskOutput({ output: body, packet: undefined });
    rows.push({
      file: f,
      score: fmScore ?? scored.score,
      hasCites: scored.citations.unique > 0,
      noConn: scored.noConnection,
      issues: scored.issues,
    });
  }

  const avg = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : 0;
  const noConnRate = rows.length ? rows.filter((r) => r.noConn).length / rows.length : 0;
  const citeRate = rows.length ? rows.filter((r) => r.hasCites).length / rows.length : 0;

  const worst = [...rows].sort((a, b) => a.score - b.score).slice(0, 8);

  const md = [
    "---",
    `type: operational_report`,
    `generated_at: ${new Date().toISOString()}`,
    `lookback_files: ${lookback}`,
    "---",
    "",
    "# Self-Ask Quality Report",
    "",
    `- Average score: **${avg.toFixed(0)}/100**`,
    `- Citation rate: **${Math.round(citeRate * 100)}%**`,
    `- No-connection rate: **${Math.round(noConnRate * 100)}%**`,
    "",
    "## Lowest-scoring recent entries",
    "",
    ...worst.map((r) => `- ${r.score}/100 \`${r.file}\`${r.issues.length ? ` — ${r.issues.join("; ")}` : ""}`),
    "",
  ].join("\n");

  await safeWriteText(params.vaultPath, join(params.vaultPath, "GZMO", "self-ask-quality.md"), md);
}

