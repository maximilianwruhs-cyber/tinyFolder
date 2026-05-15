import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  maxAutoTasksPerHourDefault,
  readAutoInboxFromDreams,
  readAutoInboxFromSelfAsk,
  readAutoInboxFromWikiRepair,
} from "../pipelines/helpers.ts";
import { createRepairTask } from "../quarantine.ts";

const GATE_KEYS = [
  "GZMO_PROFILE",
  "GZMO_AUTO_INBOX_FROM_WIKI_REPAIR",
  "GZMO_AUTO_INBOX_FROM_SELF_ASK",
  "GZMO_AUTO_INBOX_FROM_DREAMS",
  "GZMO_AUTO_TASKS_PER_HOUR",
] as const;

function snapshotGateEnv(): Partial<Record<(typeof GATE_KEYS)[number], string | undefined>> {
  const s: Partial<Record<(typeof GATE_KEYS)[number], string | undefined>> = {};
  for (const k of GATE_KEYS) s[k] = process.env[k];
  return s;
}

function restoreGateEnv(prev: Partial<Record<(typeof GATE_KEYS)[number], string | undefined>>) {
  for (const k of GATE_KEYS) {
    const v = prev[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function withGateEnv(patch: Partial<Record<string, string | undefined>>, fn: () => void) {
  const prev = snapshotGateEnv();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    restoreGateEnv(prev);
  }
}

async function withGateEnvAsync(
  patch: Partial<Record<string, string | undefined>>,
  fn: () => Promise<void>,
) {
  const prev = snapshotGateEnv();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    restoreGateEnv(prev);
  }
}

describe("readAutoInboxFrom* gates vs profile", () => {
  test("art + unset env => wiki/self/dream inbox off by default", () => {
    withGateEnv({ GZMO_PROFILE: "art" }, () => {
      delete process.env.GZMO_AUTO_INBOX_FROM_WIKI_REPAIR;
      delete process.env.GZMO_AUTO_INBOX_FROM_SELF_ASK;
      delete process.env.GZMO_AUTO_INBOX_FROM_DREAMS;
      expect(readAutoInboxFromWikiRepair()).toBe(false);
      expect(readAutoInboxFromSelfAsk()).toBe(false);
      expect(readAutoInboxFromDreams()).toBe(false);
    });
  });

  test("full + unset env => inbox bridges on by default", () => {
    withGateEnv({ GZMO_PROFILE: "full" }, () => {
      delete process.env.GZMO_AUTO_INBOX_FROM_WIKI_REPAIR;
      delete process.env.GZMO_AUTO_INBOX_FROM_SELF_ASK;
      delete process.env.GZMO_AUTO_INBOX_FROM_DREAMS;
      expect(readAutoInboxFromWikiRepair()).toBe(true);
      expect(readAutoInboxFromSelfAsk()).toBe(true);
      expect(readAutoInboxFromDreams()).toBe(true);
    });
  });

  test("explicit on wins over art default", () => {
    withGateEnv({ GZMO_PROFILE: "art", GZMO_AUTO_INBOX_FROM_WIKI_REPAIR: "on" }, () => {
      expect(readAutoInboxFromWikiRepair()).toBe(true);
    });
  });

  test("unset profile behaves like non-art for gate defaults", () => {
    withGateEnv({}, () => {
      delete process.env.GZMO_PROFILE;
      delete process.env.GZMO_AUTO_INBOX_FROM_WIKI_REPAIR;
      expect(readAutoInboxFromWikiRepair()).toBe(true);
    });
  });
});

describe("maxAutoTasksPerHourDefault", () => {
  test("lower cap under art profile", () => {
    withGateEnv({ GZMO_PROFILE: "art" }, () => {
      expect(maxAutoTasksPerHourDefault()).toBe(5);
    });
  });

  test("standard cap outside art", () => {
    withGateEnv({ GZMO_PROFILE: "full" }, () => {
      expect(maxAutoTasksPerHourDefault()).toBe(20);
    });
  });
});

function scaffoldMinimalVault(dir: string) {
  mkdirSync(join(dir, "GZMO", "Inbox"), { recursive: true });
}

describe("createRepairTask", () => {
  test("no inbox file when GZMO_AUTO_INBOX_FROM_WIKI_REPAIR is off", async () => {
    const root = mkdtempSync(join(tmpdir(), "gzmo-art-gate-off-"));
    scaffoldMinimalVault(root);
    try {
      await withGateEnvAsync(
        {
          GZMO_PROFILE: "art",
          GZMO_AUTO_TASKS_PER_HOUR: "100",
        },
        async () => {
          delete process.env.GZMO_AUTO_INBOX_FROM_WIKI_REPAIR;
          await createRepairTask({
            vaultPath: root,
            title: "repair wiki",
            reason: "wiki_missing_evidence",
            quarantineFile: "bad.md",
            suggestion: "re-run consolidation",
          });
        },
      );
      expect(readdirSync(join(root, "GZMO", "Inbox")).filter((f) => f.endsWith(".md"))).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes inbox maintenance when wiki repair inbox gate on", async () => {
    const root = mkdtempSync(join(tmpdir(), "gzmo-art-gate-on-"));
    scaffoldMinimalVault(root);
    try {
      await withGateEnvAsync(
        {
          GZMO_PROFILE: "art",
          GZMO_AUTO_INBOX_FROM_WIKI_REPAIR: "on",
          GZMO_AUTO_TASKS_PER_HOUR: "100",
        },
        async () => {
          await createRepairTask({
            vaultPath: root,
            title: "repair wiki consolidate",
            reason: "wiki_missing_evidence",
            quarantineFile: "bad.md",
            suggestion: "re-run consolidation",
          });
        },
      );
      expect(readdirSync(join(root, "GZMO", "Inbox")).filter((f) => f.endsWith(".md")).length).toBeGreaterThan(
        0,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
