import { join } from "path";
import { existsSync, readFileSync } from "fs";
import * as crypto from "crypto";
import { safeWriteText, atomicWriteJson } from "./vault_fs";

export type InboxTaskType = "maintenance" | "research" | "build" | "verify" | "curate";

export interface AutoTaskSpec {
  type: InboxTaskType;
  title: string;
  body: string;
  source: {
    subsystem: "dream" | "self_ask" | "wiki";
    sourceFile?: string; // e.g. cabinet note or wiki page basename
  };
}

interface AutoTaskDigest {
  created: string[]; // stable ids
  createdAt?: Record<string, string>; // stable id -> iso timestamp (for rate limiting)
}

const DIGEST_FILE = ".gzmo_auto_tasks.json";

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "task";
}

function stableId(spec: AutoTaskSpec): string {
  const normalized = JSON.stringify({
    type: spec.type,
    title: spec.title.trim(),
    body: spec.body.trim(),
    source: spec.source,
  });
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function loadDigest(vaultPath: string): AutoTaskDigest {
  const p = join(vaultPath, "GZMO", DIGEST_FILE);
  try {
    if (!existsSync(p)) return { created: [] };
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      created: Array.isArray(parsed?.created) ? parsed.created : [],
      createdAt: typeof parsed?.createdAt === "object" && parsed?.createdAt ? parsed.createdAt : {},
    };
  } catch {
    return { created: [], createdAt: {} };
  }
}

async function saveDigest(vaultPath: string, digest: AutoTaskDigest): Promise<void> {
  const p = join(vaultPath, "GZMO", DIGEST_FILE);
  await atomicWriteJson(vaultPath, p, digest, 2);
}

function templateFor(type: InboxTaskType): { sections: string[]; acceptance: string[] } {
  switch (type) {
    case "verify":
      return {
        sections: ["## Context", "## Hypothesis", "## Steps", "## Evidence", "## Result"],
        acceptance: [
          "- Include at least one concrete piece of evidence (file path, log line, or count).",
          "- State expected vs actual behavior.",
        ],
      };
    case "maintenance":
      return {
        sections: ["## Context", "## Change", "## Evidence", "## Result"],
        acceptance: [
          "- Mention which files/paths were changed.",
          "- Provide before/after outcome (even if brief).",
        ],
      };
    case "research":
      return {
        sections: ["## Question", "## Findings", "## Evidence", "## Next actions"],
        acceptance: [
          "- Findings must be grounded in vault/code sources; link or cite paths.",
          "- If inconclusive, state what is missing.",
        ],
      };
    case "build":
      return {
        sections: ["## Goal", "## Plan", "## Implementation notes", "## Test plan"],
        acceptance: [
          "- Must include a test plan (even minimal).",
        ],
      };
    case "curate":
      return {
        sections: ["## Scope", "## Keep", "## Delete", "## Rationale"],
        acceptance: [
          "- Provide a clear keep/delete decision with rationale.",
        ],
      };
  }
}

export function parseTypedNextAction(line: string): { type: InboxTaskType; title: string } | null {
  // Expected: "[type] Title..." where type in taxonomy.
  const m = line.trim().match(/^\[(maintenance|research|build|verify|curate)\]\s+(.+?)\s*$/i);
  if (!m) return null;
  return { type: m[1]!.toLowerCase() as InboxTaskType, title: m[2]!.trim() };
}

export async function createAutoInboxTasks(params: {
  vaultPath: string;
  tasks: AutoTaskSpec[];
}): Promise<{ created: string[]; skipped: string[] }> {
  const digest = loadDigest(params.vaultPath);
  const seen = new Set(digest.created);
  const created: string[] = [];
  const skipped: string[] = [];

  // Simple rate limit: at most N auto tasks per hour across all subsystems.
  const MAX_PER_HOUR = 20;
  const nowMs = Date.now();
  const createdAt = digest.createdAt ?? {};
  const recent = Object.values(createdAt).filter((iso) => {
    const t = Date.parse(String(iso));
    return Number.isFinite(t) && (nowMs - t) < 60 * 60 * 1000;
  }).length;
  const remaining = Math.max(0, MAX_PER_HOUR - recent);
  let budget = remaining;

  for (const t of params.tasks) {
    if (budget <= 0) break;
    const id = stableId(t);
    if (seen.has(id)) {
      skipped.push(id);
      continue;
    }

    const now = new Date().toISOString();
    const file = `${now.slice(0, 10)}__${slugify(t.type)}__${slugify(t.title)}__${id}.md`;
    const abs = join(params.vaultPath, "GZMO", "Inbox", file);

    const fm = [
      "---",
      "status: pending",
      "action: think",
      `type: ${t.type}`,
      `title: "${t.title.replace(/"/g, '\\"')}"`,
      `created_at: "${now}"`,
      `auto: true`,
      `source_subsystem: ${t.source.subsystem}`,
      t.source.sourceFile ? `source_file: "${t.source.sourceFile}"` : null,
      `stable_id: "${id}"`,
      "---",
      "",
    ].filter(Boolean).join("\n");

    const tpl = templateFor(t.type);
    const body = [
      "## Task",
      "",
      t.body.trim(),
      "",
      ...tpl.sections,
      "",
      "## Acceptance criteria",
      "",
      "- Produce a concrete result in this file (no placeholders).",
      "- If information is missing, write what is missing and propose a minimal next step.",
      ...tpl.acceptance.map((x) => x.startsWith("- ") ? x : `- ${x}`),
      "",
    ].join("\n");

    await safeWriteText(params.vaultPath, abs, fm + body);

    digest.created.push(id);
    digest.createdAt = digest.createdAt ?? {};
    digest.createdAt[id] = new Date(nowMs).toISOString();
    seen.add(id);
    created.push(abs);
    budget--;
  }

  if (created.length > 0) {
    // Keep digest bounded
    digest.created = digest.created.slice(-5000);
    // Bound createdAt map as well
    if (digest.createdAt) {
      const keep = new Set(digest.created);
      for (const k of Object.keys(digest.createdAt)) {
        if (!keep.has(k)) delete digest.createdAt[k];
      }
    }
    await saveDigest(params.vaultPath, digest);
  }

  return { created, skipped };
}

