import { readFileSync } from "fs";

type TaskPerfEvent = {
  type: "task_perf";
  created_at: string;
  fileName: string;
  action: string;
  ok: boolean;
  total_ms: number;
  spans: Array<{ name: string; ms: number }>;
};

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[idx] ?? null;
}

function summarize(events: TaskPerfEvent[]) {
  const totals = events.map((e) => e.total_ms);
  return {
    n: events.length,
    ok: events.filter((e) => e.ok).length,
    p50: quantile(totals, 0.50),
    p95: quantile(totals, 0.95),
    max: totals.length ? Math.max(...totals) : null,
  };
}

function bySpan(events: TaskPerfEvent[]) {
  const acc = new Map<string, number[]>();
  for (const e of events) {
    for (const s of e.spans ?? []) {
      if (!acc.has(s.name)) acc.set(s.name, []);
      acc.get(s.name)!.push(s.ms);
    }
  }
  const rows = [...acc.entries()]
    .map(([name, xs]) => ({ name, n: xs.length, p50: quantile(xs, 0.5), p95: quantile(xs, 0.95), max: xs.length ? Math.max(...xs) : null }))
    .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
  return rows;
}

function main() {
  const vault = process.env.VAULT_PATH;
  if (!vault) {
    console.error("VAULT_PATH is required (points to vault root).");
    process.exit(2);
  }
  const path = `${vault}/GZMO/perf.jsonl`;
  const raw = readFileSync(path, "utf8");
  const events: TaskPerfEvent[] = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((x) => x?.type === "task_perf");

  const search = events.filter((e) => e.action === "search");
  const think = events.filter((e) => e.action === "think");

  console.log("== PERF SUMMARY ==");
  console.log({ all: summarize(events), search: summarize(search), think: summarize(think) });

  console.log("\n== TOP SPANS by p95 (search) ==");
  for (const r of bySpan(search).slice(0, 12)) {
    console.log(r);
  }
}

main();

