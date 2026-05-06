/**
 * CLI: bun run trace:view -- <trace_id_or_task_file> [--thinking]
 */
import { resolve, join } from "path";
import { existsSync } from "fs";
import { findTracesForTask, type ReasoningTrace } from "./reasoning_trace";

function renderTrace(trace: ReasoningTrace): void {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Trace: ${trace.trace_id}`);
  console.log(`  Task:  ${trace.task_file} (${trace.action})`);
  console.log(`  Model: ${trace.model} | Status: ${trace.status}`);
  console.log(`  Nodes: ${trace.nodes.length} | Time: ${trace.total_elapsed_ms}ms`);
  console.log(`═══════════════════════════════════════════════\n`);

  for (const node of trace.nodes) {
    const indent = "  ".repeat(node.depth);
    const icon =
      {
        task_start: "📋",
        analyze: "🔍",
        retrieve: "📚",
        vault_read: "📄",
        dir_list: "📂",
        reason: "🧠",
        verify: "✅",
        tool_call: "🔧",
        answer: "💬",
        retry: "🔄",
        abstain: "⚠️",
        critique: "📝",
        replan: "🔁",
      }[node.type] ?? "•";

    console.log(`${indent}${icon} [${node.type}] ${node.prompt_summary}`);
    if (node.outcome !== "success") {
      console.log(`${indent}   → outcome: ${node.outcome}`);
    }
    if (node.raw_thinking && process.argv.includes("--thinking")) {
      const lines = node.raw_thinking.split("\n").slice(0, 6);
      for (const line of lines) {
        console.log(`${indent}   │ ${line.slice(0, 100)}`);
      }
      if (node.raw_thinking.split("\n").length > 6) {
        console.log(`${indent}   │ ... (${node.raw_thinking.split("\n").length - 6} more lines)`);
      }
    }
  }

  console.log(
    `\n── Final answer ──\n${trace.final_answer.slice(0, 400)}${trace.final_answer.length > 400 ? "..." : ""}\n`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = argv.find((a) => !a.startsWith("-"));
  if (!arg) {
    console.error("Usage: bun run src/trace_viewer.ts <trace_id_or_task_file> [--thinking]");
    process.exit(1);
  }

  const vaultPath = process.env.VAULT_PATH ?? resolve(import.meta.dir, "../../vault");
  const tracesDir = join(vaultPath, "GZMO", "Reasoning_Traces");

  if (!existsSync(tracesDir)) {
    console.error(`No traces directory: ${tracesDir}`);
    process.exit(1);
  }

  const byId = join(tracesDir, `${arg}.json`);
  if (existsSync(byId)) {
    const trace = JSON.parse(await Bun.file(byId).text()) as ReasoningTrace;
    renderTrace(trace);
    return;
  }

  const traces = await findTracesForTask(vaultPath, arg);
  if (traces.length === 0) {
    console.error(`No trace found for: ${arg}`);
    process.exit(1);
  }

  for (const trace of traces.slice(0, 5)) {
    renderTrace(trace);
  }
}

if (import.meta.main) main();
