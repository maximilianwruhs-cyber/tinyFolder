import type { DoctorFixSuggestion } from "./types";

export interface LegacyRunResult {
  ok: boolean;
  exitCode: number;
  summary: string;
  outputPreview: string;
  fix?: DoctorFixSuggestion[];
}

function preview(s: string, max = 1200) {
  return s.length <= max ? s : s.slice(0, max) + "\n...(truncated)";
}

async function runCmd(cmd: string[], signal: AbortSignal): Promise<{ exitCode: number; out: string }> {
  const p = Bun.spawn({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const [outBuf, errBuf] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  return { exitCode: code, out: (outBuf + (errBuf ? `\n${errBuf}` : "")).trim() };
}

export async function runLegacy(params: {
  kind: "unit" | "pipeline" | "nightshift" | "stress" | "all";
  cwd: string;
  env: Record<string, string>;
  readonly: boolean;
  signal: AbortSignal;
}): Promise<Record<string, LegacyRunResult>> {
  const results: Record<string, LegacyRunResult> = {};
  const plan: Array<{ id: string; cmd: string[]; writes: boolean }> = [];

  const add = (id: string, cmd: string[], writes: boolean) => plan.push({ id, cmd, writes });

  if (params.kind === "unit" || params.kind === "all") add("unit", ["bun", "test"], false);
  if (params.kind === "pipeline" || params.kind === "all") add("pipeline", ["bun", "run", "test_full_pipeline.ts"], true);
  if (params.kind === "nightshift" || params.kind === "all") add("nightshift", ["bun", "run", "test_nightshift.ts"], true);
  if (params.kind === "stress" || params.kind === "all") add("stress", ["bun", "run", "test_hermes3_stress.ts"], true);

  for (const item of plan) {
    if (item.writes && params.readonly) {
      results[item.id] = {
        ok: false,
        exitCode: 0,
        summary: "Skipped (requires --write)",
        outputPreview: "",
        fix: [
          {
            id: `legacy.${item.id}.requires_write`,
            title: `Run legacy test '${item.id}' with write enabled`,
            severity: "warn",
            rationale: "This legacy script writes into the vault (Inbox/Thought_Cabinet/wiki reports).",
            commands: [`bun run doctor --write --run-legacy ${item.id}`],
          },
        ],
      };
      continue;
    }

    const { exitCode, out } = await runCmd(item.cmd, params.signal);
    results[item.id] = {
      ok: exitCode === 0,
      exitCode,
      summary: exitCode === 0 ? "Completed successfully" : `Failed (exit ${exitCode})`,
      outputPreview: preview(out),
    };
  }

  return results;
}
