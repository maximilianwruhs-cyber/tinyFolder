import { describe, expect, test } from "bun:test";
import { parseTypedNextAction } from "../auto_tasks";
import { assessWikiDraft } from "../quarantine";

describe("auto_tasks", () => {
  test("parseTypedNextAction parses known types", () => {
    expect(parseTypedNextAction("[verify] Check that X works")?.type).toBe("verify");
    expect(parseTypedNextAction("[maintenance] Fix links")?.type).toBe("maintenance");
    expect(parseTypedNextAction("[research] Find evidence")?.type).toBe("research");
    expect(parseTypedNextAction("[build] Implement gate")?.type).toBe("build");
    expect(parseTypedNextAction("[curate] Decide keep/delete")?.type).toBe("curate");
  });

  test("parseTypedNextAction rejects untyped lines", () => {
    expect(parseTypedNextAction("Fix links")).toBeNull();
    expect(parseTypedNextAction("- [verify] wrong prefix")).toBeNull();
  });
});

describe("quarantine assessWikiDraft", () => {
  test("rejects drafts without per-entry evidence citations", () => {
    const raw = `# Title\n\n## Summary\n- A\n\n## Evidence\n- something\n\n## Next actions\n- [verify] Do thing\n`;
    const r = assessWikiDraft(raw);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wiki_missing_evidence");
  });

  test("accepts drafts with Entry citations", () => {
    const raw = `# Title

## Summary
- A grounded summary bullet.

## Evidence
- Quote (Entry 2: 2026-x.md)
- Another quote (Entry 1: 2026-y.md)
- Datum (Entry 3: 2026-z.md)

## Implications
None.

## Next actions
- [verify] Do thing
`;
    const r = assessWikiDraft(raw);
    expect(r.ok).toBe(true);
  });
});

