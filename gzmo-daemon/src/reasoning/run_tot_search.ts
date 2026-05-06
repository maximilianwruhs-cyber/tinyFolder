/**
 * Tree-of-Thought search path — optional multi-step reasoning for action:search.
 */

import { compileEvidencePacket, renderEvidencePacket } from "../evidence_packet";
import { shapePreservingFailClosed } from "../response_shape";
import type { ReasoningNode } from "../reasoning_trace";
import type { EmbeddingStore } from "../embeddings";
import type { ChaosSnapshot } from "../types";
import { budgetFromChaos, ToTController, type ToTNode } from "./controller";
import { expandAnalyze, expandReason, expandRetrievalBranch } from "./expand";
import { evaluateNode } from "./evaluate";
import { getChatModel } from "../inference";
import type { InferDetailedOptions } from "../inference";
import { inferByRole, getChatModelForRole, modelRoutingEnabled } from "../inference_router";
import { readBoolEnv, readIntEnv } from "../pipelines/helpers";
import { beliefsEnabled, recordClaim, loadRecentClaimTexts, detectContradiction } from "../belief/claim_store";
import { estimatePriority } from "./priority";
import { synthesizeToTAnswer } from "./synthesis";
import { searchVaultHybrid } from "../search";
import { analyzeGate, retrieveGate, reasonGate } from "./gates";
import { generateCritique } from "./critique";

const RETRY_HINT =
  "Your previous claims may have scored low on grounding. Re-examine the evidence; cite SOURCE IDs; prefer verbatim support.";

export interface RunSearchTotParams {
  vaultRoot: string;
  filePath: string;
  body: string;
  systemPrompt: string;
  embeddingStore: EmbeddingStore;
  snap: ChaosSnapshot;
  traceId: string;
}

export interface RunSearchTotResult {
  answer: string;
  totFlatNodes: ReasoningNode[];
}

function isRetrievalNode(n: ToTNode): boolean {
  return n.type === "retrieve" || n.type === "vault_read" || n.type === "dir_list";
}

function normalizeOllamaApiUrl(): string {
  const base0 = (process.env.OLLAMA_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return (base0.endsWith("/v1") ? base0 : `${base0}/v1`).replace(/\/v1$/, "");
}

export async function runSearchTot(p: RunSearchTotParams): Promise<RunSearchTotResult> {
  const budget = budgetFromChaos(p.snap);
  const toolEnabled = readBoolEnv("GZMO_ENABLE_TOOLS", false);
  const maxToolCalls = readIntEnv("GZMO_MAX_TOOL_CALLS", 3, 0, 32);
  const useBeam = readBoolEnv("GZMO_TOT_BEAM", false);
  const gatesEnabled = readBoolEnv("GZMO_ENABLE_GATES", false);
  const traceMemory = readBoolEnv("GZMO_ENABLE_TRACE_MEMORY", false);
  const critiqueEnabled = readBoolEnv("GZMO_ENABLE_CRITIQUE", false);
  const toolChain = readBoolEnv("GZMO_ENABLE_TOOL_CHAINING", false);
  const temp = p.snap.llmTemperature;
  const maxTok = p.snap.llmMaxTokens;

  const inferFast = (s: string, pr: string, o?: InferDetailedOptions) => inferByRole("fast", s, pr, o);
  const inferReason = (s: string, pr: string, o?: InferDetailedOptions) => inferByRole("reason", s, pr, o);
  const inferCritique = (s: string, pr: string, o?: InferDetailedOptions) => inferByRole("reason", s, pr, o);
  const judgeModel = modelRoutingEnabled() ? getChatModelForRole("judge") : getChatModel();

  const tot = new ToTController(budget, p.traceId, p.body);
  const root = tot.root;
  if (!root) {
    return {
      answer: shapePreservingFailClosed({
        userPrompt: p.body,
        packet: undefined,
        lead: "insufficient evidence to produce a reasoned answer.",
        detailLines: ["ToT controller failed to initialize."],
      }),
      totFlatNodes: [],
    };
  }

  let pastTraceContext: string | undefined;
  if (traceMemory && p.embeddingStore.chunks.length > 0) {
    const ollamaBase = normalizeOllamaApiUrl();
    const traceResults = await searchVaultHybrid(p.body, p.embeddingStore, ollamaBase, {
      topK: 8,
      filters: { types: ["trace"] },
      mode: "fast",
    });
    const relevant = traceResults
      .filter((r) => r.metadata?.type === "trace" && r.metadata?.role === "reasoning")
      .slice(0, 2);
    if (relevant.length > 0) {
      pastTraceContext = relevant.map((r) => `- ${r.heading}: ${r.text.slice(0, 200)}`).join("\n");
    }
  }

  const toolCtx = { vaultPath: p.vaultRoot, taskFilePath: p.filePath };
  const retriedReasonIds = new Set<string>();

  const processRetrievalBranch = async (retrieveNode: ToTNode) => {
    if (tot.totalNodes >= budget.maxTotalNodes) return;
    retrieveNode.explored = true;

    let { children, evidence, toolRecords, toolFacts } = await expandRetrievalBranch(
      retrieveNode,
      p.embeddingStore,
      toolEnabled,
      toolCtx,
      maxToolCalls,
    );

    if (toolChain && toolEnabled) {
      const { discoverFollowUps } = await import("../tools/chaining");
      const { dispatchTool } = await import("../tools/registry");
      for (const record of [...toolRecords]) {
        for (const fu of discoverFollowUps(record.tool, record.result)) {
          if (toolRecords.length >= maxToolCalls) break;
          const { record: nr } = await dispatchTool(fu.tool, fu.args, toolCtx);
          toolRecords.push(nr);
        }
      }
      toolFacts = toolRecords
        .filter((r) => r.result.ok && r.result.output && r.result.output !== "(no matches)")
        .map((r) => `[tool:${r.tool}]\n${r.result.output}`)
        .join("\n\n");
    }

    const packet = compileEvidencePacket({
      localFacts: toolFacts,
      results: evidence,
      maxSnippets: 8,
      maxSnippetChars: 900,
    });
    const evidenceCtx = renderEvidencePacket(packet);
    const evidenceIds = packet.snippets.map((s) => s.id);

    const retrieveCheck = retrieveGate(evidence, 0.15, { hasToolFacts: Boolean(toolFacts?.trim()) });
    if (gatesEnabled && !retrieveCheck.passed) {
      if (tot.totalNodes >= budget.maxTotalNodes) return;
      tot.addChild(retrieveNode, {
        node_id: tot.nextNodeId(),
        trace_id: p.traceId,
        parent_id: retrieveNode.node_id,
        type: "reason",
        depth: retrieveNode.depth + 1,
        prompt_summary: `[GATE] ${retrieveCheck.reason ?? "retrieve blocked"}`,
        outcome: "failure",
        elapsed_ms: 0,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const reasonSpec = children[0]!;
    if (tot.totalNodes >= budget.maxTotalNodes) return;
    const reasonNode = tot.addChild(retrieveNode, {
      node_id: tot.nextNodeId(),
      trace_id: p.traceId,
      parent_id: retrieveNode.node_id,
      type: "reason",
      depth: retrieveNode.depth + 1,
      prompt_summary: reasonSpec.prompt_summary,
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
      evidence_cited: evidenceIds.slice(0, 12),
    });
    reasonNode.explored = true;

    const retrievePrompt = retrieveNode.prompt_summary;

    let verifySpecs = await expandReason(
      reasonNode,
      p.systemPrompt,
      evidenceCtx,
      retrievePrompt,
      inferReason,
      temp,
      maxTok,
    );

    const reasonGateFailed =
      gatesEnabled &&
      !reasonGate(
        verifySpecs.flatMap((v) => v.claims ?? []),
        packet,
      ).passed;

    let recentTexts: string[] = [];
    if (beliefsEnabled()) {
      recentTexts = await loadRecentClaimTexts(p.vaultRoot).catch(() => [] as string[]);
    }

    const firstPass: ToTNode[] = [];

    for (const vs of verifySpecs) {
      if (tot.totalNodes >= budget.maxTotalNodes) break;
      const verifyNode = tot.addChild(reasonNode, {
        node_id: tot.nextNodeId(),
        trace_id: p.traceId,
        parent_id: reasonNode.node_id,
        type: vs.type,
        depth: reasonNode.depth + 1,
        prompt_summary: vs.prompt_summary,
        claims: vs.claims,
        outcome: "success",
        elapsed_ms: 0,
        timestamp: new Date().toISOString(),
        retryGeneration: 0,
      });

      verifyNode.score = await evaluateNode(verifyNode, judgeModel, p.body, evidenceCtx);
      if (reasonGateFailed) verifyNode.score = Math.min(verifyNode.score ?? 0.5, 0.28);
      firstPass.push(verifyNode);

      if ((verifyNode.score ?? 0) >= budget.evaluationThreshold && beliefsEnabled() && verifyNode.claims) {
        for (const c of verifyNode.claims) {
          await recordClaim(p.vaultRoot, {
            trace_id: p.traceId,
            node_id: verifyNode.node_id,
            text: c.text,
            confidence: c.confidence,
            sources: c.sources?.length ? c.sources : evidenceIds,
          }).catch(() => {});
          for (const prev of recentTexts.slice(-20)) {
            const { contradiction, strength } = detectContradiction(c.text, prev);
            if (contradiction && strength > 0.35) {
              console.log(`[BELIEF] Possible contradiction (strength ${strength.toFixed(2)})`);
            }
          }
        }
      }
    }

    const anyPass = firstPass.some((v) => (v.score ?? 0) >= budget.evaluationThreshold);

    if (
      !anyPass &&
      budget.enableRetry &&
      !retriedReasonIds.has(reasonNode.node_id) &&
      tot.totalNodes < budget.maxTotalNodes
    ) {
      retriedReasonIds.add(reasonNode.node_id);
      verifySpecs = await expandReason(
        reasonNode,
        p.systemPrompt,
        evidenceCtx,
        retrievePrompt,
        inferReason,
        temp,
        maxTok,
        RETRY_HINT,
      );

      for (const vs of verifySpecs.slice(0, 2)) {
        if (tot.totalNodes >= budget.maxTotalNodes) break;
        const retryVerify = tot.addChild(reasonNode, {
          node_id: tot.nextNodeId(),
          trace_id: p.traceId,
          parent_id: reasonNode.node_id,
          type: vs.type,
          depth: reasonNode.depth + 1,
          prompt_summary: `Retry: ${vs.prompt_summary}`.slice(0, 200),
          claims: vs.claims,
          outcome: "success",
          elapsed_ms: 0,
          timestamp: new Date().toISOString(),
          retryGeneration: 1,
        });

        retryVerify.score = await evaluateNode(retryVerify, judgeModel, p.body, evidenceCtx);

        if ((retryVerify.score ?? 0) < budget.evaluationThreshold) {
          tot.prune(retryVerify);
        } else if (beliefsEnabled() && retryVerify.claims) {
          for (const c of retryVerify.claims) {
            await recordClaim(p.vaultRoot, {
              trace_id: p.traceId,
              node_id: retryVerify.node_id,
              text: c.text,
              confidence: c.confidence,
              sources: c.sources?.length ? c.sources : evidenceIds,
            }).catch(() => {});
          }
        }
      }
    }

    for (const verifyNode of firstPass) {
      if ((verifyNode.score ?? 0) < budget.evaluationThreshold) {
        tot.prune(verifyNode);
      }
    }
  };

  const pendingRetrieval = () =>
    tot
      .activeNodes
      .filter((n) => isRetrievalNode(n) && !n.explored && !n.pruned)
      .sort((a, b) => estimatePriority(b, tot) - estimatePriority(a, tot));

  const runRetrievalWave = async () => {
    if (useBeam) {
      let iter = 0;
      const maxIter = Math.min(budget.maxTotalNodes, 32);
      while (iter < maxIter) {
        const candidates = pendingRetrieval();
        if (candidates.length === 0) break;
        const wave = candidates.slice(0, budget.maxBranchesPerNode);
        for (const retrieveNode of wave) {
          if (tot.totalNodes >= budget.maxTotalNodes) break;
          await processRetrievalBranch(retrieveNode);
        }
        iter++;
      }
    } else {
      for (const retrieveNode of pendingRetrieval()) {
        if (tot.totalNodes >= budget.maxTotalNodes) break;
        await processRetrievalBranch(retrieveNode);
      }
    }
  };

  const runAnalyzePhase = async (userPromptForAnalyze: string, pastCtx?: string): Promise<boolean> => {
    const r = tot.root;
    if (!r) return false;
    const analyzeSpecs = await expandAnalyze(r, p.systemPrompt, userPromptForAnalyze, inferFast, temp, maxTok, pastCtx);

    const analyzeCheck = analyzeGate(
      analyzeSpecs.map((s) => s.prompt_summary),
      p.body,
    );
    if (gatesEnabled && !analyzeCheck.passed) {
      r.outcome = "failure";
      r.prompt_summary = `[GATE] ${analyzeCheck.reason ?? "analyze blocked"}`;
      r.explored = true;
      return false;
    }

    const branchCap = Math.min(budget.maxBranchesPerNode, analyzeSpecs.length);
    for (let i = 0; i < branchCap; i++) {
      const spec = analyzeSpecs[i]!;
      if (tot.totalNodes >= budget.maxTotalNodes) break;
      tot.addChild(r, {
        node_id: tot.nextNodeId(),
        trace_id: p.traceId,
        parent_id: r.node_id,
        type: spec.type,
        depth: 1,
        prompt_summary: spec.prompt_summary,
        outcome: "success",
        elapsed_ms: 0,
        timestamp: new Date().toISOString(),
      });
    }
    r.explored = true;
    await runRetrievalWave();
    return true;
  };

  const ok = await runAnalyzePhase(p.body, pastTraceContext);
  if (!ok) {
    const path = tot.bestPath();
    const bestClaims = path.flatMap((n) => n.claims ?? []);
    const evidenceFallback = path.find((n) => n.evidence_cited)?.evidence_cited ?? [];
    let answer: string;
    if (bestClaims.length === 0) {
      answer = shapePreservingFailClosed({
        userPrompt: p.body,
        packet: undefined,
        lead: "insufficient evidence to produce a reasoned answer.",
        detailLines: ["Decomposition failed verification gate or produced no verifiable path."],
      });
    } else {
      answer = synthesizeToTAnswer(path, tot.allNodes, evidenceFallback).markdown;
    }
    return { answer, totFlatNodes: tot.flattenForTrace() };
  }

  let path = tot.bestPath();
  let bestClaims = path.flatMap((n) => n.claims ?? []);

  const MAX_REPLANS = 1;
  let replanCount = 0;

  if (
    bestClaims.length === 0 &&
    critiqueEnabled &&
    replanCount < MAX_REPLANS &&
    tot.totalNodes < budget.maxTotalNodes - 4
  ) {
    const critique = await generateCritique(tot.allNodes, budget.evaluationThreshold, inferCritique, p.systemPrompt);
    const rr = tot.root;
    if (rr) {
      tot.addChild(rr, {
        node_id: tot.nextNodeId(),
        trace_id: p.traceId,
        parent_id: rr.node_id,
        type: "critique",
        depth: 1,
        prompt_summary: critique.recommendation.slice(0, 140),
        outcome: critique.shouldReplan ? "partial" : "abstain",
        elapsed_ms: 0,
        timestamp: new Date().toISOString(),
      });

      if (critique.shouldReplan) {
        tot.replan(critique.recommendation);
        replanCount++;
        retriedReasonIds.clear();
        const hint = `Critique from first attempt: ${critique.recommendation}`;
        await runAnalyzePhase(`${p.body}\n\n${hint}`, pastTraceContext);
        path = tot.bestPath();
        bestClaims = path.flatMap((n) => n.claims ?? []);
      }
    }
  }

  const evidenceFallback = path.find((n) => n.evidence_cited)?.evidence_cited ?? [];

  let answer: string;
  if (bestClaims.length === 0) {
    answer = shapePreservingFailClosed({
      userPrompt: p.body,
      packet: undefined,
      lead: "insufficient evidence to produce a reasoned answer.",
      detailLines: ["Exploration produced no verifiable claims above the score threshold."],
    });
  } else {
    answer = synthesizeToTAnswer(path, tot.allNodes, evidenceFallback).markdown;
  }

  return { answer, totFlatNodes: tot.flattenForTrace() };
}
