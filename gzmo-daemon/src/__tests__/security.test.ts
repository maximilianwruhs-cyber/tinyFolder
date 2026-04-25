import { describe, expect, test } from "bun:test";
import { basename } from "path";

function secureSanitizeNextTask(nextTask: string): string {
    const base = basename(nextTask);
    return base.endsWith(".md") ? base : base + ".md";
}

describe("Security: Path Traversal Logic Fix", () => {
  test("Fix: sanitized path blocks traversal", () => {
    const malicious = "../../../etc/passwd";
    const result = secureSanitizeNextTask(malicious);
    expect(result).toBe("passwd.md");
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
  });

  test("Fix: handles filenames without extension", () => {
    expect(secureSanitizeNextTask("next-step")).toBe("next-step.md");
  });

  test("Fix: handles filenames with extension", () => {
    expect(secureSanitizeNextTask("next-step.md")).toBe("next-step.md");
  });
});
