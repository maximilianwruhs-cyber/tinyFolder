import type { TaskEvent } from "../watcher";
import type { PulseLoop } from "../pulse";
import type { EmbeddingStore } from "../embeddings";
import type { TaskMemory } from "../memory";
import type { EngineHooks } from "../engine_hooks";

export interface TaskRequest {
  event: TaskEvent;
  pulse?: PulseLoop;
  embeddingStore?: EmbeddingStore;
  memory?: TaskMemory;
  hooks: EngineHooks;
  vaultRoot: string;
}

export interface PipelineContext {
  vaultContext: string;
  systemPrompt: string;
  deterministicAnswer?: string;
  state: Record<string, any>;
}

export interface TaskPipeline {
  prepare(req: TaskRequest): Promise<PipelineContext>;
  validateAndShape(rawOutput: string, req: TaskRequest, ctx: PipelineContext): Promise<string>;
}
