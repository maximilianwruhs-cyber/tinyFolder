import { describe, expect, test } from "bun:test";
import { assessWikiDraft } from "../quarantine";

describe("assessWikiDraft", () => {
  const fillerText = "This is some filler text to ensure the draft is over 200 characters long so that it does not fail the length check. We need enough text to bypass the 'too short' validation step. Adding a bit more text just to be safe and sound.";

  const validDraft = `
# Title

${fillerText}

## Evidence
- Found some clue (Entry 123: something)

## Next actions
- Investigate the clue
`;

  test("should return ok for valid draft", () => {
    const result = assessWikiDraft(validDraft);
    expect(result).toEqual({ ok: true });
  });

  test("should fail if missing Evidence section", () => {
    const draft = `
# Title

${fillerText}

## Next actions
- Investigate the clue
`;
    const result = assessWikiDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wiki_missing_evidence");
  });

  test("should fail if missing Evidence citations", () => {
    const draft = `
# Title

${fillerText}

## Evidence
- Found some clue without citation

## Next actions
- Investigate the clue
`;
    const result = assessWikiDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wiki_missing_evidence");
  });

  test("should fail if missing Next actions section", () => {
    const draft = `
# Title

${fillerText}

## Evidence
- Found some clue (Entry 123: something)
`;
    const result = assessWikiDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wiki_missing_next_actions");
  });

  test("should fail if draft is too short", () => {
    const draft = `
## Evidence
- Found clue (Entry 1: X)

## Next actions
- X
`;
    const result = assessWikiDraft(draft);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wiki_too_short");
  });
});
