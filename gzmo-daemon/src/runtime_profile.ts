export type GzmoProfileName = "heartbeat" | "minimal" | "standard" | "full";

export interface RuntimeProfile {
  name: GzmoProfileName;

  enableInboxWatcher: boolean;
  enableTaskProcessing: boolean;

  enableEmbeddingsInitialSync: boolean;
  enableEmbeddingsLiveSync: boolean;

  enableDreams: boolean;
  enableSelfAsk: boolean;
  enableWiki: boolean;
  enableIngest: boolean;
  enableWikiLint: boolean;
  enablePruning: boolean;
  enableDashboardPulse: boolean;
}

function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

function parseProfileName(raw?: string): GzmoProfileName {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "heartbeat") return "heartbeat";
  if (v === "minimal") return "minimal";
  if (v === "standard") return "standard";
  return "full";
}

export function defaultRuntimeProfile(name: GzmoProfileName): RuntimeProfile {
  switch (name) {
    case "heartbeat":
      return {
        name,
        enableInboxWatcher: false,
        enableTaskProcessing: false,
        enableEmbeddingsInitialSync: false,
        enableEmbeddingsLiveSync: false,
        enableDreams: false,
        enableSelfAsk: false,
        enableWiki: false,
        enableIngest: false,
        enableWikiLint: false,
        enablePruning: false,
        enableDashboardPulse: true,
      };

    case "minimal":
      return {
        name,
        enableInboxWatcher: true,
        enableTaskProcessing: true,
        enableEmbeddingsInitialSync: false,
        enableEmbeddingsLiveSync: false,
        enableDreams: false,
        enableSelfAsk: false,
        enableWiki: false,
        enableIngest: false,
        enableWikiLint: false,
        enablePruning: true,
        enableDashboardPulse: true,
      };

    case "standard":
      return {
        name,
        enableInboxWatcher: true,
        enableTaskProcessing: true,
        enableEmbeddingsInitialSync: true,
        enableEmbeddingsLiveSync: true,
        enableDreams: false,
        enableSelfAsk: false,
        enableWiki: false,
        enableIngest: false,
        enableWikiLint: false,
        enablePruning: true,
        enableDashboardPulse: true,
      };

    case "full":
      return {
        name,
        enableInboxWatcher: true,
        enableTaskProcessing: true,
        enableEmbeddingsInitialSync: true,
        enableEmbeddingsLiveSync: true,
        enableDreams: true,
        enableSelfAsk: true,
        enableWiki: true,
        enableIngest: true,
        enableWikiLint: true,
        enablePruning: true,
        enableDashboardPulse: true,
      };
  }
}

export function resolveRuntimeProfile(): RuntimeProfile {
  const base = defaultRuntimeProfile(parseProfileName(process.env.GZMO_PROFILE));

  // Per-subsystem overrides
  return {
    ...base,
    enableInboxWatcher: readBoolEnv("GZMO_ENABLE_INBOX_WATCHER", base.enableInboxWatcher),
    enableTaskProcessing: readBoolEnv("GZMO_ENABLE_TASK_PROCESSING", base.enableTaskProcessing),

    enableEmbeddingsInitialSync: readBoolEnv("GZMO_ENABLE_EMBEDDINGS_SYNC", base.enableEmbeddingsInitialSync),
    enableEmbeddingsLiveSync: readBoolEnv("GZMO_ENABLE_EMBEDDINGS_LIVE", base.enableEmbeddingsLiveSync),

    enableDreams: readBoolEnv("GZMO_ENABLE_DREAMS", base.enableDreams),
    enableSelfAsk: readBoolEnv("GZMO_ENABLE_SELF_ASK", base.enableSelfAsk),
    enableWiki: readBoolEnv("GZMO_ENABLE_WIKI", base.enableWiki),
    enableIngest: readBoolEnv("GZMO_ENABLE_INGEST", base.enableIngest),
    enableWikiLint: readBoolEnv("GZMO_ENABLE_WIKI_LINT", base.enableWikiLint),
    enablePruning: readBoolEnv("GZMO_ENABLE_PRUNING", base.enablePruning),
    enableDashboardPulse: readBoolEnv("GZMO_ENABLE_DASHBOARD_PULSE", base.enableDashboardPulse),
  };
}

export function describeRuntimeProfile(p: RuntimeProfile): string {
  const flags = [
    `inboxWatcher=${p.enableInboxWatcher ? "on" : "off"}`,
    `taskProcessing=${p.enableTaskProcessing ? "on" : "off"}`,
    `embeddingsSync=${p.enableEmbeddingsInitialSync ? "on" : "off"}`,
    `embeddingsLive=${p.enableEmbeddingsLiveSync ? "on" : "off"}`,
    `dreams=${p.enableDreams ? "on" : "off"}`,
    `selfAsk=${p.enableSelfAsk ? "on" : "off"}`,
    `wiki=${p.enableWiki ? "on" : "off"}`,
    `ingest=${p.enableIngest ? "on" : "off"}`,
    `wikiLint=${p.enableWikiLint ? "on" : "off"}`,
    `pruning=${p.enablePruning ? "on" : "off"}`,
    `dashboardPulse=${p.enableDashboardPulse ? "on" : "off"}`,
  ];
  return `${p.name} (${flags.join(", ")})`;
}

