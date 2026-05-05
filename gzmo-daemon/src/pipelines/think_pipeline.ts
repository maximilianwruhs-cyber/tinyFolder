import type { TaskRequest, PipelineContext, TaskPipeline } from "./types";
import { gatherVaultStateIndex } from "../vault_state_index";
import { gatherLocalFacts } from "../local_facts";
import { buildProjectGrounding } from "../project_grounding";
import { buildSystemPrompt, shouldInjectProjectGrounding, parseAction } from "./helpers";
import { checkChainChecklist, enforceChainChecklist } from "../chain_enforce";

export class ThinkPipeline implements TaskPipeline {
  async prepare(req: TaskRequest): Promise<PipelineContext> {
    const { event, pulse, memory, vaultRoot } = req;
    const { body, frontmatter } = event;
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
    const memoryContext = memory?.toPromptContext();
    const systemPrompt = buildSystemPrompt(snap, undefined, memoryContext, projectGrounding);
    
    return {
      vaultContext: "",
      systemPrompt,
      state: { projectGrounding, projectAllowedPaths },
    };
  }

  async validateAndShape(rawOutput: string, req: TaskRequest, ctx: PipelineContext): Promise<string> {
    const action = parseAction(req.event.frontmatter ?? {});
    let finalOutput = rawOutput;
    
    if (action === "chain") {
      const hasChain = checkChainChecklist(finalOutput);
      if (!hasChain) {
        finalOutput = enforceChainChecklist(req.event.body, finalOutput);
      }
    }
    
    return finalOutput;
  }
}
