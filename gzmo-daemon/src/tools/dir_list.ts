import { readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import type { Tool, ToolContext, ToolResult } from "./types";

export const dirListTool: Tool = {
  name: "dir_list",
  description: "List files under a path relative to the vault root.",
  deterministic: true,
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative directory" },
      recursive: { type: "boolean", description: "Recursive listing" },
    },
    required: ["path"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const t0 = Date.now();
    const relPath = String(args.path ?? "").replace(/^\//, "");
    const dir = resolve(ctx.vaultPath, relPath);
    const vaultRoot = resolve(ctx.vaultPath);
    const recursive = Boolean(args.recursive);

    if (!dir.startsWith(vaultRoot)) {
      return { ok: false, output: "", error: "Path escapes vault", elapsed_ms: Date.now() - t0 };
    }

    const lines: string[] = [];
    function walk(d: string, prefix = "") {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const rel = relative(vaultRoot, join(d, e.name));
        const st = statSync(join(d, e.name));
        const size = st.isFile() ? `${(st.size / 1024).toFixed(1)}KB` : "dir";
        lines.push(`${prefix}${e.name} (${size})`);
        if (recursive && st.isDirectory()) walk(join(d, e.name), prefix + "  ");
      }
    }

    try {
      walk(dir);
      return { ok: true, output: lines.join("\n") || "(empty directory)", elapsed_ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, output: "", error: e?.message ?? "list error", elapsed_ms: Date.now() - t0 };
    }
  },
};
