/**
 * engine_process_task.test.ts — processTask happy path with mocked inference.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const inferMock = mock(async () => ({
  answer: "Mocked engine answer for unit test.",
  elapsed_ms: 3,
  raw: "Mocked engine answer for unit test.",
}));

// Re-export everything the real module exports so parallel test files
// that import from inference_router → inference don't hit
// "Export named 'X' not found" SyntaxErrors.
mock.module("../inference", () => ({
  inferDetailed: inferMock,
  inferDetailedWithModel: inferMock,
  infer: async () => "Mocked engine answer for unit test.",
  OLLAMA_MODEL: "test-model",
  ollama: () => "test-model",
  getChatModel: () => "test-model",
}));

import { TaskDocument } from "../frontmatter";
import { processTask } from "../engine";
import { VaultWatcher, type TaskEvent } from "../watcher";

let vault = "";
let inbox = "";
const envKeys = [
  "GZMO_ENABLE_GAH",
  "GZMO_ENABLE_THINK_CLARIFY",
  "GZMO_ENABLE_KG_COLLISION",
  "GZMO_ENABLE_TEACHBACK",
  "GZMO_ENABLE_TOT",
  "GZMO_ENABLE_SEMANTIC_NOISE",
  "GZMO_ENABLE_MODEL_ROUTING",
  "GZMO_ENABLE_TRUST_LEDGER",
  "GZMO_ENABLE_LEARNING",
  "GZMO_ENABLE_TRACES",
];

const envSnapshot: Record<string, string | undefined> = {};

function saveEnv() {
  for (const k of envKeys) envSnapshot[k] = process.env[k];
}

function restoreEnv() {
  for (const k of envKeys) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
}

function disableOptionalGates(): void {
  for (const k of envKeys) process.env[k] = "off";
}

async function loadPendingEvent(name: string): Promise<TaskEvent> {
  const fp = join(inbox, name);
  const doc = await TaskDocument.load(fp);
  if (!doc) throw new Error(`failed to load ${fp}`);
  return {
    filePath: fp,
    fileName: name.replace(/\.md$/, ""),
    status: doc.status,
    body: doc.body,
    frontmatter: doc.frontmatter as Record<string, unknown>,
    document: doc,
  };
}

beforeEach(() => {
  saveEnv();
  disableOptionalGates();
  inferMock.mockClear();
  vault = mkdtempSync(join(tmpdir(), "gzmo-engine-"));
  inbox = join(vault, "GZMO", "Inbox");
  mkdirSync(inbox, { recursive: true });
  const fp = join(inbox, "think-task.md");
  writeFileSync(
    fp,
    ["---", "status: pending", "action: think", "---", "", "Say hello in one sentence.", ""].join("\n"),
    "utf8",
  );
});

afterEach(() => {
  restoreEnv();
  if (vault) try { rmSync(vault, { recursive: true, force: true }); } catch { /* ignore */ }
  vault = "";
});

afterAll(() => {
  mock.restore();
});

describe("processTask", () => {
  test("marks task completed after mocked inference", async () => {
    const watcher = new VaultWatcher(inbox, 500);
    const event = await loadPendingEvent("think-task.md");
    await processTask(event, watcher);

    const md = readFileSync(event.filePath, "utf8");
    expect(md).toMatch(/status:\s*completed/);
    expect(md).toContain("Mocked engine answer");
    expect(inferMock).toHaveBeenCalled();
  });
});
