import { describe, expect, test } from "bun:test";
import { __testing } from "../ingest_engine";

describe("ingest_engine helpers", () => {
  test("sanitizeSlug produces stable lowercase slug", () => {
    expect(__testing.sanitizeSlug("Hello World!! 2026")).toBe("hello-world-2026");
    expect(__testing.sanitizeSlug("___a__b__")).toBe("a-b");
  });

  test("deriveSourceTitle turns path into human title", () => {
    expect(__testing.deriveSourceTitle("raw/agent-logs/foo_bar-baz.md")).toBe("foo bar baz");
  });
});
