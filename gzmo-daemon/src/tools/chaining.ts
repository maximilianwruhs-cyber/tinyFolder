/**
 * Tool Chaining — discover follow-up tool calls from tool results (whitelist).
 */

import type { ToolResult } from "./types";

export interface FollowUpTool {
  tool: string;
  args: Record<string, unknown>;
  confidence: number;
  reason: string;
}

export function discoverFollowUps(toolName: string, result: ToolResult): FollowUpTool[] {
  if (!result.ok) return [];
  const text = String(result.output ?? "");
  const followUps: FollowUpTool[] = [];

  if (toolName === "vault_read") {
    const refs = text.matchAll(/(?:see|refer to|in|details in)\s+([\w\-./]+\.md)/gi);
    for (const m of refs) {
      followUps.push({
        tool: "vault_read",
        args: { path: m[1], max_chars: 8000 },
        confidence: 0.7,
        reason: `Referenced file in vault_read result: ${m[1]}`,
      });
    }
  }

  if (toolName === "fs_grep") {
    const dirs = new Set<string>();
    for (const line of text.split("\n")) {
      const dirMatch = line.match(/^([\w\-./]+\/)[^/]+:\d+:/);
      if (dirMatch) dirs.add(dirMatch[1]!);
    }
    for (const d of dirs) {
      followUps.push({
        tool: "dir_list",
        args: { path: d.replace(/\/$/, ""), recursive: false },
        confidence: 0.4,
        reason: `Directory context from grep result: ${d}`,
      });
    }
  }

  return followUps.filter((f) => f.confidence >= 0.4);
}
