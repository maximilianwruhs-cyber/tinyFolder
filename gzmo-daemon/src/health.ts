import { join } from "path";
import { atomicWriteJson, safeWriteText } from "./vault_fs";

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
    llmTemperature?: number;
    llmMaxTokens?: number;
    llmValence?: number;
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

export interface TelemetrySnapshot {
  generatedAt: string;
  runtime: HealthSnapshot["runtime"] & {
    inference: {
      temperature: number | null;
      maxTokens: number | null;
      valence: number | null;
    };
  };
  state: {
    alive: boolean;
    phase: string;
    tension: number;
    energy: number;
    tick: number;
    deaths: number;
  };
  workload: {
    inbox: {
      pending: number;
      processing: number;
      completed: number;
      failed: number;
    };
    cabinetNotes: number;
    quarantineNotes: number;
  };
  scheduler: HealthSnapshot["scheduler"];
  operatorHints: string[];
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
    llmTemperature?: number;
    llmMaxTokens?: number;
    llmValence?: number;
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

  const telemetry: TelemetrySnapshot = {
    generatedAt: snap.generatedAt,
    runtime: {
      ...snap.runtime,
      inference: {
        temperature: snap.pulse.llmTemperature ?? null,
        maxTokens: snap.pulse.llmMaxTokens ?? null,
        valence: snap.pulse.llmValence ?? null,
      },
    },
    state: {
      alive: snap.pulse.alive,
      phase: snap.pulse.phase,
      tension: Number(snap.pulse.tension.toFixed(1)),
      energy: Number(snap.pulse.energy.toFixed(0)),
      tick: snap.pulse.tick,
      deaths: snap.pulse.deaths,
    },
    workload: {
      inbox: {
        pending: snap.counts.inboxPending,
        processing: snap.counts.inboxProcessing,
        completed: snap.counts.inboxCompleted,
        failed: snap.counts.inboxFailed,
      },
      cabinetNotes: snap.counts.cabinetNotes,
      quarantineNotes: snap.counts.quarantineNotes,
    },
    scheduler: snap.scheduler,
    operatorHints: buildOperatorHints(snap),
  };

  await atomicWriteJson(vaultPath, join(vaultPath, "GZMO", "TELEMETRY.json"), telemetry, 2);
}

function buildOperatorHints(snap: HealthSnapshot): string[] {
  const hints: string[] = [];
  if (!snap.pulse.alive) hints.push("Pulse is not alive; restart daemon if this persists.");
  if (snap.counts.inboxPending > 20) hints.push("Inbox backlog is high; process verify and maintenance tasks first.");
  if (snap.counts.inboxProcessing > 0) hints.push("Tasks are currently processing; avoid starting another daemon instance.");
  if (snap.counts.inboxFailed > 0) hints.push("Failed inbox tasks exist; inspect recent failures before adding more autonomy.");
  if (snap.counts.quarantineNotes > 0) hints.push("Quarantine contains notes; review upstream prompt or gate before trusting new wiki output.");
  if (!snap.scheduler.embeddingsLiveEnabled) hints.push("Embeddings live sync is disabled; restart with live sync for fresher RAG.");
  if (snap.pulse.energy < 30) hints.push("Energy is low; autonomous dream/self-ask cycles may pause.");
  if (snap.pulse.tension > 70) hints.push("Tension is high; prefer verification and pruning over generative work.");
  if (hints.length === 0) hints.push("No immediate operator action suggested.");
  return hints;
}

