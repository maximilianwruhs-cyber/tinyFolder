import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { GUIDANCE_CONTRACTS } from "../guidance_contract";

describe("guidance contract surfaces", () => {
  for (const c of GUIDANCE_CONTRACTS) {
    test(`contract: ${c.id} (${c.path})`, () => {
      const abs = resolve(process.cwd(), c.path);
      const text = readFileSync(abs, "utf-8");
      for (const p of c.requiredPatterns) {
        expect(text).toMatch(p);
      }
    });
  }
});

