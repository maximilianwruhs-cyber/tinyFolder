/**
 * Tool System — deterministic vault/project read tools.
 */

export interface ToolResult {
  ok: boolean;
  output: string;
  structured?: unknown;
  error?: string;
  elapsed_ms: number;
}

export interface Tool {
  name: string;
  description: string;
  schema: JSONSchema;
  deterministic: boolean;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  vaultPath: string;
  taskFilePath: string;
}

export interface JSONSchema {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required: string[];
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResult;
  timestamp: string;
}
