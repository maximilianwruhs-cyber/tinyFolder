import type { ChaosSnapshot } from "../types";
import { Phase } from "../types";

export type TaskAction = "think" | "search" | "chain";

export function parseAction(frontmatter: Record<string, unknown>): TaskAction {
  const action = String(frontmatter.action ?? "think").toLowerCase();
  if (action === "search" || action === "chain") return action;
  return "think";
}

export function phasePersona(phase: Phase): string {
  switch (phase) {
    case Phase.Idle:  return "You are calm and reflective. Prioritize clarity and precision.";
    case Phase.Build: return "You are alert and focused. Be thorough and structured.";
    case Phase.Drop:  return "You are under pressure. Be decisive and direct. No hedging.";
  }
}

export function valenceDirective(valence: number): string {
  if (valence < -0.5) return " Approach with caution — flag risks and uncertainties.";
  if (valence < -0.15) return " Be measured and analytical.";
  if (valence > 0.5) return " Be exploratory and confident — suggest bold connections.";
  if (valence > 0.15) return " Be constructive and forward-looking.";
  return ""; 
}

export function verbosityDirective(maxTokens: number): string {
  if (maxTokens < 500) return " Keep your response concise — under 150 words.";
  if (maxTokens > 700) return " You may elaborate and explore in detail.";
  return ""; 
}

export function buildSystemPrompt(
  snap?: ChaosSnapshot,
  vaultContext?: string,
  memoryContext?: string,
  projectGrounding?: string,
): string {
  let prompt = [
    "You are GZMO, a sovereign local AI daemon running on this machine.",
    "GZMO is your name, not an acronym. You are NOT a fictional character.",
    "Respond in Markdown.",
    "",
    "Hard constraints:",
    "- Follow the task's requested structure exactly (headings, bullet counts, 'exactly N', etc.).",
    "- Do not invent information. If something is not present in the task (or provided context), say so explicitly and keep it brief.",
    "- If asked to quote text, quote it verbatim from the task/context.",
  ].join("\n");

  if (snap) {
    prompt += " " + phasePersona(snap.phase);
    prompt += valenceDirective(snap.llmValence);
    prompt += verbosityDirective(snap.llmMaxTokens);
    prompt += ` [T:${snap.tension.toFixed(0)} E:${snap.energy.toFixed(0)}% ${snap.phase} V:${snap.llmValence >= 0 ? "+" : ""}${snap.llmValence.toFixed(2)}]`;
  }

  if (vaultContext) {
    prompt += [
      "",
      "Grounding rules (when context is provided):",
      "- Treat the 'Evidence Packet' as the only allowed evidence source.",
      "- Every answer MUST include at least one evidence citation like [E1].",
      "- For each non-trivial claim, cite evidence by ID like [E2].",
      "- If evidence is missing, say 'insufficient evidence' and suggest the next deterministic check (still cite what you did have).",
      "- Never claim you wrote/changed files unless the evidence packet contains it explicitly.",
      "",
      vaultContext,
    ].join("\n");
  }

  if (projectGrounding) {
    prompt += [
      "",
      "Project grounding (deterministic):",
      projectGrounding.trim(),
    ].join("\n");
  }

  if (memoryContext) {
    prompt += memoryContext;
  }

  return prompt;
}

export function shouldInjectProjectGrounding(action: TaskAction, body: string): boolean {
  if (action === "search") return false; 
  const q = String(body ?? "").toLowerCase();
  return (
    q.includes("this project") ||
    q.includes("this system") ||
    q.includes("in this vault") ||
    q.includes("knowledge base") ||
    q.includes("ingest") ||
    q.includes("raw") ||
    q.includes("wiki") ||
    q.includes("embeddings") ||
    q.includes("rag") ||
    q.includes("eval") ||
    q.includes("telemetry") ||
    q.includes("health")
  );
}

export function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

export function readIntEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const v = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(v)) return defaultValue;
  return Math.max(min, Math.min(max, v));
}

export function isProofTask(fileName: string): boolean {
  return /PROOF/i.test(fileName) || /TEST/i.test(fileName);
}

export function extractExplicitVaultMdPaths(text: string): string[] {
  const paths: string[] = [];
  const regex = /(?:file:\/\/\/[^\s]+|\[.*?\]\([^\s]+(?:md)\)|[\w/\-]+\.md)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    let m = match[0];
    m = m.replace(/^file:\/\/\//, "");
    m = m.replace(/^\[.*?\]\(/, "").replace(/\)$/, "");
    if (m.endsWith(".md")) {
      paths.push(m);
    }
  }
  return paths;
}
