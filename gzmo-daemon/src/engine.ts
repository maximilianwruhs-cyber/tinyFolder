/**
 * engine.ts — The GZMO inference engine (Smart Core v0.3.0)
 *
 * Now with:
 * - Task routing via `action:` frontmatter
 * - Vault search via nomic-embed-text embeddings
 * - Episodic memory for cross-task continuity
 * - Chaos-aware LLM parameter modulation
 */

import { type TaskStatus } from "./frontmatter";
import type { TaskEvent } from "./watcher";
import type { VaultWatcher } from "./watcher";
import { resolve, relative } from "path";
import type { ChaosSnapshot } from "./types";
import { Phase, defaultSnapshot } from "./types";
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
import { SearchPipeline } from "./pipelines/search_pipeline";
import { ThinkPipeline } from "./pipelines/think_pipeline";
import { inferDetailed, OLLAMA_MODEL } from "./inference";
export { infer, inferDetailed, type InferenceResult, OLLAMA_MODEL } from "./inference";
import {
  appendTraceIndex,
  persistTrace,
  tracesEnabled,
  type ReasoningNode,
  type ReasoningTrace,
} from "./reasoning_trace";
import { readBoolEnv } from "./pipelines/helpers";
import { runSearchTot } from "./reasoning/run_tot_search";
import {
  appendStrategyEntry,
  buildStrategyTips,
  classifyTaskType,
  extractDecompositionStyle,
  formatStrategyContext,
  learningEnabled,
  loadLedger,
} from "./learning/ledger";

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

  const traceId = crypto.randomUUID();
  const traceNodes: ReasoningNode[] = [];
  const taskRelPath = relative(resolve(vaultRoot), resolve(filePath)).replace(/\\/g, "/");
  let strategyInjected = false;

  try {
    const action = parseAction(frontmatter ?? {});
    console.log(`[ENGINE] Processing: ${fileName} (action: ${action})`);

    const pushTrace = (n: Omit<ReasoningNode, "trace_id" | "timestamp"> & { timestamp?: string }) => {
      if (!tracesEnabled()) return;
      traceNodes.push({
        ...(n as ReasoningNode),
        trace_id: traceId,
        timestamp: n.timestamp ?? new Date().toISOString(),
      });
    };

    await span("frontmatter.processing", () => document.markProcessing());
    const req = { event, pulse, embeddingStore, memory, hooks, vaultRoot };

    const pipeline = action === "search" ? new SearchPipeline() : new ThinkPipeline();
    const ctx = await pipeline.prepare(req);

    let strategyContext = "";
    if (learningEnabled() && vaultRoot) {
      const ledger = await loadLedger(vaultRoot, 200);
      const taskType = classifyTaskType(body);
      const tips = buildStrategyTips(ledger, taskType);
      const abTest = readBoolEnv("GZMO_LEARNING_AB_TEST", false);
      const inject = !abTest || Math.random() > 0.3;
      strategyInjected = inject;
      strategyContext = inject ? formatStrategyContext(tips) : "";
    }
    const systemPromptWithStrategy = strategyContext ? `${ctx.systemPrompt}\n\n${strategyContext}` : ctx.systemPrompt;

    const snap = pulse?.snapshot() ?? defaultSnapshot();
    const temp = snap.llmTemperature ?? 0.7;
    const maxTok = snap.llmMaxTokens ?? 400;
    const valence = snap.llmValence ?? 0;
    console.log(`[ENGINE] Model: ${OLLAMA_MODEL} (temp: ${temp.toFixed(2)}, tokens: ${maxTok}, val: ${valence >= 0 ? "+" : ""}${valence.toFixed(2)}, phase: ${snap.phase ?? "?"})`);

    if (tracesEnabled()) {
      pushTrace({
        node_id: "n0",
        parent_id: null,
        type: "task_start",
        depth: 0,
        prompt_summary: `${fileName} (${action}): ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`,
        outcome: "success",
        elapsed_ms: 0,
      });
      pushTrace({
        node_id: "n1",
        parent_id: "n0",
        type: "analyze",
        depth: 1,
        prompt_summary: `Pipeline ${action} prepared`,
        outcome: "success",
        elapsed_ms: 0,
      });
    }

    let inferElapsed = 0;
    const useTot = readBoolEnv("GZMO_ENABLE_TOT", false) && action === "search" && Boolean(embeddingStore);

    let routeJudgeMetrics: { score: number; partValidCitationRate: number } | undefined;

    let rawOutput = ctx.deterministicAnswer;
    const usedDeterministic = Boolean(rawOutput);

    if (useTot && !usedDeterministic) {
      const totOut = await span("reasoning.tot", async () =>
        runSearchTot({
          vaultRoot,
          filePath,
          body,
          systemPrompt: systemPromptWithStrategy,
          embeddingStore: embeddingStore!,
          snap,
          traceId,
        }),
      );
      rawOutput = totOut.answer;
      if (tracesEnabled()) traceNodes.push(...totOut.totFlatNodes);
      // Prefer ToT's own strategy injection measurement when present.
      if (typeof totOut.strategyInjected === "boolean") strategyInjected = totOut.strategyInjected;
    } else if (!usedDeterministic) {
      const inferResult = await span("llm.stream", async () =>
        inferDetailed(systemPromptWithStrategy, body, { temperature: temp, maxTokens: maxTok }),
      );
      inferElapsed = inferResult.elapsed_ms;
      rawOutput = inferResult.answer;
      if (tracesEnabled() && inferResult.thinking) {
        pushTrace({
          node_id: `n${traceNodes.length}`,
          parent_id: "n1",
          type: "reason",
          depth: 2,
          prompt_summary: `LLM (temp=${temp.toFixed(2)}, maxTok=${maxTok})`,
          raw_thinking: inferResult.thinking,
          outcome: "success",
          elapsed_ms: inferResult.elapsed_ms,
          model: OLLAMA_MODEL,
        });
      }
    }

    if (!rawOutput) {
      rawOutput = "_[GZMO produced internal reasoning but no visible output.]_";
    }

    let fullText = await pipeline.validateAndShape(rawOutput, req, ctx);
    
    const output = `\n---\n\n## GZMO Response\n*${new Date().toISOString()}*\n\n${fullText}`;
    await span("frontmatter.completed", () => document.markCompleted(output));

    console.log(`[ENGINE] Completed: ${fileName} (${action})`);

    // ── Knowledge Graph (optional) ───────────────────────────────
    if (readBoolEnv("GZMO_ENABLE_KNOWLEDGE_GRAPH", false) && vaultRoot) {
      try {
        const { KnowledgeGraph, extractEntities } = await import("./knowledge_graph/graph");
        const kg = KnowledgeGraph.forVault(vaultRoot);
        await kg.init();

        const sourceNodeId = kg.upsertSource(taskRelPath, { sourceFile: taskRelPath, kind: "task_file" });

        const entities = extractEntities(fullText, taskRelPath);
        for (const ent of entities) {
          const entId = kg.upsertEntity(ent.text, {
            entityType: ent.type,
            sourceFile: ent.sourceFile,
            confidence: ent.confidence,
          });
          kg.addEdge(sourceNodeId, entId, "mentions", ent.confidence);
        }

        // Record a compact claim node for the final answer (dedupes by content hash).
        const claimText = String(fullText ?? "").slice(0, 500);
        if (claimText.trim()) {
          const conf = Math.max(0.25, Math.min(1, routeJudgeMetrics?.score ?? 0.6));
          kg.upsertClaim(claimText, sourceNodeId, conf);
        }

        await kg.persist();
        await kg.appendAuditEvent({
          op: "task_completion",
          payload: { task_file: taskRelPath, entity_count: entities.length },
        });
      } catch {
        // Non-fatal (KG is optional and must never block task completion)
      }
    }

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

    if (tracesEnabled()) {
      pushTrace({
        node_id: `n${traceNodes.length}`,
        parent_id: "n1",
        type: "verify",
        depth: 2,
        prompt_summary: "Post-processing: citations, safety, shape",
        outcome: "success",
        elapsed_ms: Math.max(0, Date.now() - startTime - inferElapsed),
      });
    }

    if (tracesEnabled() && vaultRoot) {
      const trace: ReasoningTrace = {
        trace_id: traceId,
        task_file: taskRelPath,
        action,
        model: OLLAMA_MODEL,
        total_elapsed_ms: Date.now() - startTime,
        nodes: traceNodes,
        final_answer: fullText,
        status: "completed",
      };
      await persistTrace(vaultRoot, trace).catch(() => {});
      await appendTraceIndex(vaultRoot, trace).catch(() => {});
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
            routeJudgeMetrics = {
              score: judged.score,
              partValidCitationRate: judged.metrics.partValidCitationRate,
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

    if (learningEnabled() && vaultRoot) {
      let decomposition = extractDecompositionStyle(traceNodes);
      const analyzeHint = traceNodes.find((n) => n.type === "analyze" && /sub-task/i.test(n.prompt_summary));
      if (analyzeHint) {
        const s = analyzeHint.prompt_summary.toLowerCase();
        if (/vault_read|read file/.test(s)) decomposition = "direct_read";
        else if (/broad|general|overview/.test(s)) decomposition = "broad_scope";
        else if (/narrow|specific|exact/.test(s)) decomposition = "narrow_scope";
      }
      await appendStrategyEntry(vaultRoot, {
        task_type: classifyTaskType(body),
        task_file: taskRelPath,
        decomposition_style: decomposition,
        used_tools: readBoolEnv("GZMO_ENABLE_TOOLS", false),
        used_tot: useTot,
        model: OLLAMA_MODEL,
        ok: true,
        z_score: routeJudgeMetrics?.score ?? 0,
        citation_rate: routeJudgeMetrics?.partValidCitationRate ?? 0,
        total_ms: Date.now() - startTime,
        trace_id: traceId,
        strategy_injected: strategyInjected,
      }).catch(() => {});
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
      if (tracesEnabled() && vaultRoot) {
        const failTrace: ReasoningTrace = {
          trace_id: traceId,
          task_file: taskRelPath,
          action: parseAction(frontmatter ?? {}),
          model: OLLAMA_MODEL,
          total_elapsed_ms: Date.now() - startTime,
          nodes: traceNodes,
          final_answer: err?.message ?? "Unknown error",
          status: "failed",
        };
        await persistTrace(vaultRoot, failTrace).catch(() => {});
        await appendTraceIndex(vaultRoot, failTrace).catch(() => {});
      }
    } catch {}

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

    try {
      if (learningEnabled() && vaultRoot) {
        const actionFailed = parseAction(frontmatter ?? {});
        const totOn = readBoolEnv("GZMO_ENABLE_TOT", false) && actionFailed === "search";
        await appendStrategyEntry(vaultRoot, {
          task_type: classifyTaskType(String(body ?? "")),
          task_file: taskRelPath,
          decomposition_style: "unknown",
          used_tools: readBoolEnv("GZMO_ENABLE_TOOLS", false),
          used_tot: totOn,
          model: OLLAMA_MODEL,
          ok: false,
          z_score: 0,
          citation_rate: 0,
          total_ms: Date.now() - startTime,
          trace_id: traceId,
          strategy_injected: strategyInjected,
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
