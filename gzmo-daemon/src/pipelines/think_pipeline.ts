import type { TaskRequest, PipelineContext, TaskPipeline } from "./types";
import { resolve, relative } from "path";
import { gatherVaultStateIndex } from "../vault_state_index";
import { gatherLocalFacts } from "../local_facts";
import { buildProjectGrounding } from "../project_grounding";
import { searchVaultHybrid } from "../search";
import { compileEvidencePacket, renderEvidencePacket, type EvidencePacket } from "../evidence_packet";
import { verifySafety } from "../verifier_safety";
import { formatMemoryWorkingSet } from "../memory_working_set";
import {
  buildSystemPrompt,
  shouldInjectProjectGrounding,
  parseAction,
  readBoolEnv,
  readIntEnv,
  readThinkRetrievalTier,
  extractExplicitVaultMdPaths,
} from "./helpers";
import { checkChainChecklist, enforceChainChecklist } from "../chain_enforce";
import { checkThinkClarification } from "../think_clarification";

function getOllamaUrl(): string {
  const base0 = (process.env.OLLAMA_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
  return (base0.endsWith("/v1") ? base0 : `${base0}/v1`).replace(/\/v1$/, "");
}

export class ThinkPipeline implements TaskPipeline {
  async prepare(req: TaskRequest): Promise<PipelineContext> {
    const { event, pulse, memory, vaultRoot, embeddingStore } = req;
    const { body, frontmatter, filePath } = event;
    const action = parseAction(frontmatter ?? {});

    let projectGrounding = "";
    let projectAllowedPaths: string[] = [];
    if (shouldInjectProjectGrounding(action, body)) {
      const [vsi, lf] = await Promise.all([
        gatherVaultStateIndex({ vaultPath: vaultRoot, query: body }).catch(() => ""),
        gatherLocalFacts({ vaultPath: vaultRoot, query: body }).catch(() => ""),
      ]);
      const built = buildProjectGrounding(vaultRoot, vsi, lf);
      projectGrounding = built.text.trim();
      projectAllowedPaths = built.allowedPaths;
    }

    const snap = pulse?.snapshot();

    const thinkHalt = await checkThinkClarification({
      vaultRoot,
      body,
      embeddingStore: req.embeddingStore,
    });
    if (thinkHalt) {
      const ws = await formatMemoryWorkingSet(vaultRoot).catch(() => "");
      const memoryContext = [memory?.toPromptContext(), ws].filter(Boolean).join("\n\n").trim();
      const systemPrompt = buildSystemPrompt(snap, undefined, memoryContext || undefined, projectGrounding);
      return {
        vaultContext: "",
        systemPrompt,
        haltReason: thinkHalt,
        state: { projectGrounding, projectAllowedPaths, evidencePacket: undefined },
      };
    }

    let vaultContext = "";
    let evidencePacket: EvidencePacket | undefined;
    const tier = readThinkRetrievalTier();
    const wantRetrieve =
      Boolean(embeddingStore) &&
      tier !== "off" &&
      (tier === "on" || (tier === "light" && shouldInjectProjectGrounding(action, body)));

    if (wantRetrieve && embeddingStore) {
      try {
        const [localFacts, vaultIndex] = await Promise.all([
          gatherLocalFacts({ vaultPath: vaultRoot, query: body }).catch(() => ""),
          gatherVaultStateIndex({ vaultPath: vaultRoot, query: body }).catch(() => ""),
        ]);
        const topK = readIntEnv("GZMO_THINK_TOPK", 3, 1, 12);
        const results = await searchVaultHybrid(body, embeddingStore, getOllamaUrl(), {
          topK,
          mode: "fast",
        });
        const taskRel = relative(resolve(vaultRoot), resolve(filePath)).replace(/\\/g, "/");
        const explicitMd = extractExplicitVaultMdPaths(body);
        const allowDocs = explicitMd.some((p) => p.startsWith("docs/"));
        const filtered = results.filter(
          (r) =>
            r.file !== taskRel &&
            !r.file.startsWith("GZMO/Inbox/") &&
            (allowDocs || !r.file.startsWith("docs/")),
        );
        evidencePacket = compileEvidencePacket({
          localFacts: [localFacts, vaultIndex].filter(Boolean).join("\n"),
          results: filtered,
          maxSnippets: readIntEnv("GZMO_THINK_EVIDENCE_MAX_SNIPPETS", 6, 1, 20),
          maxSnippetChars: readIntEnv("GZMO_THINK_EVIDENCE_MAX_CHARS", 900, 200, 4000),
        });
        vaultContext = readBoolEnv("GZMO_EVIDENCE_PACKET", true)
          ? renderEvidencePacket(evidencePacket)
          : [localFacts, vaultIndex].filter(Boolean).join("\n");
      } catch {
        vaultContext = "";
        evidencePacket = undefined;
      }
    }

    const ws = await formatMemoryWorkingSet(vaultRoot).catch(() => "");
    const memoryContext = [memory?.toPromptContext(), ws].filter(Boolean).join("\n\n").trim();

    const systemPrompt = buildSystemPrompt(
      snap,
      vaultContext || undefined,
      memoryContext || undefined,
      projectGrounding,
    );

    return {
      vaultContext: vaultContext || "",
      systemPrompt,
      state: { projectGrounding, projectAllowedPaths, evidencePacket },
    };
  }

  async validateAndShape(rawOutput: string, req: TaskRequest, ctx: PipelineContext): Promise<string> {
    const action = parseAction(req.event.frontmatter ?? {});
    let finalOutput = rawOutput;

    const evidencePacket = ctx.state?.evidencePacket as EvidencePacket | undefined;
    if (evidencePacket && readBoolEnv("GZMO_VERIFY_SAFETY", true)) {
      const verdict = verifySafety({ answer: finalOutput, packet: evidencePacket });
      if (verdict) {
        finalOutput = [
          "insufficient evidence to answer safely relative to the injected Evidence Packet.",
          "",
          `Reason: ${verdict}`,
          "",
          "Next deterministic check: use action: search or add explicit vault `.md` paths in the task.",
        ].join("\n");
      }
    }

    if (action === "chain") {
      const check = checkChainChecklist({ userPrompt: req.event.body, answer: finalOutput });
      const hasChain = check.violations.length === 0;
      if (!hasChain) {
        finalOutput = enforceChainChecklist({ userPrompt: req.event.body, answer: finalOutput }).out;
      }
    }

    return finalOutput;
  }
}
