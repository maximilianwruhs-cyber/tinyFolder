import { describe, expect, test } from "bun:test";
import { formatSearchContext, type SearchResult } from "../search";

describe("formatSearchContext", () => {
  test("returns an empty string when results array is empty", () => {
    const results: SearchResult[] = [];
    expect(formatSearchContext(results)).toBe("");
  });

  test("correctly formats a single search result", () => {
    const results: SearchResult[] = [
      {
        file: "test-file.md",
        heading: "Introduction",
        text: "This is some sample text from the vault.",
        score: 0.954,
      },
    ];

    const expected = `
## Relevant Vault Context
[1] test-file.md — Introduction (95%):
This is some sample text from the vault.`;

    expect(formatSearchContext(results)).toBe(expected);
  });

  test("correctly formats multiple search results", () => {
    const results: SearchResult[] = [
      {
        file: "file1.md",
        heading: "Heading 1",
        text: "Content 1",
        score: 0.88,
      },
      {
        file: "file2.md",
        heading: "Heading 2",
        text: "Content 2",
        score: 0.725,
      },
    ];

    const expected = `
## Relevant Vault Context
[1] file1.md — Heading 1 (88%):
Content 1

[2] file2.md — Heading 2 (73%):
Content 2`;

    expect(formatSearchContext(results)).toBe(expected);
  });
});
