/**
 * engine.ts — The GZMO inference engine (Smart Core v0.3.0)
 *
 * Now with:
 * - Task routing via `action:` frontmatter
 * - Vault search via nomic-embed-text embeddings
 * - Episodic memory for cross-task continuity
 * - Chaos-aware LLM parameter modulation
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { type TaskStatus } from "./frontmatter";
import type { TaskEvent } from "./watcher";
import type { VaultWatcher } from "./watcher";
import { resolve, relative } from "path";
import type { ChaosSnapshot } from "./types";
import { Phase } from "./types";
import type { PulseLoop } from "./pulse";
import type { EmbeddingStore } from "./embeddings";
import { searchVaultHybrid, type SearchResult } from "./search";
import { TaskMemory } from "./memory";
import { safeWriteText } from "./vault_fs";
import { gatherLocalFacts } from "./local_facts";
import { selfEvalAndRewrite } from "./self_eval";
import { gatherVaultStateIndex } from "./vault_state_index";
import { compileEvidencePacket, compileEvidencePacketMulti, renderEvidencePacket, renderEvidencePacketMulti, type EvidencePacket, type EvidencePacketMulti } from "./evidence_packet";
import { formatSearchCitations } from "./citation_formatter";
import { verifySafety } from "./verifier_safety";
import { detectRequiredParts, enforceExactBulletCount, enforceOneSentencePerBullet, enforceRequiredPartsCoverage, shapePreservingFailClosed } from "./response_shape";
import { buildProjectGrounding } from "./project_grounding";
import { checkChainChecklist, enforceChainChecklist } from "./chain_enforce";
import { enforcePerPartCitations } from "./part_citations";
import { appendTaskPerf } from "./perf";
import { OUTPUTS_REGISTRY } from "./outputs_registry";
import { shadowJudge } from "./shadow_judge";
import { applyPartQueryHooks, applyPostAnswerHooks, applyPostEvidenceMultiHooks, defaultEngineHooks } from "./engine_hooks";
import { routeJudgeMultipart } from "./route_judge";
import { atomicWriteJson } from "./vault_fs";
import { applyMindFilter } from "./mind_filter";
import { SearchPipeline } from "./pipelines/search_pipeline";
import { ThinkPipeline } from "./pipelines/think_pipeline";

// ── Configuration ──────────────────────────────────────────
function normalizeOllamaV1BaseUrl(raw: string | undefined): string {
  const base0 = (raw ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return base0.endsWith("/v1") ? base0 : `${base0}/v1`;
}

const OLLAMA_BASE_URL = normalizeOllamaV1BaseUrl(process.env.OLLAMA_URL);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "hermes3:8b";
const OLLAMA_API_URL = normalizeOllamaV1BaseUrl(process.env.OLLAMA_URL).replace(/\/v1$/, "");

// ── Provider Setup ─────────────────────────────────────────
const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: OLLAMA_BASE_URL,
});

// ── Task Actions ───────────────────────────────────────────
type TaskAction = "think" | "search" | "chain";

function parseAction(frontmatter: Record<string, unknown>): TaskAction {
  const action = String(frontmatter.action ?? "think").toLowerCase();
  if (action === "search" || action === "chain") return action;
  return "think";
}


// ── Phase Persona ──────────────────────────────────────────

// ── Valence Coloring ───────────────────────────────────────

// ── Verbosity Control (from Lorenz z-axis) ─────────────

// ── System Prompt (chaos-modulated) ────────────────────────





function proofAnswerViolations(answer: string): string[] {
  const a = String(answer ?? "").trim();
  const violations: string[] = [];
  if (!a) return ["empty_answer"];

  // Require at least one evidence citation somewhere.
  if (!/\[E\d+\]/.test(a)) violations.push("missing_any_evidence_citation");

  // For bullet/checklist style answers, require evidence per line item.
  // This is intentionally simple: it's a proof harness, not a formatter.
  const lines = a.split("\n");
  const itemLines = lines.filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (t.startsWith("- ")) return true;
    if (/^\d+\.\s+/.test(t)) return true;
    if (t.startsWith("- [ ]") || t.startsWith("- [x]") || t.startsWith("- [X]")) return true;
    return false;
  });
  if (itemLines.length > 0) {
    const bad = itemLines.filter((l) => !/\[E\d+\]/.test(l));
    if (bad.length > 0) violations.push(`missing_evidence_on_${bad.length}_list_item_lines`);
  }

  // If claiming insufficient evidence, it must be explicit.
  // (We don't ban it; we just require it be stated plainly.)
  if (/insufficient/i.test(a) && !/insufficient evidence/i.test(a)) {
    violations.push("insufficient_not_explicitly_stated_as_insufficient_evidence");
  }

  return violations;
}

function extractExplicitVaultMdPaths(prompt: string): string[] {
  const q = String(prompt ?? "");
  const matches = [...q.matchAll(/(?:^|[\s`"'(])((?:wiki|GZMO|docs)\/[A-Za-z0-9_\-./]+\.md)(?=$|[\s`"'),.;:!?])/g)];
  const out = matches.map((m) => (m[1] ?? "").trim()).filter(Boolean);
  // Preserve order, unique
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of out) {
    if (seen.has(p)) continue;
    seen.add(p);
    uniq.push(p);
  }
  return uniq;
}

// ── Standalone Inference (for DreamEngine / SelfAsk) ────────
export async function infer(system: string, prompt: string): Promise<string> {
  // MIND pre-inference filter: normalize prompt structure and augment
  // with Logic-of-Thought context before it reaches the LLM.
  let inferPrompt = prompt;
  const mindEnabled = String(process.env.GZMO_MIND_FILTER ?? "on").toLowerCase() !== "off";
  if (mindEnabled) {
    const mind = applyMindFilter(prompt, {
      deep: String(process.env.GZMO_MIND_DEEP ?? "off").toLowerCase() === "on",
    });
    if (mind.applied) {
      inferPrompt = mind.filtered;
      console.log(`[MIND] Filter applied: ${mind.stats.conditionalsFound} conditionals, ${mind.stats.expansionsGenerated} expansions, ${mind.stats.fillerStripped} filler stripped`);
    }
  }

  const result = streamText({
    model: ollama(OLLAMA_MODEL),
    system,
    prompt: inferPrompt,
  });
  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  // Strip out thinking blocks (Qwen3 emits both <think> and <thinking> formats)
  text = text.replace(/<think>[\s\S]*?<\/think>\n?/g, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, "")
    .trim();
  return text;
}

// ── Task Processor (Smart Core) ────────────────────────────
export async function processTask(
  event: TaskEvent,
  watcher: VaultWatcher,
  pulse?: PulseLoop,
  embeddingStore?: EmbeddingStore,
  memory?: TaskMemory,
): Promise<void> {
  const { filePath, fileName, body, frontmatter, document } = event;
  const vaultRoot = filePath.split(/[\\\/]GZMO[\\\/]/)[0] ?? resolve(filePath, "../../..");
  const startTime = Date.now();
  const spans: Array<{ name: string; ms: number }> = [];
  const hooks = defaultEngineHooks();

  const span = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try { return await fn(); }
    finally { spans.push({ name, ms: Date.now() - t0 }); }
  };
  const spanSync = <T>(name: string, fn: () => T): T => {
    const t0 = Date.now();
    try { return fn(); }
    finally { spans.push({ name, ms: Date.now() - t0 }); }
  };

  watcher.lockFile(filePath);

  pulse?.emitEvent({
    type: "task_received",
    fileName,
    action: String(frontmatter?.action ?? "think"),
    bodyLength: String(body ?? "").length,
  });

  try {
    const action = parseAction(frontmatter ?? {});
    console.log(`[ENGINE] Processing: ${fileName} (action: ${action})`);

    await span("frontmatter.processing", () => document.markProcessing());
    const req = { event, pulse, embeddingStore, memory, hooks, vaultRoot };

    const pipeline = action === "search" ? new SearchPipeline() : new ThinkPipeline();
    const ctx = await pipeline.prepare(req);

    const snap = pulse?.snapshot();
    const temp = snap?.llmTemperature ?? 0.7;
    const maxTok = snap?.llmMaxTokens ?? 400;
    const valence = snap?.llmValence ?? 0;
    console.log(`[ENGINE] Model: ${OLLAMA_MODEL} (temp: ${temp.toFixed(2)}, tokens: ${maxTok}, val: ${valence >= 0 ? "+" : ""}${valence.toFixed(2)}, phase: ${snap?.phase ?? "?"})`);

    let rawOutput = ctx.deterministicAnswer;
    const usedDeterministic = Boolean(rawOutput);
    
    if (!usedDeterministic) {
      // Apply MIND filter to the user prompt (normalizes linguistics, expands logic)
      const mind = applyMindFilter(body);
      const systemPrompt = ctx.systemPrompt;
      
      const result = streamText({
        model: ollama(OLLAMA_MODEL),
        system: systemPrompt,
        prompt: mind.filtered,
        temperature: temp,
        maxTokens: maxTok,
      } as any);

      rawOutput = "";
      await span("llm.stream", async () => {
        for await (const chunk of result.textStream) {
          rawOutput += chunk;
        }
      });
      
      rawOutput = rawOutput
        .replace(/<think>[\s\S]*?<\/think>\n?/g, "")
        .replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, "")
        .trim();
    }
    
    if (!rawOutput) {
      rawOutput = "_[GZMO produced internal reasoning but no visible output.]_";
    }

    let fullText = await pipeline.validateAndShape(rawOutput, req, ctx);
    
    const output = `\n---\n\n## GZMO Response\n*${new Date().toISOString()}*\n\n${fullText}`;
    await span("frontmatter.completed", () => document.markCompleted(output));

    console.log(`[ENGINE] Completed: ${fileName} (${action})`);

    if (!usedDeterministic && action !== "search" && ctx.state.projectAllowedPaths?.length > 0) {
      const verdict = spanSync("safety.verify.nonsearch", () => verifySafety({
        answer: fullText,
        packet: { snippets: [{ id: "E1", kind: "local_facts", text: ctx.state.projectGrounding || "" }], allowedPaths: ctx.state.projectAllowedPaths },
      }));
      if (verdict) {
        fullText = [
          "insufficient evidence to name file paths safely.",
          "",
          `Reason: ${verdict}`,
          "",
          "Next deterministic check: use action: search and ask for the exact path(s), or consult the Project grounding block paths.",
        ].join("\n");
        // We re-write the completed task to fail-closed
        await document.markCompleted(`\n---\n\n## GZMO Response\n*${new Date().toISOString()}*\n\n${fullText}`);
      }
    }

    memory?.record(fileName, fullText);

    if (action === "search") {
      const evidenceMulti = ctx.state.evidenceMulti;
      if (vaultRoot) {
        let routeJudge: any = undefined;
        try {
          if (evidenceMulti && evidenceMulti.parts.length > 0) {
            const judged = routeJudgeMultipart({ answer: fullText, parts: evidenceMulti.parts });
            routeJudge = {
              score: judged.score,
              partValidCitationRate: judged.metrics.partValidCitationRate,
              partBackticksComplianceRate: judged.metrics.partBackticksComplianceRate,
              partAdversarialRejectRate: judged.metrics.partAdversarialRejectRate,
            };
          }
        } catch {}
        appendTaskPerf(vaultRoot, {
          type: "task_perf",
          created_at: new Date().toISOString(),
          fileName,
          action,
          ok: true,
          total_ms: Date.now() - startTime,
          spans,
          route_judge: routeJudge,
        }).catch(() => {});
      }
    }

    const durationMs = Date.now() - startTime;
    pulse?.emitEvent({
      type: "task_completed",
      fileName,
      action: String(frontmatter?.action ?? "think"),
      summary: fullText.slice(0, 240).replace(/\s+/g, " ").trim() || undefined,
      tokenCount: fullText.length / 4,
      durationMs,
    });

    if (action === "chain" && frontmatter?.chain_next) {
      const { basename, dirname, join } = await import("path");
      let nextTask = basename(String(frontmatter.chain_next));
      if (!nextTask.endsWith(".md")) nextTask += ".md";

      console.log(`[ENGINE] Chain → next task: ${nextTask}`);
      const chainPath = join(dirname(filePath), nextTask);
      const chainContent = `---\nstatus: pending\naction: think\nchain_from: ${fileName}\n---\n\n## Chained Task\n\nPrevious context:\n${fullText.slice(0, 300)}\n\nContinue from here.`;

      try {
        if (vaultRoot) {
          await safeWriteText(vaultRoot, chainPath, chainContent);
        } else {
          await Bun.write(chainPath, chainContent);
        }
      } catch (err) {
        console.warn(`[ENGINE] Chain write failed: ${err}`);
      }
    }

  } catch (err: any) {
    try {
      if (vaultRoot) {
        appendTaskPerf(vaultRoot, {
          type: "task_perf",
          created_at: new Date().toISOString(),
          fileName,
          action: String(frontmatter?.action ?? "think"),
          ok: false,
          total_ms: Date.now() - startTime,
          spans,
        }).catch(() => {});
      }
    } catch {}
    console.error(`[ENGINE] Failed: ${fileName} — ${err?.message}`);

    try {
      await document.markFailed(err?.message || "Unknown error");
    } catch {}

    pulse?.emitEvent({
      type: "task_failed",
      fileName,
      action: String(frontmatter?.action ?? "think"),
      errorType: err?.message ?? "unknown",
    });

  } finally {
    setTimeout(() => watcher.unlockFile(filePath), 1000);
  }
}
