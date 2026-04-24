import type { DoctorStepResult, StepStatus } from "./types";

export interface StepContext {
  readonly: boolean;
  timeoutMs: number;
}

export function msSince(t0: number) {
  return Date.now() - t0;
}

export async function runStep(
  ctx: StepContext,
  spec: {
    id: string;
    title: string;
    timeoutMs?: number;
    run: (signal: AbortSignal) => Promise<Omit<DoctorStepResult, "id" | "title" | "durationMs">>;
  },
): Promise<DoctorStepResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = spec.timeoutMs ?? ctx.timeoutMs;
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeout}ms`)), timeout);
  try {
    const partial = await spec.run(controller.signal);
    const durationMs = msSince(t0);
    return {
      id: spec.id,
      title: spec.title,
      durationMs,
      status: partial.status,
      summary: partial.summary,
      details: partial.details,
      evidencePaths: partial.evidencePaths,
      fix: partial.fix,
    };
  } catch (e: any) {
    const durationMs = msSince(t0);
    const msg = e?.message ?? String(e);
    const status: StepStatus = controller.signal.aborted ? "WARN" : "FAIL";
    return {
      id: spec.id,
      title: spec.title,
      durationMs,
      status,
      summary: controller.signal.aborted ? "Timed out" : "Failed",
      details: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}
