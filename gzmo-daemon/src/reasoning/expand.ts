/**
 * ToT node expansion — analyze → retrieve | vault_read | dir_list → reason → verify.
 */

import type { ToTNode } from "./controller";
import type { ReasoningNodeType } from "../reasoning_trace";
import type { InferenceResult } from "../inference";
import type { ToolCallRecord } from "../tools/types";
import type { ToolContext } from "../tools/types";
import type { EmbeddingStore } from "../embeddings";
import { searchVaultHybrid, type SearchResult } from "../search";
import type { StrategyInjectContext } from "../learning/ledger";

export interface ExpansionChild {
  type: ReasoningNodeType;
  prompt_summary: string;
  claims?: Array<{ text: string; confidence: number; sources: string[] }>;
}

function normalizeOllamaApiUrl(): string {
  const base0 = (process.env.OLLAMA_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return (base0.endsWith("/v1") ? base0 : `${base0}/v1`).replace(/\/v1$/, "");
}

/** Route sub-task text to retrieval strategy (whitelist only). */
export function classifyIntent(subTaskText: string): "retrieve" | "vault_read" | "dir_list" {
  const t = subTaskText.toLowerCase();
  if (/read\s+(?:the\s+)?(?:contents?|file)/.test(t)) return "vault_read";
  if (/\.md\b/.test(t) && /\b(read|open|show|load|contents)\b/.test(t)) return "vault_read";
  if (/list\s+(?:files?|directories?|folder|contents)/.test(t)) return "dir_list";
  return "retrieve";
}

/**
 * Parse confidence without false positives like "Highlight" → high.
 */
export function parseConfidence(text: string): number {
  const t = text.toLowerCase();

  if (/\bconfidence\s*[:=]\s*(?:high|0\.8|0\.9)\b/.test(t)) return 0.9;
  if (/\bconfidence\s*[:=]\s*(?:medium|0\.5|0\.6)\b/.test(t)) return 0.6;
  if (/\bconfidence\s*[:=]\s*(?:low|0\.2|0\.3)\b/.test(t)) return 0.35;

  const claimConf = t.match(/confidence\s*:\s*(high|medium|low)\b/);
  if (claimConf) {
    if (claimConf[1] === "high") return 0.9;
    if (claimConf[1] === "medium") return 0.6;
    if (claimConf[1] === "low") return 0.35;
  }

  if (/\bhigh\b/.test(t) && /\b(confidence|certainty|sure)\b/.test(t)) return 0.9;
  if (/\bmedium\b/.test(t) && /\b(confidence|certainty|sure)\b/.test(t)) return 0.6;
  if (/\blow\b/.test(t) && /\b(confidence|certainty|sure)\b/.test(t)) return 0.35;

  return 0.5;
}

export function extractVaultReadPath(summary: string): string | null {
  const m = summary.match(/(?:^|[\s/`"'])([\w\-./]+\.(?:md|txt|json|ts|tsx))(?:\s|$|[`'"])/i);
  return m?.[1]?.replace(/^\//, "") ?? null;
}

export function extractDirListPath(summary: string): string {
  const m = summary.match(/(?:in|under|at|for)\s+([\w\-./]+)/i);
  return m?.[1]?.replace(/^\//, "") ?? ".";
}

function parseStructuredVerifyBlocks(answer: string): ExpansionChild[] {
  const out: ExpansionChild[] = [];
  const blocks = answer.split(/\n{2,}/);
  for (const block of blocks) {
    const claimM = block.match(
      /CLAIM:\s*([\s\S]+?)\s*(?:\n\s*)?CONFIDENCE:\s*(High|Medium|Low)/i,
    );
    if (claimM) {
      const text = claimM[1]!.trim().replace(/\s+/g, " ");
      const level = claimM[2]!.toLowerCase();
      const conf = level === "high" ? 0.9 : level === "medium" ? 0.6 : 0.35;
      const srcM = block.match(/SOURCES:\s*([^\n]+)/i);
      const sources = srcM
        ? srcM[1]!
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter((s) => /^E\d+$/i.test(s))
            .map((s) => s.toUpperCase().replace(/^e/, "E"))
        : [];
      out.push({
        type: "verify",
        prompt_summary: text.slice(0, 100),
        claims: [{ text, confidence: conf, sources }],
      });
    }
  }
  return out;
}

export async function expandAnalyze(
  _node: ToTNode,
  systemPrompt: string,
  userPrompt: string,
  inferDetailedFn: (s: string, p: string, o?: import("../inference").InferDetailedOptions) => Promise<InferenceResult>,
  temp: number,
  maxTok: number,
  pastTraceContext?: string,
  strategyContext?: StrategyInjectContext,
): Promise<ExpansionChild[]> {
  const contextBlock = pastTraceContext
    ? `\n\nPast similar tasks succeeded with this approach:\n${pastTraceContext}\n`
    : "";

  const strategyBlock = strategyContext
    ? `\n\n## Strategy guidance (from past performance)\n\n${[
        ...(strategyContext.tips ?? []).map((t) => `${t.kind === "positive" ? "✓ Effective" : "✗ Avoid"}: ${t.style} — ${t.reason}`),
        strategyContext.winningPattern ? `Winning pattern: ${strategyContext.winningPattern.promptFragment}` : "",
        strategyContext.recentFailureContext ?? "",
      ]
        .filter(Boolean)
        .join("\n")}\n`
    : "";

  const decompositionPrompt = [
    "Decompose the following task into 2–4 concrete sub-tasks.",
    contextBlock,
    strategyBlock,
    "Each sub-task should be independently verifiable.",
    "Output as a numbered list. Be concise.",
    "",
    "Task:",
    userPrompt,
  ].join("\n");

  const result = await inferDetailedFn(systemPrompt, decompositionPrompt, { temperature: temp, maxTokens: maxTok });
  const lines = result.answer.split("\n").filter((l) => /^\s*\d+[\).]\s+/.test(l.trim()));

  const children: ExpansionChild[] = lines.slice(0, 4).map((line) => {
    const text = line
      .trim()
      .replace(/^\d+[\).]\s*/, "")
      .slice(0, 200);
    const intent = classifyIntent(text);
    return {
      type: intent as ReasoningNodeType,
      prompt_summary: `Sub-task: ${text.slice(0, 120)}`,
    };
  });

  if (children.length === 0) {
    children.push({
      type: "retrieve",
      prompt_summary: `Full query: ${userPrompt.slice(0, 120)}`,
    });
  }

  return children;
}

/** Unified retrieval: hybrid search and/or deterministic tools by node type. */
export async function expandRetrievalBranch(
  node: ToTNode,
  store: EmbeddingStore | undefined,
  toolEnabled: boolean,
  toolCtx: ToolContext,
  maxToolCalls: number,
): Promise<{ children: ExpansionChild[]; evidence: SearchResult[]; toolRecords: ToolCallRecord[]; toolFacts: string }> {
  const ollamaUrl = normalizeOllamaApiUrl();
  const userPrompt = node.prompt_summary;
  let results: SearchResult[] = [];
  const toolRecords: ToolCallRecord[] = [];

  if (node.type === "retrieve") {
    results = store ? await searchVaultHybrid(userPrompt, store, ollamaUrl, { topK: 6, mode: "fast" }) : [];

    if (toolEnabled && results.length === 0 && maxToolCalls > 0) {
      const { dispatchTool } = await import("../tools/registry");
      const keywords = userPrompt.split(/\s+/).filter((w) => w.length > 4).slice(0, 3);
      let calls = 0;
      for (const kw of keywords) {
        if (calls >= maxToolCalls) break;
        const { record } = await dispatchTool("fs_grep", { pattern: kw, max_results: 5 }, toolCtx);
        toolRecords.push(record);
        calls++;
      }
    }
  } else if (node.type === "vault_read" && toolEnabled && maxToolCalls > 0) {
    const { dispatchTool } = await import("../tools/registry");
    const rel = extractVaultReadPath(userPrompt);
    if (rel) {
      const { record } = await dispatchTool("vault_read", { path: rel, max_chars: 8000 }, toolCtx);
      toolRecords.push(record);
    }
  } else if (node.type === "dir_list" && toolEnabled && maxToolCalls > 0) {
    const { dispatchTool } = await import("../tools/registry");
    const dirPath = extractDirListPath(userPrompt);
    const { record } = await dispatchTool("dir_list", { path: dirPath, recursive: false }, toolCtx);
    toolRecords.push(record);
  }

  const toolFacts = toolRecords
    .filter((r) => r.result.ok && r.result.output && r.result.output !== "(no matches)")
    .map((r) => `[tool:${r.tool}]\n${r.result.output}`)
    .join("\n\n");

  const children: ExpansionChild[] = [
    {
      type: "reason",
      prompt_summary: `Reason over ${results.length + (toolFacts ? 1 : 0)} evidence source(s)`,
    },
  ];

  return { children, evidence: results, toolRecords, toolFacts };
}

export async function expandReason(
  _node: ToTNode,
  systemPrompt: string,
  evidenceContext: string,
  userPrompt: string,
  inferDetailedFn: (s: string, p: string, o?: import("../inference").InferDetailedOptions) => Promise<InferenceResult>,
  temp: number,
  maxTok: number,
  retryHint?: string,
): Promise<ExpansionChild[]> {
  const reasoningPrompt = [
    evidenceContext,
    "",
    "Based ONLY on the evidence above, produce up to 3 claims.",
    "Preferred format (one block per claim):",
    "CLAIM: <single sentence>",
    "CONFIDENCE: High | Medium | Low",
    "SOURCES: E1, E2 (evidence IDs from the packet above)",
    "",
    "If evidence is insufficient, output a single CLAIM stating insufficient evidence with CONFIDENCE: Low.",
    retryHint ? `\nRetry focus:\n${retryHint}\n` : "",
    "Task:",
    userPrompt,
  ].join("\n");

  const result = await inferDetailedFn(systemPrompt, reasoningPrompt, { temperature: temp, maxTokens: maxTok });

  const structured = parseStructuredVerifyBlocks(result.answer);
  if (structured.length > 0) return structured.slice(0, 3);

  const claimLines = result.answer.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 10 && (t.startsWith("-") || /^\d+[\).]\s+/.test(t));
  });

  const children: ExpansionChild[] = claimLines.slice(0, 3).map((line) => {
    const text = line.replace(/^[-\d\).\s]+/, "").trim();
    return {
      type: "verify" as const,
      prompt_summary: text.slice(0, 100),
      claims: [{ text, confidence: parseConfidence(text), sources: [] }],
    };
  });

  if (children.length === 0) {
    children.push({
      type: "verify",
      prompt_summary: "insufficient evidence for structured claims",
      claims: [
        {
          text: result.answer.slice(0, 400) || "insufficient evidence",
          confidence: 0.2,
          sources: [],
        },
      ],
    });
  }

  return children;
}
