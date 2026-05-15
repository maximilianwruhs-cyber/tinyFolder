import type { Tool, ToolContext, ToolResult } from "./types";
import { assertVaultFileNotSymlink, resolveVaultPath } from "../vault_fs";

export const vaultReadTool: Tool = {
  name: "vault_read",
  description: "Read the contents of a file relative to the vault root.",
  deterministic: true,
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative path from vault root" },
      max_chars: { type: "number", description: "Max characters (default 8000)" },
    },
    required: ["path"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const t0 = Date.now();
    const rel = String(args.path ?? "").replace(/^\//, "").replace(/\.\./g, "");
    if (!rel) {
      return { ok: false, output: "", error: "Missing path", elapsed_ms: Date.now() - t0 };
    }
    try {
      const { abs } = resolveVaultPath(ctx.vaultPath, rel);
      await assertVaultFileNotSymlink(abs);
      const exists = await Bun.file(abs).exists();
      if (!exists) {
        return { ok: false, output: "", error: `File not found: ${rel}`, elapsed_ms: Date.now() - t0 };
      }
      const text = await Bun.file(abs).text();
      const maxChars = Number(args.max_chars ?? 8000);
      const clipped = text.length > maxChars ? text.slice(0, maxChars) + "\n..." : text;
      return { ok: true, output: clipped, elapsed_ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, output: "", error: e?.message ?? "read error", elapsed_ms: Date.now() - t0 };
    }
  },
};
