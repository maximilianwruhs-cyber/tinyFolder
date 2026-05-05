import fs from 'fs';

let content = fs.readFileSync('src/engine.ts', 'utf-8');

// 1. Add new imports
const newImports = `import { parseAction } from "./pipelines/helpers";
import { SearchPipeline } from "./pipelines/search_pipeline";
import { ThinkPipeline } from "./pipelines/think_pipeline";
`;
content = content.replace('import type { EngineHooks } from "./engine_hooks";', `import type { EngineHooks } from "./engine_hooks";\n${newImports}`);

// 2. Remove helpers that were moved to pipelines/helpers.ts
const helpersToRemove = [
  /function phasePersona[\s\S]*?\}\n/,
  /function valenceDirective[\s\S]*?\}\n/,
  /function verbosityDirective[\s\S]*?\}\n/,
  /function buildSystemPrompt[\s\S]*?return prompt;\n\}\n/,
  /function shouldInjectProjectGrounding[\s\S]*?\}\n/,
  /function readBoolEnv[\s\S]*?\}\n/,
  /function readIntEnv[\s\S]*?\}\n/,
  /function isProofTask[\s\S]*?\}\n/,
  /function extractExplicitVaultMdPaths[\s\S]*?return paths;\n\}\n/
];

for (const regex of helpersToRemove) {
  content = content.replace(regex, '');
}

// 3. Replace processTask
const processTaskRegex = /export async function processTask\([\s\S]*?setTimeout\(\(\) => watcher\.unlockFile\(filePath\), 1000\);\n  \}\n\}/;

const newProcessTask = `export async function processTask(
  event: TaskEvent,
  watcher: VaultWatcher,
  pulse?: PulseLoop,
  embeddingStore?: EmbeddingStore,
  memory?: TaskMemory,
): Promise<void> {
  const { filePath, fileName, body, frontmatter, document } = event;
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
  });

  try {
    const action = parseAction(frontmatter ?? {});
    console.log(\`[ENGINE] Processing: \${fileName} (action: \${action})\`);

    await span("frontmatter.processing", () => document.markProcessing());

    const vaultRoot = filePath.split(/[\\\\\\/]GZMO[\\\\\\/]/)[0] ?? resolve(filePath, "../../..");
    const req = { event, pulse, embeddingStore, memory, hooks, vaultRoot };

    const pipeline = action === "search" ? new SearchPipeline() : new ThinkPipeline();
    const ctx = await pipeline.prepare(req);

    const snap = pulse?.snapshot();
    const temp = snap?.llmTemperature ?? 0.7;
    const maxTok = snap?.llmMaxTokens ?? 400;
    const valence = snap?.llmValence ?? 0;
    console.log(\`[ENGINE] Model: \${OLLAMA_MODEL} (temp: \${temp.toFixed(2)}, tokens: \${maxTok}, val: \${valence >= 0 ? "+" : ""}\${valence.toFixed(2)}, phase: \${snap?.phase ?? "?"})\`);

    let rawOutput = ctx.deterministicAnswer;
    const usedDeterministic = Boolean(rawOutput);
    
    if (!usedDeterministic) {
      // applyMindFilter logic (moved to engine instead of buried)
      const systemPrompt = applyMindFilter(ctx.systemPrompt, { action: action as any, userPrompt: body });
      
      const result = streamText({
        model: ollama(OLLAMA_MODEL),
        system: systemPrompt,
        prompt: body,
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
        .replace(/<think>[\\s\\S]*?<\\/think>\\n?/g, "")
        .replace(/<thinking>[\\s\\S]*?<\\/thinking>\\n?/g, "")
        .trim();
    }
    
    if (!rawOutput) {
      rawOutput = "_[GZMO produced internal reasoning but no visible output.]_";
    }

    let fullText = await pipeline.validateAndShape(rawOutput, req, ctx);
    
    const output = \`\\n---\\n\\n## GZMO Response\\n*\${new Date().toISOString()}*\\n\\n\${fullText}\`;
    await span("frontmatter.completed", () => document.markCompleted(output));

    console.log(\`[ENGINE] Completed: \${fileName} (\${action})\`);

    if (!usedDeterministic && action !== "search" && ctx.state.projectAllowedPaths?.length > 0) {
      const verdict = spanSync("safety.verify.nonsearch", () => verifySafety({
        answer: fullText,
        packet: { snippets: [{ id: "E1", kind: "local_facts", text: ctx.state.projectGrounding || "" }], allowedPaths: ctx.state.projectAllowedPaths },
      }));
      if (verdict) {
        fullText = [
          "insufficient evidence to name file paths safely.",
          "",
          \`Reason: \${verdict}\`,
          "",
          "Next deterministic check: use action: search and ask for the exact path(s), or consult the Project grounding block paths.",
        ].join("\\n");
        // We re-write the completed task to fail-closed
        await document.markCompleted(\`\\n---\\n\\n## GZMO Response\\n*\${new Date().toISOString()}*\\n\\n\${fullText}\`);
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
      summary: fullText.slice(0, 240).replace(/\\s+/g, " ").trim() || undefined,
      tokenCount: fullText.length / 4,
      durationMs,
    });

    if (action === "chain" && frontmatter?.chain_next) {
      const { basename, dirname, join } = await import("path");
      let nextTask = basename(String(frontmatter.chain_next));
      if (!nextTask.endsWith(".md")) nextTask += ".md";

      console.log(\`[ENGINE] Chain → next task: \${nextTask}\`);
      const chainPath = join(dirname(filePath), nextTask);
      const chainContent = \`---\\nstatus: pending\\naction: think\\nchain_from: \${fileName}\\n---\\n\\n## Chained Task\\n\\nPrevious context:\\n\${fullText.slice(0, 300)}\\n\\nContinue from here.\`;

      try {
        if (vaultRoot) {
          await safeWriteText(vaultRoot, chainPath, chainContent);
        } else {
          await Bun.write(chainPath, chainContent);
        }
      } catch (err) {
        console.warn(\`[ENGINE] Chain write failed: \${err}\`);
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
    console.error(\`[ENGINE] Failed: \${fileName} — \${err?.message}\`);

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
}`;

content = content.replace(processTaskRegex, newProcessTask);

fs.writeFileSync('src/engine.ts', content, 'utf-8');
console.log('engine.ts updated successfully.');
