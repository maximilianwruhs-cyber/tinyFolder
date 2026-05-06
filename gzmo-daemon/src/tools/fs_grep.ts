import { readFileSync, readdirSync } from "fs";
import { join, relative, resolve } from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

export const fsGrepTool: Tool = {
  name: "fs_grep",
  description: "Search file contents for a regex pattern under the vault.",
  deterministic: true,
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern" },
      path: { type: "string", description: "Directory relative to vault (default '.')" },
      max_results: { type: "number", description: "Max matches (default 20, cap 100)" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const t0 = Date.now();
    const pattern = String(args.pattern ?? "");
    const searchDir = resolve(ctx.vaultPath, String(args.path ?? ".").replace(/^\//, ""));
    const vaultRoot = resolve(ctx.vaultPath);
    const maxResults = Math.min(Number(args.max_results ?? 20), 100);

    if (!searchDir.startsWith(vaultRoot)) {
      return { ok: false, output: "", error: "Search path escapes vault", elapsed_ms: Date.now() - t0 };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      return { ok: false, output: "", error: "Invalid regex", elapsed_ms: Date.now() - t0 };
    }

    const matches: string[] = [];

    function walk(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (!e.name.startsWith(".") && e.name !== "node_modules") walk(full);
        } else if (e.isFile() && /\.(md|ts|json)$/i.test(e.name)) {
          try {
            const text = readFileSync(full, "utf-8");
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i]!)) {
                const relPath = relative(vaultRoot, full);
                matches.push(`${relPath}:${i + 1}: ${lines[i]!.trim().slice(0, 120)}`);
                if (matches.length >= maxResults) return;
              }
            }
          } catch {
            // skip
          }
        }
      }
    }

    try {
      walk(searchDir);
    } catch (e: any) {
      return { ok: false, output: "", error: e?.message ?? "walk error", elapsed_ms: Date.now() - t0 };
    }

    return {
      ok: true,
      output: matches.length > 0 ? matches.join("\n") : "(no matches)",
      elapsed_ms: Date.now() - t0,
    };
  },
};
