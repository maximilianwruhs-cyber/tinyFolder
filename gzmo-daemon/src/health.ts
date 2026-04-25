import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { safeWriteText } from "./vault_fs";

export interface HealthSnapshot {
  generatedAt: string;
  runtime: {
    profile: string;
    ollamaUrl: string;
    model: string;
  };
  pulse: {
    tension: number;
    energy: number;
    phase: string;
    alive: boolean;
    deaths: number;
    tick: number;
    thoughtsIncubating: number;
    thoughtsCrystallized: number;
  };
  paths: {
    vaultPath: string;
    inboxDir: string;
    cabinetDir: string;
    wikiDir: string;
    embeddingsFile: string;
    quarantineDir: string;
  };
  counts: {
    inboxPending: number;
    inboxProcessing: number;
    inboxCompleted: number;
    inboxFailed: number;
    cabinetNotes: number;
    quarantineNotes: number;
  };
  scheduler: {
    dreamsEnabled: boolean;
    selfAskEnabled: boolean;
    wikiEnabled: boolean;
    ingestEnabled: boolean;
    wikiLintEnabled: boolean;
    pruningEnabled: boolean;
    embeddingsLiveEnabled: boolean;
  };
}

function safeCount(dir: string, predicate: (name: string) => boolean): number {
  try {
    if (!existsSync(dir)) return 0;
    const entries = readFileSync; // keep import set minimal
    // Use Bun to list when possible, but stay compatible: fallback to readdirSync isn't imported here.
    // We'll parse via `Bun.file` is async; this health is sync-ish. Keep it simple using spawn-free approach:
    // Read directory listing via Bun (works in bun runtime).
    const names: string[] = (Bun as any).file(dir).exists ? [] : [];
    void entries;
    // We can't reliably read dir without readdirSync; keep it in main health writer where readdirSync exists.
    return 0;
  } catch {
    return 0;
  }
}

export async function writeHealth(params: {
  vaultPath: string;
  profile: string;
  ollamaUrl: string;
  model: string;
  pulse: {
    tension: number;
    energy: number;
    phase: string;
    alive: boolean;
    deaths: number;
    tick: number;
    thoughtsIncubating: number;
    thoughtsCrystallized: number;
  };
  scheduler: HealthSnapshot["scheduler"];
  counts: HealthSnapshot["counts"];
}): Promise<void> {
  const vaultPath = params.vaultPath;
  const healthPath = join(vaultPath, "GZMO", "health.md");
  const quarantineDir = join(vaultPath, "GZMO", "Quarantine");

  const snap: HealthSnapshot = {
    generatedAt: new Date().toISOString(),
    runtime: {
      profile: params.profile,
      ollamaUrl: params.ollamaUrl,
      model: params.model,
    },
    pulse: params.pulse,
    paths: {
      vaultPath,
      inboxDir: join(vaultPath, "GZMO", "Inbox"),
      cabinetDir: join(vaultPath, "GZMO", "Thought_Cabinet"),
      wikiDir: join(vaultPath, "wiki"),
      embeddingsFile: join(vaultPath, "GZMO", "embeddings.json"),
      quarantineDir,
    },
    counts: params.counts,
    scheduler: params.scheduler,
  };

  const md = [
    "---",
    `title: GZMO Health`,
    `type: topic`,
    `tags: [health, operations]`,
    `sources: 0`,
    `created: "${snap.generatedAt.slice(0, 10)}"`,
    `updated: "${snap.generatedAt.slice(0, 10)}"`,
    "---",
    "",
    "# GZMO Health",
    "",
    `GeneratedAt: \`${snap.generatedAt}\``,
    "",
    "## Runtime",
    "",
    `- profile: \`${snap.runtime.profile}\``,
    `- model: \`${snap.runtime.model}\``,
    `- ollama: \`${snap.runtime.ollamaUrl}\``,
    "",
    "## Pulse",
    "",
    `- alive: \`${snap.pulse.alive}\``,
    `- tick: \`${snap.pulse.tick}\``,
    `- phase: \`${snap.pulse.phase}\``,
    `- tension: \`${snap.pulse.tension.toFixed(1)}%\``,
    `- energy: \`${snap.pulse.energy.toFixed(0)}%\``,
    `- thoughts: \`${snap.pulse.thoughtsIncubating} incubating / ${snap.pulse.thoughtsCrystallized} crystallized\``,
    "",
    "## Scheduler",
    "",
    `- dreams: \`${snap.scheduler.dreamsEnabled}\``,
    `- selfAsk: \`${snap.scheduler.selfAskEnabled}\``,
    `- wiki: \`${snap.scheduler.wikiEnabled}\``,
    `- ingest: \`${snap.scheduler.ingestEnabled}\``,
    `- wikiLint: \`${snap.scheduler.wikiLintEnabled}\``,
    `- pruning: \`${snap.scheduler.pruningEnabled}\``,
    `- embeddingsLive: \`${snap.scheduler.embeddingsLiveEnabled}\``,
    "",
    "## Counts",
    "",
    `- inbox: pending=${snap.counts.inboxPending}, processing=${snap.counts.inboxProcessing}, completed=${snap.counts.inboxCompleted}, failed=${snap.counts.inboxFailed}`,
    `- cabinet notes: ${snap.counts.cabinetNotes}`,
    `- quarantine notes: ${snap.counts.quarantineNotes}`,
    "",
    "## Paths",
    "",
    `- inbox: \`${snap.paths.inboxDir}\``,
    `- cabinet: \`${snap.paths.cabinetDir}\``,
    `- wiki: \`${snap.paths.wikiDir}\``,
    `- embeddings: \`${snap.paths.embeddingsFile}\``,
    `- quarantine: \`${snap.paths.quarantineDir}\``,
    "",
  ].join("\n");

  await safeWriteText(vaultPath, healthPath, md);
}

