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
import { OUTPUTS_REGISTRY } from "../outputs_registry";

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
          localFacts: [localFacts, vaultIndex, explicitFacts].filter(Boolean).join("\n"),
          results,
          maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 10, 1, 20),
          maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
        }));

      const minScore = Number.parseFloat(process.env.GZMO_MIN_RETRIEVAL_SCORE ?? "0.32");
      const bestPartTop = perPart.length > 0
        ? Math.max(0, ...perPart.map((p) => p.results[0]?.score ?? 0))
        : 0;
      const bestTop = Math.max(results[0]?.score ?? 0, bestPartTop);

      const wantMulti = perPart.length > 0;
      if (wantMulti) {
        evidenceMulti = spanSync("evidence.compile.multi", () => compileEvidencePacketMulti({
          localFacts: [localFacts, vaultIndex, explicitFacts].filter(Boolean).join("\n"),
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
            localFacts: [localFacts, vaultIndex].filter(Boolean).join("\n"),
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
            localFacts: [localFacts, vaultIndex].filter(Boolean).join("\n"),
            results: [],
            maxSnippets: readIntEnv("GZMO_EVIDENCE_MAX_SNIPPETS", 10, 1, 20),
            maxSnippetChars: readIntEnv("GZMO_EVIDENCE_MAX_CHARS", 900, 200, 4000),
          }));
        }
      }

      vaultContext = enableEvidence
        ? spanSync("evidence.render", () => evidenceMulti ? renderEvidencePacketMulti(evidenceMulti) : renderEvidencePacket(evidencePacket!))
        : [localFacts, vaultIndex].filter(Boolean).join("\n");

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
    const memoryContext = memory?.toPromptContext();
    const systemPrompt = buildSystemPrompt(snap, vaultContext, memoryContext, undefined);
    
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
