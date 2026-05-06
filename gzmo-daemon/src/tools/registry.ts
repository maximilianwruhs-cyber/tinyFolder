import type { Tool, ToolContext, ToolResult, ToolCallRecord } from "./types";
import { vaultReadTool } from "./vault_read";
import { fsGrepTool } from "./fs_grep";
import { dirListTool } from "./dir_list";

export const TOOL_REGISTRY: Tool[] = [vaultReadTool, fsGrepTool, dirListTool];

export function getTool(name: string): Tool | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: ToolResult; record: ToolCallRecord }> {
  const tool = getTool(name);
  if (!tool) {
    const result: ToolResult = { ok: false, output: "", error: `Unknown tool: ${name}`, elapsed_ms: 0 };
    return { result, record: { tool: name, args, result, timestamp: new Date().toISOString() } };
  }

  const result = await tool.execute(args, ctx);
  const record: ToolCallRecord = { tool: name, args, result, timestamp: new Date().toISOString() };
  return { result, record };
}
