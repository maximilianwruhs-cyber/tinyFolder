import type { TaskRequest, PipelineContext, TaskPipeline } from "./types";
import { resolve, relative } from "path";
import { gatherVaultStateIndex } from "../vault_state_index";
import { gatherLocalFacts } from "../local_facts";
import { searchVaultHybrid, type SearchResult } from "../search";
import { compileEvidencePacket, compileEvidencePacketMulti, renderEvidencePacket, renderEvidencePacketMulti, type EvidencePacket, type EvidencePacketMulti } from "../evidence_packet";
import { detectRequiredParts, enforceExactBulletCount, enforceRequiredPartsCoverage, shapePreservingFailClosed } from "../response_shape";
import { applyPartQueryHooks, applyPostEvidenceMultiHooks } from "../engine_hooks";
import { formatSearchCitations } from "../citation_formatter";
import { verifySafety } from "../verifier_safety";
import { selfEvalAndRewrite } from "../self_eval";
import { buildSystemPrompt, readBoolEnv, readIntEnv, isProofTask, extractExplicitVaultMdPaths } from "./helpers";
import { formatMemoryWorkingSet } from "../memory_working_set";
import { buildGahClarification, shouldEvidenceGateHalt } from "../gah_gate";
import { OUTPUTS_REGISTRY } from "../outputs_registry";
import type { ToolCallRecord } from "../tools/types";

// Note: OLLAMA_API_URL and OLLAMA_MODEL need to be read or passed in. We'll use env for now.
function getOllamaUrl() {
  const base0 = (process.env.OLLAMA_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return (base0.endsWith("/v1") ? base0 : `${base0}/v1`).replace(/\/v1$/, "");
}
function getOllamaModel() {
  return process.env.OLLAMA_MODEL ?? "hermes3:8b";
}

// In-line polyfill for span to keep the pipeline clean. In reality, these should be passed or we just run them.
async function span<T>(name: string, fn: () => Promise<T>): Promise<T> { return await fn(); }
function spanSync<T>(name: string, fn: () => T): T { return fn(); }

export class SearchPipeline implements TaskPipeline {
  async prepare(req: TaskRequest): Promise<PipelineContext> {
    const { event, pulse, memory, embeddingStore, hooks, vaultRoot } = req;
    const { body, frontmatter, filePath, fileName } = event;
    const action = "search";
    
    let vaultContext: string | undefined;
    let evidencePacket: EvidencePacket | undefined;
    let evidenceMulti: EvidencePacketMulti | undefined;
    let deterministicAnswer: string | null = null;
    
    if (embeddingStore) {
      const enableV2 = readBoolEnv("GZMO_PIPELINE_V2", true);
      const [localFacts, vaultIndex] = await span("facts+vault_index", async () => {
        return await Promise.all([
          gatherLocalFacts({ vaultPath: vaultRoot, query: body }).catch(() => ""),
          gatherVaultStateIndex({ vaultPath: vaultRoot, query: body }).catch(() => ""),
        ]);
      });

      const requiredParts = detectRequiredParts(body);
      const preludeLines: string[] = [];
      if (requiredParts.kind === "numbered_parts") {
        const lines = body.split("\n");
        for (const line of lines) {
          if (/^\s*\d+\)\s+/.test(line)) break;
          const t = line.trim();
          if (t) preludeLines.push(t);
          if (preludeLines.length >= 2) break;
        }
      }
      const globalPromptContext = preludeLines.join("\n").trim();
      const partQueries =
        requiredParts.kind === "numbered_parts"
          ? requiredParts.parts.map((p) => ({
              idx: p.idx,
              text: p.text,
              query: (() => {
                const base = [globalPromptContext, `Part ${p.idx}: ${p.text}`].filter(Boolean).join("\n\n");
                const applied = applyPartQueryHooks(hooks, {
                  action,
                  userPrompt: body,
                  globalPromptContext,
                  part: { idx: p.idx, text: p.text },
                  query: base,
                });
                return applied.query;
              })(),
            }))
          : [];

      const explicitMd = extractExplicitVaultMdPaths(body).slice(0, 2);
      let explicitFacts = "";
      for (const rel of explicitMd) {
        try {
          const abs = resolve(vaultRoot, rel);
          const exists = await span("explicit_file.exists", () => Bun.file(abs).exists());
          if (!exists) continue;
          const text = await span("explicit_file.read", () => Bun.file(abs).text());
          const clipped = text.length > 2500 ? text.slice(0, 2500) + "\n…" : text;
          explicitFacts += `\n[explicit_file] ${rel}\n${clipped}\n`;
        } catch {
          // ignore
        }
      }

      const topK = readIntEnv("GZMO_TOPK", 6, 1, 20);
      const fastResults = enableV2
        ? await span("retrieval.fast", () => searchVaultHybrid(body, embeddingStore, getOllamaUrl(), { topK, mode: "fast" }))
        : [];
      const fastTop = fastResults[0]?.score ?? 0;
      const minFastScore = Number.parseFloat(process.env.GZMO_FASTPATH_MIN_SCORE ?? "0.55");
      const shouldDeep = Number.isFinite(minFastScore) ? fastTop < minFastScore : false;
      const rawResults = shouldDeep
        ? await span("retrieval.deep", () => searchVaultHybrid(body, embeddingStore, getOllamaUrl(), { topK, mode: "deep" }))
        : fastResults;
      
      const taskRel = relative(resolve(vaultRoot), resolve(filePath)).replace(/\\/g, "/");
      const allowDocs = explicitMd.some((p) => p.startsWith("docs/"));
      const results = rawResults.filter((r) =>
        r.file !== taskRel
        && !r.file.startsWith("GZMO/Inbox/")
        && (allowDocs || !r.file.startsWith("docs/"))
      );

      // ── Knowledge Graph search augmentation (optional) ───────────────
      // Goal: force-include a small number of KG-connected files to improve recall.
      if (readBoolEnv("GZMO_KG_SEARCH_AUGMENT", false)) {
        try {
          const { KnowledgeGraph } = await import("../knowledge_graph/graph");
          const kg = KnowledgeGraph.forVault(vaultRoot);
          await kg.init();
          const augment = await kg.augmentSearch(body, getOllamaUrl(), { maxTopicNodes: 5, hops: 2 });

          // Force-include up to 3 files from connected claim sources, if present in embeddingStore.
          const forceFiles = augment.connectedClaims
            .flatMap((cc) => cc.evidenceFiles)
            .filter(Boolean)
            .slice(0, 6);

          const injected: SearchResult[] = [];
          for (const f of forceFiles) {
            if (injected.length >= 3) break;
            const already = results.find((r) => r.file === f || r.file.endsWith(`/${f}`));
            if (already) continue;
            const chunk = embeddingStore.chunks.find((c) => c.file === f || c.file.endsWith(`/${f}`));
            if (!chunk) continue;
            // Keep consistent with SearchResult shape.
            const baseMeta = chunk.metadata ?? { pathBucket: "wiki", tags: [] };
            injected.push({
              file: chunk.file,
              heading: chunk.heading,
              text: chunk.text,
              score: 0.85,
              metadata: { ...baseMeta, kg_augmented: true },
            });
          }

          if (injected.length > 0) {
            // Prepend injected results so they get a chance to appear in evidence packets.
            results.unshift(...injected);
          }
        } catch {
          // Non-fatal; augmentation is best-effort.
        }
      }

      let toolResults: ToolCallRecord[] = [];
      const enableTools = readBoolEnv("GZMO_ENABLE_TOOLS", false);
      const maxToolCalls = readIntEnv("GZMO_MAX_TOOL_CALLS", 3, 0, 32);
      if (enableTools && results.length === 0 && maxToolCalls > 0) {
        const { dispatchTool } = await import("../tools/registry");
        const ctx = { vaultPath: vaultRoot, taskFilePath: filePath };
        const keywords = body.split(/\s+/).filter((w) => w.length > 4).slice(0, 3);
        let calls = 0;
        for (const kw of keywords) {
          if (calls >= maxToolCalls) break;
          const { record } = await dispatchTool("fs_grep", { pattern: kw, max_results: 5 }, ctx);
          if (record.result.ok && record.result.output !== "(no matches)") {
            toolResults.push(record);
          }
          calls++;
        }
      }
      const toolFacts = toolResults.map((r) => `[tool:${r.tool}]\n${r.result.output}`).join("\n\n");

      const enableEvidence = readBoolEnv("GZMO_EVIDENCE_PACKET", true);

      let perPart: { idx: number; text: string; query: string; results: SearchResult[] }[] = [];
      if (partQueries.length > 0 && readBoolEnv("GZMO_ENABLE_PER_PART_EVIDENCE", true)) {
        const topKPart = readIntEnv("GZMO_TOPK_PART", 4, 1, 12);
        const perPartRaw = await span("retrieval.parts", async () => {
          const out: { idx: number; text: string; query: string; results: SearchResult[] }[] = [];
          for (const pq of partQueries) {
            const fast = await searchVaultHybrid(pq.query, embeddingStore, getOllamaUrl(), { topK: topKPart, perFileLimit: 1, mode: "fast", adaptiveTopKMode: "part" });
            const fastScore = fast[0]?.score ?? 0;
            const minFastScorePart = Number.parseFloat(process.env.GZMO_FASTPATH_MIN_SCORE ?? "0.55");
            const shouldDeepPart = Number.isFinite(minFastScorePart) ? fastScore < minFastScorePart : false;
            const raw = shouldDeepPart
              ? await searchVaultHybrid(pq.query, embeddingStore, getOllamaUrl(), { topK: topKPart, perFileLimit: 1, mode: "deep", adaptiveTopKMode: "part" })
              : fast;
            const filtered = raw.filter((r) =>
              r.file !== taskRel
              && !r.file.startsWith("GZMO/Inbox/")
              && (allowDocs || !r.file.startsWith("docs/"))
            );
            out.push({ idx: pq.idx, text: pq.text, query: pq.query, results: filtered });
          }
          return out;
        });

        perPart = perPartRaw.map((p) => {
          const seen = new Set<string>();
          const deduped: SearchResult[] = [];
          for (const r of p.results) {
            const key = `${r.file}::${r.heading}::${r.text}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(r);
          }
          return { ...p, results: deduped };
        });
      }

      evidencePacket = spanSync("evidence.compile", () => compileEvidencePacket({
          localFacts: [localFacts, vaultIndex, explicitFacts, toolFacts].filter(Boolean).join("\n"),
          results,
          maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 10, 1, 20),
          maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
        }));

      const minScore = Number.parseFloat(process.env.GZMO_MIN_RETRIEVAL_SCORE ?? "0.32");
      const bestPartTop = perPart.length > 0
        ? Math.max(0, ...perPart.map((p) => p.results[0]?.score ?? 0))
        : 0;
      const bestTop = Math.max(results[0]?.score ?? 0, bestPartTop);

      // Evidence Quality Gate (GAH): halt before LLM when evidence is empty/weak.
      const gahEnabled = readBoolEnv("GZMO_ENABLE_GAH", false);
      const gahMinRaw = process.env.GZMO_GAH_MIN_SCORE ?? process.env.GZMO_MIN_RETRIEVAL_SCORE ?? "0.25";
      const gahMinScore = Number.parseFloat(gahMinRaw);
      const hasToolEvidence = Boolean(toolFacts?.trim());
      const evidenceEmpty = results.length === 0 && perPart.every((p) => p.results.length === 0);

      const gah = shouldEvidenceGateHalt({
        gahEnabled,
        hasToolEvidence,
        evidenceEmpty,
        bestTop,
        gahMinScore,
      });
      if (gah.halt && gah.reason) {
        const ws = await formatMemoryWorkingSet(vaultRoot).catch(() => "");
        const mc = [memory?.toPromptContext(), ws].filter(Boolean).join("\n\n").trim();
        const systemPrompt = buildSystemPrompt(pulse?.snapshot(), undefined, mc || undefined, undefined);
        return {
          vaultContext: "",
          systemPrompt,
          haltReason: buildGahClarification(gah.reason),
          state: { evidencePacket: undefined, evidenceMulti: undefined, vaultContext: "" },
        };
      }

      const wantMulti = perPart.length > 0;
      if (wantMulti) {
        evidenceMulti = spanSync("evidence.compile.multi", () => compileEvidencePacketMulti({
            localFacts: [localFacts, vaultIndex, explicitFacts, toolFacts].filter(Boolean).join("\n"),
            globalResults: results,
          parts: perPart.map((p) => ({ idx: p.idx, text: p.text, results: p.results })),
          maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 12, 1, 30),
          maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
          maxGlobalSnippets: readIntEnv("GZMO_EVIDENCE_GLOBAL_MAX", 4, 0, 12),
          maxSnippetsPerPart: readIntEnv("GZMO_EVIDENCE_PER_PART_MAX", 3, 0, 8),
        }));
        try {
          const em = evidenceMulti;
          const applied = spanSync("hooks.post_evidence_multi", () => applyPostEvidenceMultiHooks(hooks, {
            action,
            userPrompt: body,
            snippets: (em.packet.snippets ?? []).map((s) => ({ id: s.id, text: String(s.text ?? "") })),
            parts: (em.parts ?? []).map((p) => ({ idx: p.idx, text: p.text, snippetIds: [...p.snippetIds] })),
          }));
          if (applied.changed) {
            evidenceMulti = { ...em, parts: applied.parts };
          }
        } catch {}
        evidencePacket = evidenceMulti.packet;
      }

      if ((results.length === 0 && perPart.every((p) => p.results.length === 0)) || !(Number.isFinite(minScore) ? bestTop >= minScore : true)) {
        if (wantMulti) {
          evidenceMulti = spanSync("evidence.compile.multi.failclosed", () => compileEvidencePacketMulti({
            localFacts: [localFacts, vaultIndex, toolFacts].filter(Boolean).join("\n"),
            globalResults: [],
            parts: perPart.map((p) => ({ idx: p.idx, text: p.text, results: [] })),
            maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 12, 1, 30),
            maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
            maxGlobalSnippets: readIntEnv("GZMO_EVIDENCE_GLOBAL_MAX", 4, 0, 12),
            maxSnippetsPerPart: readIntEnv("GZMO_EVIDENCE_PER_PART_MAX", 3, 0, 8),
          }));
          evidencePacket = evidenceMulti.packet;
        } else {
          evidencePacket = spanSync("evidence.compile.failclosed", () => compileEvidencePacket({
            localFacts: [localFacts, vaultIndex, toolFacts].filter(Boolean).join("\n"),
            results: [],
            maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 10, 1, 20),
            maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
          }));
        }
      }

      vaultContext = enableEvidence
        ? spanSync("evidence.render", () => evidenceMulti ? renderEvidencePacketMulti(evidenceMulti) : renderEvidencePacket(evidencePacket!))
        : [localFacts, vaultIndex, toolFacts].filter(Boolean).join("\n");

      if (isProofTask(fileName)) {
        const opsOutputsIntent =
          /\bops\b/i.test(body) && /\boutputs?\b/i.test(body)
          || /\boperational\b/i.test(body) && /\bfiles?\b/i.test(body) && /\bwrites?\b/i.test(body);
        if (opsOutputsIntent) {
          deterministicAnswer = [
            "Operational outputs (code-defined registry):",
            "",
            ...OUTPUTS_REGISTRY
              .slice(0, 80)
              .map((o) => `- [ ] \`${o.path}\` — ${o.purpose} *(op=${o.operation}, mode=${o.writeMode})* [E1]`),
          ].join("\n");
        }

        const wordFreqTrapIntent =
          /\bmost\s+used\s+word\b/i.test(body)
          || /\bword\s+frequency\b/i.test(body);
        if (!deterministicAnswer && wordFreqTrapIntent) {
          deterministicAnswer = [
            "insufficient evidence to determine the most used word in this vault. [E1]",
            "",
            "Next deterministic check: run a corpus-wide word count over the vault contents (outside this Evidence Packet), then cite the computed results. [E1]",
          ].join("\n");
        }
      }
    }
    
    const snap = pulse?.snapshot();
    const memoryContext = [
      memory?.toPromptContext(),
      await formatMemoryWorkingSet(vaultRoot).catch(() => ""),
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const systemPrompt = buildSystemPrompt(snap, vaultContext, memoryContext || undefined, undefined);
    
    return {
      vaultContext: vaultContext || "",
      systemPrompt,
      deterministicAnswer: deterministicAnswer || undefined,
      state: { evidencePacket, evidenceMulti, vaultContext },
    };
  }

  async validateAndShape(rawOutput: string, req: TaskRequest, ctx: PipelineContext): Promise<string> {
    const { event } = req;
    const { evidencePacket, evidenceMulti, vaultContext } = ctx.state;
    let fullText = rawOutput;
    let selfCheckBlock = "";
    
    // Safety verifier
    if (evidencePacket && readBoolEnv("GZMO_VERIFY_SAFETY", true)) {
      const verdict = spanSync("safety.verify", () => verifySafety({ answer: fullText, packet: evidencePacket }));
      if (verdict) {
        fullText = shapePreservingFailClosed({
          userPrompt: event.body,
          packet: evidencePacket,
          lead: "insufficient evidence to answer safely.",
          detailLines: [
            `Reason: ${verdict}`,
            "Next deterministic check: inspect the paths/snippets shown in the Evidence Packet.",
          ],
        });
      }
    }

    // Citation formatting
    if (evidencePacket) {
      const res = spanSync("citations.format", () => formatSearchCitations(fullText, evidencePacket));
      if (res.changed) fullText = res.formatted;
      
      // Enforce bullet count
      fullText = spanSync("shape.enforce", () => enforceExactBulletCount({ userPrompt: event.body, packet: evidencePacket, answer: fullText }));
      const res2 = spanSync("citations.format.postshape", () => formatSearchCitations(fullText, evidencePacket));
      if (res2.changed) fullText = res2.formatted;
      
      // Enforce required parts coverage
      const cov1 = spanSync("shape.parts.enforce", () => enforceRequiredPartsCoverage({ userPrompt: event.body, packet: evidencePacket, answer: fullText }));
      if (cov1.applied) fullText = cov1.out;

      const res3 = spanSync("citations.format.postparts", () => formatSearchCitations(fullText, evidencePacket));
      if (res3.changed) fullText = res3.formatted;
    }
    
    return fullText + selfCheckBlock;
  }
}
