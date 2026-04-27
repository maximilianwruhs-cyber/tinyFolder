import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gatherLocalFacts } from "../local_facts";

describe("local_facts", () => {
  test("includes telemetry/health facts when query is ops-like", async () => {
    const vault = mkdtempSync(join(tmpdir(), "gzmo-local-facts-"));
    try {
      mkdirSync(join(vault, "GZMO"), { recursive: true });
      writeFileSync(join(vault, "GZMO", "TELEMETRY.json"), JSON.stringify({ ok: true }, null, 2));
      writeFileSync(join(vault, "GZMO", "health.md"), "# Health\nok\n");

      // "write"/"writes" triggers inventory-only compaction in gatherLocalFacts (no JSON body).
      const facts = await gatherLocalFacts({
        vaultPath: vault,
        query: "Where does the daemon store telemetry json and what fields exist?",
      });

      expect(facts).toContain("Local Facts");
      expect(facts).toContain("TELEMETRY.json");
      expect(facts).toContain("health.md");
      expect(facts).toContain("\"ok\": true");
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("returns empty string for non-ops queries", async () => {
    const facts = await gatherLocalFacts({ vaultPath: "/tmp/does-not-matter", query: "Summarize the wiki article." });
    expect(facts).toBe("");
  });
});

