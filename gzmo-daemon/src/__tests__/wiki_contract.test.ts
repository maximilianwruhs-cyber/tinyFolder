import { describe, expect, test } from "bun:test";
import { normalizeWikiMarkdown } from "../wiki_contract";

describe("wiki_contract", () => {
  test("adds required frontmatter + H1 and derives type from path", () => {
    const raw = "This is a body without frontmatter.";
    const normalized = normalizeWikiMarkdown({
      vaultPath: "/vault",
      wikiFileAbs: "/vault/wiki/entities/MyPage.md",
      rawMarkdown: raw,
      now: new Date("2026-04-22T10:00:00Z"),
      existingMarkdown: null,
    });

    expect(normalized.frontmatter.title).toBe("MyPage");
    expect(normalized.frontmatter.type).toBe("entity");
    expect(normalized.frontmatter.created).toBe("2026-04-22");
    expect(normalized.frontmatter.updated).toBe("2026-04-22");
    expect(Array.isArray(normalized.frontmatter.tags)).toBe(true);
    expect(typeof normalized.frontmatter.sources).toBe("number");
    expect(normalized.markdown).toContain("---\n");
    expect(normalized.markdown).toContain("\n# MyPage\n");
  });

  test("rejects HTML outside code fences", () => {
    expect(() =>
      normalizeWikiMarkdown({
        vaultPath: "/vault",
        wikiFileAbs: "/vault/wiki/topics/x.md",
        rawMarkdown: "---\n---\n\n# X\n\n<div>nope</div>\n",
        now: new Date("2026-04-22T10:00:00Z"),
        existingMarkdown: null,
      }),
    ).toThrow();
  });
});
