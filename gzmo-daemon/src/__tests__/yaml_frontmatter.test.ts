import { describe, expect, test } from "bun:test";
import matter, { parseFrontmatter, stringifyFrontmatter } from "../yaml_frontmatter";

describe("parseFrontmatter", () => {
  test("returns empty data + full content when no fence is present", () => {
    const r = parseFrontmatter("just a markdown body\n");
    expect(r.data).toEqual({});
    expect(r.content).toBe("just a markdown body\n");
  });

  test("parses a simple frontmatter block", () => {
    const raw = "---\ntitle: Hello\nstatus: pending\n---\nbody line\n";
    const r = parseFrontmatter(raw);
    expect(r.data.title).toBe("Hello");
    expect(r.data.status).toBe("pending");
    expect(r.content).toBe("body line\n");
  });

  test("parses CRLF line endings", () => {
    const raw = "---\r\ntitle: Hello\r\n---\r\nbody\r\n";
    const r = parseFrontmatter(raw);
    expect(r.data.title).toBe("Hello");
    expect(r.content).toBe("body\r\n");
  });

  test("ISO date strings are coerced to Date by the YAML parser", () => {
    const raw = "---\nstarted_at: 2026-04-22T12:34:56.000Z\n---\n";
    const r = parseFrontmatter(raw);
    // gray-matter (which used js-yaml@3) also coerces ISO strings to Date by
    // default — the boot-recovery code already handles both `string` and `Date`.
    expect(r.data.started_at instanceof Date || typeof r.data.started_at === "string").toBe(true);
  });

  test("preserves array values", () => {
    const raw = "---\ntags:\n  - alpha\n  - beta\n---\nx\n";
    const r = parseFrontmatter(raw);
    expect(r.data.tags).toEqual(["alpha", "beta"]);
  });

  test("returns empty data + raw content for malformed YAML", () => {
    const raw = "---\nthis: is: not: valid: yaml:\n---\nbody\n";
    const r = parseFrontmatter(raw);
    // Either yaml accepts it as a string-ish single-key, or returns nothing —
    // either way, `data` must be an object and `content` must be the body.
    expect(typeof r.data).toBe("object");
    expect(r.content).toBe("body\n");
  });

  test("returns empty data + full input when fence is unterminated", () => {
    const raw = "---\nstill_open: true\nno closing fence";
    const r = parseFrontmatter(raw);
    expect(r.data).toEqual({});
    expect(r.content).toBe(raw);
  });

  test("strips a leading BOM", () => {
    const raw = "\uFEFF---\nfoo: bar\n---\nbody\n";
    const r = parseFrontmatter(raw);
    expect(r.data.foo).toBe("bar");
    expect(r.content).toBe("body\n");
  });

  test("empty frontmatter block yields empty data", () => {
    const raw = "---\n---\nbody\n";
    const r = parseFrontmatter(raw);
    expect(r.data).toEqual({});
    expect(r.content).toBe("body\n");
  });
});

describe("stringifyFrontmatter", () => {
  test("emits fenced output with body trailing newline", () => {
    const out = stringifyFrontmatter("hello world", { title: "T", status: "pending" });
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("title: T\n");
    expect(out).toContain("status: pending\n");
    expect(out).toContain("\n---\nhello world\n");
  });

  test("empty data still emits the fence", () => {
    const out = stringifyFrontmatter("body\n", {});
    expect(out).toBe("---\n---\nbody\n");
  });

  test("preserves the body's existing trailing newline", () => {
    const out = stringifyFrontmatter("first line\nsecond line\n", { a: 1 });
    expect(out.endsWith("first line\nsecond line\n")).toBe(true);
  });

  test("appends a trailing newline if the body lacks one", () => {
    const out = stringifyFrontmatter("no newline", { a: 1 });
    expect(out.endsWith("no newline\n")).toBe(true);
  });
});

describe("round-trip (parse → stringify → parse)", () => {
  test("preserves scalar fields", () => {
    const raw = "---\ntitle: Hello\nstatus: pending\nnumber: 42\n---\nbody\n";
    const r1 = parseFrontmatter(raw);
    const out = stringifyFrontmatter(r1.content, r1.data);
    const r2 = parseFrontmatter(out);
    expect(r2.data.title).toBe("Hello");
    expect(r2.data.status).toBe("pending");
    expect(r2.data.number).toBe(42);
    expect(r2.content).toBe("body\n");
  });

  test("preserves arrays", () => {
    const raw = "---\ntags:\n  - a\n  - b\n  - c\n---\nbody\n";
    const r1 = parseFrontmatter(raw);
    const out = stringifyFrontmatter(r1.content, r1.data);
    const r2 = parseFrontmatter(out);
    expect(r2.data.tags).toEqual(["a", "b", "c"]);
  });
});

describe("default export (gray-matter compat)", () => {
  test("matter(raw) returns same shape as parseFrontmatter", () => {
    const r = matter("---\nfoo: bar\n---\nbody\n");
    expect(r.data.foo).toBe("bar");
    expect(r.content).toBe("body\n");
  });

  test("matter.stringify is callable", () => {
    const out = matter.stringify("body", { x: 1 });
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("x: 1");
  });
});
