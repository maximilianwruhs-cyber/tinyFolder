import { describe, expect, test } from "bun:test";
import { upsertSourceLink } from "../wiki_graph";

describe("wiki_graph", () => {
  test("adds Sources section if missing", () => {
    const md = "---\n---\n\n# A\n\nBody\n";
    const out = upsertSourceLink(md, "[[source-foo]]");
    expect(out).toContain("## Sources");
    expect(out).toContain("- [[source-foo]]");
  });

  test("inserts into existing Sources section", () => {
    const md = "---\n---\n\n# A\n\n## Sources\n\n- [[x]]\n\n## Other\n\nHi\n";
    const out = upsertSourceLink(md, "[[source-foo]]");
    expect(out).toContain("## Sources");
    expect(out).toContain("- [[x]]");
    expect(out).toContain("- [[source-foo]]");
  });

  test("is idempotent", () => {
    const md = "---\n---\n\n# A\n\n## Sources\n\n- [[source-foo]]\n";
    const out = upsertSourceLink(md, "[[source-foo]]");
    expect(out.match(/\[\[source-foo\]\]/g)?.length).toBe(1);
  });
});
