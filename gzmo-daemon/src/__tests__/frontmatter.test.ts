import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { parseTask } from "../frontmatter";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("frontmatter parseTask", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gzmo-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("parses a valid task file correctly", async () => {
    const filePath = path.join(tmpDir, "valid.md");
    const content = `---\nstatus: pending\nstarted_at: "2023-01-01"\n---\nHello World`;
    fs.writeFileSync(filePath, content);

    const result = await parseTask(filePath);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.status).toBe("pending");
    expect(result?.frontmatter.started_at).toBe("2023-01-01");
    expect(result?.body).toBe("Hello World");
    expect(result?.rawContent).toBe(content);
  });

  test("returns null if status is missing", async () => {
    const filePath = path.join(tmpDir, "no-status.md");
    const content = `---\nstarted_at: "2023-01-01"\n---\nHello World`;
    fs.writeFileSync(filePath, content);

    const result = await parseTask(filePath);
    expect(result).toBeNull();
  });

  test("returns null if status is not a string", async () => {
    const filePath = path.join(tmpDir, "number-status.md");
    const content = `---\nstatus: 123\n---\nHello World`;
    fs.writeFileSync(filePath, content);

    const result = await parseTask(filePath);
    expect(result).toBeNull();
  });

  test("returns null if no valid frontmatter exists", async () => {
    const filePath = path.join(tmpDir, "no-frontmatter.md");
    const content = `Hello World\nNo frontmatter here`;
    fs.writeFileSync(filePath, content);

    const result = await parseTask(filePath);
    expect(result).toBeNull();
  });

  test("returns null if file does not exist", async () => {
    const filePath = path.join(tmpDir, "non-existent.md");
    const result = await parseTask(filePath);
    expect(result).toBeNull();
  });
});
