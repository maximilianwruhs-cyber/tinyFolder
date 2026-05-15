/** Build ToT reason retry hint including shadow-judge prosecutor trace. */

export const TOT_RETRY_HINT_BASE =
  "Your previous claims may have scored low on grounding. Re-examine the evidence; cite SOURCE IDs; prefer verbatim support.";

export function buildTotRetryHint(judgeTrace?: string): string {
  const trace = String(judgeTrace ?? "").trim();
  if (!trace) return TOT_RETRY_HINT_BASE;
  return [
    TOT_RETRY_HINT_BASE,
    "",
    "Prosecutor critique (address these points):",
    trace.slice(0, 900),
  ].join("\n");
}
