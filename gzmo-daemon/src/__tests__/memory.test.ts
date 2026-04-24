import { describe, expect, test, afterAll } from "bun:test";
import { TaskMemory } from "../memory";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("TaskMemory", () => {
  const tmpFilePath = join(tmpdir(), "malformed_memory.json");

  afterAll(() => {
    try {
      unlinkSync(tmpFilePath);
    } catch {}
  });

  test("handles malformed JSON gracefully", () => {
    // Write malformed JSON
    writeFileSync(tmpFilePath, "{ invalid_json ", "utf-8");

    // Instantiate TaskMemory, which should try to load the file
    const memory = new TaskMemory(tmpFilePath);

    // It should catch the JSON.parse error and default to empty
    expect(memory.count).toBe(0);
  });
});
