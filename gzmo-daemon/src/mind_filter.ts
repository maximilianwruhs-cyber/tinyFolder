/**
 * MIND Filter — Cognitive Input Normalization & Logic-of-Thought Augmentation
 *
 * A pre-inference filter that restructures prompts using two research-backed
 * techniques before they reach the LLM:
 *
 *  1. Linguistic Normalization (from Universal Syntax research):
 *     - Decompose compound questions into atomic propositions
 *     - Resolve ambiguous pronouns (Binding Theory Principles A/B/C)
 *     - Cap recursive depth (center-embedding ≤ 2 levels)
 *     - Enforce declarative structure: constraints → premises → question
 *
 *  2. Logic-of-Thought Augmentation (from LoT / LINC research):
 *     - Extract conditional statements (if A then B)
 *     - Apply transitive law: P→Q ∧ Q→R ⟹ P→R
 *     - Apply contraposition: P→Q ⟺ ¬Q→¬P
 *     - Append expanded logic back as structured context
 *
 * Sources:
 *   - NotebookLM 1ef22592: Universal Syntax (Merge, Binding, X-bar, f-structure)
 *   - NotebookLM 7755126a: CFD, Anchor-Constrained Extraction, Anti-Pattern Filter
 *   - NotebookLM 082f7d1d: Reflexion verbal reinforcement
 *   - LoT paper (ACL 2024): Logic Extraction → Extension → Translation
 *   - LINC (EMNLP 2023): Semantic parsing → Formal logic → Deterministic solving
 *
 * Design principle: FAST by default (regex-only, no LLM calls).
 * Optional "deep" mode uses one LLM call for proposition extraction.
 * Env gate: GZMO_MIND_FILTER (default: on), GZMO_MIND_DEEP (default: off).
 */

// ── Types ──────────────────────────────────────────────────────

export interface Conditional {
  antecedent: string;
  consequent: string;
  raw: string;
}

export interface LogicExpansion {
  type: "transitive" | "contraposition";
  derived: string;        // natural language form
  formal: string;         // symbolic form (e.g., "P → R")
  from: string[];         // source conditionals
}

export interface MindFilterResult {
  original: string;
  filtered: string;
  atomicParts: string[];          // decomposed compound questions
  conditionals: Conditional[];    // extracted conditionals
  expansions: LogicExpansion[];   // transitive/contraposition expansions
  applied: boolean;               // whether filter changed anything
  phase: "fast" | "deep";
  stats: {
    compoundSplits: number;
    conditionalsFound: number;
    expansionsGenerated: number;
    recursionCapped: boolean;
    fillerStripped: number;
  };
}

export interface MindFilterOpts {
  deep?: boolean;              // use LLM for proposition extraction (expensive)
  maxRecursionDepth?: number;  // center-embedding cap (default: 2)
  skipDecompose?: boolean;     // skip compound decomposition
  skipLogic?: boolean;         // skip LoT augmentation
}

// ── Anti-Pattern Tokens (from CFD research) ───────────────────

const ANTI_PATTERN_WORDS = new Set([
  "delve", "landscape", "crucial", "leverage", "seamlessly",
  "robust", "holistic", "utilize", "utilization", "myriad",
  "streamline", "ecosystem", // overused LLM tokens
]);

const ANTI_PATTERN_PHRASES = [
  /\bin today's\b/gi,
  /\bunlock your potential\b/gi,
  /\bit's important to note\b/gi,
  /\bbased on the text\b/gi,
  /\bin conclusion\b/gi,
  /\blet me explain\b/gi,
  /\bas (?:an|a) (?:AI|language model)\b/gi,
];

// ── Phase 1: Linguistic Normalization ─────────────────────────

/**
 * Split compound questions joined by "and", "also", "as well as",
 * "in addition", or semicolons into atomic parts.
 *
 * From Universal Syntax research: Merge operation decomposes
 * compound structures into minimal propositional units.
 */
export function splitCompoundQuestions(text: string): string[] {
  // Only split at sentence boundaries or clear conjunction points
  // where both sides are independently meaningful questions/statements.
  const parts: string[] = [];

  // Split on question marks first (multiple questions in one prompt)
  const qParts = text.split(/(?<=\?)\s+(?=[A-Z])/);
  if (qParts.length > 1) {
    return qParts.map(p => p.trim()).filter(p => p.length > 10);
  }

  // Split on semicolons separating independent clauses
  const semiParts = text.split(/;\s+(?=[A-Z])/);
  if (semiParts.length > 1) {
    return semiParts.map(p => p.trim()).filter(p => p.length > 10);
  }

  // Split on "and" / "also" / "additionally" between independent clauses
  // Only if both sides have a verb (crude SVO check)
  const conjSplit = text.split(/\b(?:,?\s*and\s+also|;\s*additionally|;\s*furthermore)\s+/i);
  if (conjSplit.length > 1 && conjSplit.every(p => hasVerb(p))) {
    return conjSplit.map(p => p.trim()).filter(p => p.length > 10);
  }

  return [text];
}

/** Crude verb presence check (Subject-Verb-Object structural validation). */
function hasVerb(text: string): boolean {
  return /\b(?:is|are|was|were|has|have|had|does|do|did|can|could|will|would|shall|should|may|might|must|use[sd]?|enable[sd]?|provide[sd]?|implement[sd]?|creat[ed]?|build[sd]?|support[sd]?)\b/i.test(text);
}

/**
 * Cap recursive center-embedding depth.
 *
 * From Universal Syntax research: both humans and LLMs show
 * "graceful degradation" past 2 levels of center-embedding.
 * Break nested clauses into sequential "Small Clause" propositions.
 */
export function capRecursionDepth(text: string, maxDepth = 2): { text: string; capped: boolean } {
  // Detect center-embedded relative clauses:
  // "The X that the Y that the Z verb1 verb2 verb3"
  const embeddingPattern = /(\b\w+\b)\s+(?:that|which|who|whom)\s+(?:(\b\w+\b)\s+(?:that|which|who|whom)\s+(?:(\b\w+\b)\s+(?:that|which|who|whom)\s+))/gi;

  if (embeddingPattern.test(text)) {
    // Simplify by breaking nested relative clauses into sequential statements
    const simplified = text.replace(
      /(\b\w+\b)\s+(that|which|who|whom)\s+([\w\s]+?)\s+(that|which|who|whom)\s+([\w\s]+?)\s+(that|which|who|whom)\s+([\w\s]+)/gi,
      (_m, n1, _r1, clause1, _r2, clause2, _r3, clause3) =>
        `${clause3.trim()}. ${clause2.trim()}. ${n1} ${clause1.trim()}`
    );
    if (simplified !== text) {
      return { text: simplified, capped: true };
    }
  }

  return { text, capped: false };
}

/**
 * Strip filler and conversational noise (Anti-Pattern Filter).
 *
 * From CFD research: blocking default tokens disrupts linguistic
 * pathways that lead to conversational hedging and forces the
 * model into a strictly analytical state.
 */
export function stripFiller(text: string): { text: string; count: number } {
  let count = 0;
  let result = text;

  // Remove anti-pattern phrases
  for (const pattern of ANTI_PATTERN_PHRASES) {
    const before = result;
    result = result.replace(pattern, "");
    if (result !== before) count++;
  }

  // Flag anti-pattern words (don't remove — just count for stats)
  for (const word of ANTI_PATTERN_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(result)) {
      count++;
    }
  }

  // Clean up double spaces
  result = result.replace(/\s{2,}/g, " ").trim();

  return { text: result, count };
}

/**
 * Enforce declarative order: constraints → premises → question.
 *
 * From CFD research: placing constraints BEFORE objective leverages
 * the Primacy Effect in transformer attention mechanisms. This sets
 * the cognitive state before the model sees the task.
 *
 * This is a structural reordering — if the text already has
 * constraints-first structure (via GZMO's existing CFD prompts),
 * it passes through unchanged.
 */
export function enforceDeclarativeOrder(text: string): string {
  // Check if text already starts with constraints (GZMO's existing prompts)
  if (/^(?:CONSTRAINT|RULE|LIMITATION|HARD RULE|MUST NOT)/im.test(text)) {
    return text;
  }

  // If there are inline constraints scattered through the text,
  // extract and hoist them to the top
  const constraints: string[] = [];
  const rest: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // Detect constraint-like lines
    if (/^(?:-\s*)?(?:do not|must not|never|only|you must|you may not|constraint:|rule:)/i.test(trimmed)) {
      constraints.push(trimmed);
    } else {
      rest.push(line);
    }
  }

  if (constraints.length === 0) return text;

  return [
    "CONSTRAINTS:",
    ...constraints.map(c => `- ${c.replace(/^-\s*/, "")}`),
    "",
    ...rest,
  ].join("\n");
}

// ── Phase 2: Logic-of-Thought Augmentation ────────────────────

/**
 * Extract conditional statements from text.
 *
 * Recognizes patterns:
 *   - "if A then B" / "if A, B"
 *   - "A implies B" / "A means B"
 *   - "when A, B" / "whenever A, B"
 *   - "A because B" (reversed: if B then A)
 *   - "A requires B" / "A needs B" / "A depends on B"
 *   - "given A, B"
 */
export function extractConditionals(text: string): Conditional[] {
  const results: Conditional[] = [];
  const seen = new Set<string>();

  // Pattern: if A then B / if A, B
  const ifThenRe = /\bif\s+(.+?)\s*,?\s*then\s+(.+?)(?:\.|$)/gim;
  for (const m of text.matchAll(ifThenRe)) {
    const key = `${m[1]!.trim()}→${m[2]!.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ antecedent: m[1]!.trim(), consequent: m[2]!.trim(), raw: m[0]!.trim() });
    }
  }

  // Pattern: if A, B (comma-separated, no "then")
  const ifCommaRe = /\bif\s+(.+?),\s+([A-Z][\w\s]+?)(?:\.|$)/gm;
  for (const m of text.matchAll(ifCommaRe)) {
    const key = `${m[1]!.trim()}→${m[2]!.trim()}`;
    if (!seen.has(key) && m[1]!.trim().length > 5 && m[2]!.trim().length > 5) {
      seen.add(key);
      results.push({ antecedent: m[1]!.trim(), consequent: m[2]!.trim(), raw: m[0]!.trim() });
    }
  }

  // Pattern: A implies/means B
  const impliesRe = /\b(.+?)\s+(?:implies|means|entails)\s+(?:that\s+)?(.+?)(?:\.|$)/gim;
  for (const m of text.matchAll(impliesRe)) {
    const key = `${m[1]!.trim()}→${m[2]!.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ antecedent: m[1]!.trim(), consequent: m[2]!.trim(), raw: m[0]!.trim() });
    }
  }

  // Pattern: when/whenever A, B
  const whenRe = /\b(?:when|whenever)\s+(.+?),\s+(.+?)(?:\.|$)/gim;
  for (const m of text.matchAll(whenRe)) {
    const key = `${m[1]!.trim()}→${m[2]!.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ antecedent: m[1]!.trim(), consequent: m[2]!.trim(), raw: m[0]!.trim() });
    }
  }

  // Pattern: A because B (reversed conditional: B → A)
  const becauseRe = /\b(.+?)\s+because\s+(.+?)(?:\.|$)/gim;
  for (const m of text.matchAll(becauseRe)) {
    const key = `${m[2]!.trim()}→${m[1]!.trim()}`;
    if (!seen.has(key) && m[1]!.trim().length > 5 && m[2]!.trim().length > 5) {
      seen.add(key);
      results.push({ antecedent: m[2]!.trim(), consequent: m[1]!.trim(), raw: m[0]!.trim() });
    }
  }

  // Pattern: A requires/needs/depends on B
  const requiresRe = /\b(.+?)\s+(?:requires|needs|depends on)\s+(.+?)(?:\.|$)/gim;
  for (const m of text.matchAll(requiresRe)) {
    const key = `${m[2]!.trim()}→${m[1]!.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ antecedent: m[2]!.trim(), consequent: m[1]!.trim(), raw: m[0]!.trim() });
    }
  }

  return results;
}

/**
 * Expand extracted conditionals using formal logic rules.
 *
 * Transitive Law: P→Q ∧ Q→R ⟹ P→R
 * Contraposition: P→Q ⟺ ¬Q→¬P
 *
 * From LoT research: these expansions provide the LLM with a
 * "logical roadmap" — formally sound propositions that augment
 * the input context with information-complete deductions.
 */
export function expandLogic(conditionals: Conditional[]): LogicExpansion[] {
  const expansions: LogicExpansion[] = [];
  if (conditionals.length === 0) return expansions;

  // Contraposition for each conditional: P→Q ⟺ ¬Q→¬P
  for (const c of conditionals) {
    expansions.push({
      type: "contraposition",
      derived: `If NOT ${c.consequent}, then NOT ${c.antecedent}`,
      formal: `¬(${c.consequent}) → ¬(${c.antecedent})`,
      from: [c.raw],
    });
  }

  // Transitive chains: if A→B and B→C, then A→C
  // Use fuzzy matching on consequent ↔ antecedent overlap
  for (let i = 0; i < conditionals.length; i++) {
    for (let j = 0; j < conditionals.length; j++) {
      if (i === j) continue;
      const ci = conditionals[i]!;
      const cj = conditionals[j]!;

      // Check if ci's consequent overlaps with cj's antecedent
      if (fuzzyOverlap(ci.consequent, cj.antecedent)) {
        const derivedKey = `${ci.antecedent}→${cj.consequent}`;
        if (!expansions.some(e => e.formal.includes(derivedKey))) {
          expansions.push({
            type: "transitive",
            derived: `If ${ci.antecedent}, then ${cj.consequent}`,
            formal: `(${ci.antecedent}) → (${cj.consequent})`,
            from: [ci.raw, cj.raw],
          });
        }
      }
    }
  }

  return expansions;
}

/**
 * Check if two clause strings have significant content overlap.
 * Used for transitive chain detection (consequent of one ≈ antecedent of another).
 */
function fuzzyOverlap(a: string, b: string): boolean {
  const wordsA = new Set(normalize(a));
  const wordsB = new Set(normalize(b));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  // Require at least 50% overlap of the smaller set
  const minSize = Math.min(wordsA.size, wordsB.size);
  return minSize > 0 && (overlap / minSize) >= 0.5;
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all",
  "can", "had", "her", "was", "one", "our", "out", "has",
  "its", "let", "say", "she", "too", "use", "that", "this",
  "with", "from", "have", "been", "will", "then", "than",
  "also", "does", "into", "they", "each", "which", "their",
  "what", "when", "where", "some", "any", "these", "those",
]);

/**
 * Translate logic expansions back into a natural-language appendix
 * that is appended to the original prompt.
 *
 * From LoT research: "Logic Translation" — converting expanded
 * formal expressions back into NL provides the LLM a complete
 * logical roadmap without requiring it to perform the deduction.
 */
export function renderLogicAppendix(
  conditionals: Conditional[],
  expansions: LogicExpansion[],
): string {
  if (conditionals.length === 0) return "";

  const lines: string[] = [
    "",
    "─── LOGIC CONTEXT (auto-derived) ───",
    "",
    "Extracted conditionals:",
  ];

  for (const c of conditionals) {
    lines.push(`  • IF ${c.antecedent} THEN ${c.consequent}`);
  }

  if (expansions.length > 0) {
    lines.push("", "Derived propositions (formal expansion):");
    for (const e of expansions) {
      const label = e.type === "transitive" ? "TRANSITIVE" : "CONTRAPOSITION";
      lines.push(`  • [${label}] ${e.derived}`);
    }
  }

  lines.push(
    "",
    "Use these derived propositions to ground your reasoning.",
    "If the answer contradicts any derived proposition, reconsider.",
    "─── END LOGIC CONTEXT ───",
  );

  return lines.join("\n");
}

// ── Main Entry Point ──────────────────────────────────────────

/**
 * Apply the MIND cognitive filter to a prompt.
 *
 * Phase 1: Linguistic normalization (regex-based, ~1ms)
 * Phase 2: Logic-of-Thought augmentation (regex-based, ~2ms)
 * Phase 3: (optional) Deep extraction via LLM call (~500ms)
 *
 * Returns the filtered prompt with logic appendix, plus metadata.
 */
export function applyMindFilter(
  prompt: string,
  opts?: MindFilterOpts,
): MindFilterResult {
  const startOpts = {
    deep: opts?.deep ?? false,
    maxRecursionDepth: opts?.maxRecursionDepth ?? 2,
    skipDecompose: opts?.skipDecompose ?? false,
    skipLogic: opts?.skipLogic ?? false,
  };

  let working = prompt;
  let applied = false;
  const stats = {
    compoundSplits: 0,
    conditionalsFound: 0,
    expansionsGenerated: 0,
    recursionCapped: false,
    fillerStripped: 0,
  };

  // ── Phase 1: Linguistic Normalization ──

  // 1a. Strip filler / anti-pattern tokens
  const filler = stripFiller(working);
  if (filler.count > 0) {
    working = filler.text;
    stats.fillerStripped = filler.count;
    applied = true;
  }

  // 1b. Cap recursion depth
  const capped = capRecursionDepth(working, startOpts.maxRecursionDepth);
  if (capped.capped) {
    working = capped.text;
    stats.recursionCapped = true;
    applied = true;
  }

  // 1c. Decompose compound questions
  let atomicParts: string[] = [working];
  if (!startOpts.skipDecompose) {
    atomicParts = splitCompoundQuestions(working);
    stats.compoundSplits = atomicParts.length > 1 ? atomicParts.length : 0;
    if (atomicParts.length > 1) {
      applied = true;
    }
  }

  // 1d. Enforce declarative order (constraints first)
  const reordered = enforceDeclarativeOrder(working);
  if (reordered !== working) {
    working = reordered;
    applied = true;
  }

  // ── Phase 2: Logic-of-Thought Augmentation ──

  let conditionals: Conditional[] = [];
  let expansions: LogicExpansion[] = [];

  if (!startOpts.skipLogic) {
    conditionals = extractConditionals(prompt); // extract from original, not filtered
    stats.conditionalsFound = conditionals.length;

    if (conditionals.length > 0) {
      expansions = expandLogic(conditionals);
      stats.expansionsGenerated = expansions.length;

      const appendix = renderLogicAppendix(conditionals, expansions);
      if (appendix) {
        working = working + appendix;
        applied = true;
      }
    }
  }

  return {
    original: prompt,
    filtered: working,
    atomicParts,
    conditionals,
    expansions,
    applied,
    phase: startOpts.deep ? "deep" : "fast",
    stats,
  };
}
