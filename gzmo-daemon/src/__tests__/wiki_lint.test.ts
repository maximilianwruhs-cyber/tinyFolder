import { describe, expect, test } from "bun:test";
import { extractWikiLinks } from "../wiki_lint";
import { normalizeWikiMarkdown } from "../wiki_contract";

describe("wiki_lint", () => {
  test("extractWikiLinks parses aliases and anchors", () => {
    const md = "See [[Page One|alias]] and [[PageTwo#Section]] and [[Third]].";
    expect(extractWikiLinks(md)).toEqual(["Page One", "PageTwo", "Third"]);
  });

  test("normalization is safe (no HTML allowed, keeps body)", () => {
    const raw = "---\n---\n\nHello world\n";
    const out = normalizeWikiMarkdown({
      vaultPath: "/vault",
      wikiFileAbs: "/vault/wiki/topics/x.md",
      rawMarkdown: raw,
      now: new Date("2026-04-22T00:00:00Z"),
      existingMarkdown: null,
    });
    expect(out.markdown).toContain("title:");
    expect(out.markdown).toContain("type: topic");
    expect(out.markdown).toContain("# x");
  });
});

