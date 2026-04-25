import { describe, expect, test } from "bun:test";
import { parseTypedNextAction } from "../auto_tasks";
import { assessWikiDraft } from "../quarantine";
import { assessSelfAskOutput } from "../self_ask";

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

  test("rejects generic loop-control next actions", () => {
    const raw = `# Title

## Summary
- A grounded summary bullet.

## Evidence
- Quote (Entry 2: 2026-x.md)
- Another quote (Entry 1: 2026-y.md)
- Datum (Entry 3: 2026-z.md)

## Next actions
- [verify] If this result is actionable, convert it into a concrete inbox task and validate against the vault.
`;
    const r = assessWikiDraft(raw);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wiki_generic_next_actions");
  });

  test("rejects unsupported external evidence sources", () => {
    const raw = `# Title

## Summary
- A grounded summary bullet.

## Evidence
- Quote (Entry 2: 2026-x.md)
- Another quote (Entry 1: 2026-y.md)
- Datum (Entry 3: 2026-z.md)

## Next actions
- [research] Analyze user_interaction_logs_2025-Q4.txt for missing usage patterns.
`;
    const r = assessWikiDraft(raw);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wiki_unsupported_external_evidence");
  });
});

describe("assessSelfAskOutput", () => {
  test("blocks no-signal self-ask outputs from creating tasks", () => {
    const r = assessSelfAskOutput("gap_detective", "No connection found.", ["A", "B"]);
    expect(r.signal).toBe("none");
    expect(r.nextActions).toEqual([]);
    expect(r.reasons).toContain("explicit no-signal result");
  });

  test("blocks unsupported external evidence claims", () => {
    const r = assessSelfAskOutput(
      "spaced_repetition",
      "Analyze `user_interaction_logs_2025-Q4.txt` and search_results.csv to find usage patterns.",
      ["A", "B"],
    );
    expect(r.signal).not.toBe("actionable");
    expect(r.nextActions).toEqual([]);
    expect(r.reasons).toContain("mentions unsupported external evidence");
  });

  test("promotes concrete contradictions into one scoped verify task", () => {
    const r = assessSelfAskOutput(
      "contradiction_scan",
      "1. The daemon has no quality gate. → Contradicted",
      ["2026-04-25_dream"],
    );
    expect(r.signal).toBe("actionable");
    expect(r.nextActions).toHaveLength(1);
    expect(r.nextActions[0]).toContain("[verify]");
  });
});

