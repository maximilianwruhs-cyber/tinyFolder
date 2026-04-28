import { describe, expect, test } from "bun:test";
import { formatSearchCitations } from "../citation_formatter";
import type { EvidencePacket } from "../evidence_packet";

function packetWith(ids: string[]): EvidencePacket {
  return {
    snippets: ids.map((id) => ({ id, kind: "retrieval", text: "x" })) as any,
    allowedPaths: [],
  };
}

describe("citation_formatter", () => {
  test("adds citations to bullet/checklist/numbered item lines missing [E#]", () => {
    const packet = packetWith(["E1", "E2"]);
    const input = [
      "- first",
      "- [ ] second",
      "1. third",
      "- already cited [E2]",
    ].join("\n");

    const res = formatSearchCitations(input, packet);
    expect(res.changed).toBe(true);
    expect(res.formatted).toContain("- first [E1]");
    expect(res.formatted).toContain("- [ ] second [E1]");
    expect(res.formatted).toContain("1. third [E1]");
    expect(res.formatted).toContain("- already cited [E2]");
  });

  test("adds at least one citation when none exist anywhere", () => {
    const packet = packetWith(["E7"]);
    const input = [
      "# Heading",
      "",
      "Plain sentence without bullets.",
    ].join("\n");

    const res = formatSearchCitations(input, packet);
    expect(res.changed).toBe(true);
    expect(res.formatted).toContain("Plain sentence without bullets. [E7]");
  });

  test("does nothing when there is no default citation available", () => {
    const packet: EvidencePacket = { snippets: [], allowedPaths: [] };
    const input = "- item";
    const res = formatSearchCitations(input, packet);
    expect(res.changed).toBe(false);
    expect(res.formatted).toBe(input);
    expect(res.warnings).toContain("no_snippets");
    expect(res.warnings).toContain("no_default_citation");
  });
});

