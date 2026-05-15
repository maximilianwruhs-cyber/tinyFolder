import type { ChaosSnapshot } from "../types";
import { Phase } from "../types";
import { wrapWithTripartiteLayers } from "./tripartite_identity";

export type TaskAction = "think" | "search" | "chain";

export function parseAction(frontmatter: Record<string, unknown>): TaskAction {
  const action = String(frontmatter.action ?? "think").toLowerCase();
  if (action === "search" || action === "chain") return action;
  return "think";
}

// ── Phase Contracts (structural output rules, not personas) ───────
function phaseContract(phase: Phase): string {
  switch (phase) {
    case Phase.Idle:
      return [
        "- Format: exactly 1 paragraph, under 100 words.",
        "- No citations required unless the task explicitly asks for evidence.",
        "- Start with the core idea. No preamble or summary sentence.",
      ].join("\n");
    case Phase.Build:
      return [
        "- Format: bullet points, 3–7 items.",
        "- Each non-trivial claim MUST cite evidence as [E#].",
        "- If evidence is missing, write 'insufficient evidence' and stop; do not elaborate.",
        "- No preamble. Start directly with the first bullet.",
      ].join("\n");
    case Phase.Drop:
      return [
        "- Format: a single declarative sentence (or 2 if grammatically unavoidable).",
        "- State the conclusion first. No hedging words (maybe, perhaps, likely, possibly, seems).",
        "- If the answer is uncertain, say 'I do not know' rather than hedging.",
      ].join("\n");
  }
}

// ── Valence Rules (evidence density, not mood) ─────────────────────
function valenceEvidenceRule(valence: number): string {
  if (valence < -0.5) return "- High-skepticism mode: require 2+ distinct evidence citations for every non-trivial claim.";
  if (valence < -0.15) return "- Standard evidence mode: cite at least one source per non-trivial claim.";
  if (valence > 0.5) return "- Synthesis mode: you may connect ideas beyond explicit evidence. Mark speculative leaps with *(synthesis)*.";
  if (valence > 0.15) return "- Constructive mode: cite evidence where available, then suggest 1–2 concrete next steps.";
  return "- Standard evidence rules apply.";
}

// ── Token Directive (aligns with API maxTokens) ────────────────────
function tokenDirective(maxTokens: number): string {
  if (maxTokens < 500) return "- Concise mode: one idea per sentence. No examples unless the task demands them.";
  if (maxTokens > 700) return "- Long-form mode: elaborate with examples, step-by-step reasoning, and edge-case notes where relevant.";
  return "";
}

export function buildSystemPrompt(
  snap?: ChaosSnapshot,
  vaultContext?: string,
  memoryContext?: string,
  projectGrounding?: string,
): string {
  const parts: string[] = [];

  // 1. Runtime state header (structured, at the top)
  if (snap) {
    parts.push(
      "## GZMO Runtime State",
      `phase: ${snap.phase}`,
      `temperature: ${snap.llmTemperature.toFixed(2)} (${snap.llmTemperature > 0.9 ? "high creativity" : snap.llmTemperature < 0.5 ? "conservative" : "balanced"})`,
      `max_tokens: ${snap.llmMaxTokens}`,
      `valence: ${snap.llmValence >= 0 ? "+" : ""}${snap.llmValence.toFixed(2)}`,
      "",
    );
  }

  // 2. Identity and base constraints
  parts.push(
    "You are GZMO, a sovereign local AI daemon running on this machine.",
    "GZMO is your name, not an acronym. You are NOT a fictional character.",
    "Respond in Markdown.",
    "",
    "Hard constraints:",
    "- Follow the task's requested structure exactly (headings, bullet counts, 'exactly N', etc.).",
    "- Do not invent information. If something is not present in the task (or provided context), say so explicitly and keep it brief.",
    "- If asked to quote text, quote it verbatim from the task/context.",
    "",
  );

  // 3. Phase contract + valence + token directives
  if (snap) {
    parts.push("## Output Contract");
    parts.push(phaseContract(snap.phase));
    parts.push(valenceEvidenceRule(snap.llmValence));
    const tok = tokenDirective(snap.llmMaxTokens);
    if (tok) parts.push(tok);
    parts.push("");
  }

  // 4. Vault grounding
  if (vaultContext) {
    parts.push(
      "Grounding rules (when context is provided):",
      "- Treat the 'Evidence Packet' as the only allowed evidence source.",
      "- Every answer MUST include at least one evidence citation like [E1].",
      "- For each non-trivial claim, cite evidence by ID like [E2].",
      "- If evidence is missing, say 'insufficient evidence' and suggest the next deterministic check (still cite what you did have).",
      "- Never claim you wrote/changed files unless the evidence packet contains it explicitly.",
      "",
      vaultContext,
      "",
    );
  }

  // 5. Project grounding
  if (projectGrounding) {
    parts.push(
      "Project grounding (deterministic):",
      projectGrounding.trim(),
      "",
    );
  }

  // 6. Memory context
  if (memoryContext) {
    parts.push(memoryContext);
  }

  const joined = parts.join("\n");
  if (readBoolEnv("GZMO_TRIPARTITE_PROMPTS", false)) {
    return wrapWithTripartiteLayers(joined, "Complete the user task per the layers below.");
  }
  return joined;
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
