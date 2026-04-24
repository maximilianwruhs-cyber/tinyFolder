import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { TaskMemory } from "../memory";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

describe("TaskMemory", () => {
  const tmpDir = join(os.tmpdir(), "gzmo-memory-test");
  const vaultPath = join(tmpDir, "GZMO");
  const tmpFilePath = join(vaultPath, "memory.json");

  beforeAll(() => {
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }
    if (!existsSync(vaultPath)) {
      mkdirSync(vaultPath, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(tmpFilePath)) {
      unlinkSync(tmpFilePath);
    }
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("initializes correctly with empty file path", () => {
    const memory = new TaskMemory("non-existent-file.json");
    expect(memory.count).toBe(0);
  });

  test("loads entries from a dummy JSON file", () => {
    const dummyEntries = [
      { task: "task1.md", summary: "summary 1", time: "2024-01-01T00:00:00.000Z" },
      { task: "task2.md", summary: "summary 2", time: "2024-01-01T00:00:00.000Z" }
    ];
    writeFileSync(tmpFilePath, JSON.stringify(dummyEntries), "utf-8");

    const memory = new TaskMemory(tmpFilePath);
    expect(memory.count).toBe(2);
    expect(memory.toPromptContext()).toContain("task1.md: summary 1");
    expect(memory.toPromptContext()).toContain("task2.md: summary 2");

    // Cleanup for next test
    unlinkSync(tmpFilePath);
  });

  test("enforces MAX_ENTRIES behavior", () => {
    const memory = new TaskMemory(tmpFilePath);

    // Add 6 entries
    memory.record("task1.md", "summary 1");
    memory.record("task2.md", "summary 2");
    memory.record("task3.md", "summary 3");
    memory.record("task4.md", "summary 4");
    memory.record("task5.md", "summary 5");
    memory.record("task6.md", "summary 6");

    expect(memory.count).toBe(5);

    // task1 should be gone, task2-6 should be present
    const context = memory.toPromptContext();
    expect(context).not.toContain("task1.md: summary 1");
    expect(context).toContain("task6.md: summary 6");
  });
});
