/**
 * Tripartite identity layering (Task / Context / Coordination).
 * Optional via GZMO_TRIPARTITE_PROMPTS=on — wraps buildSystemPrompt output.
 */

export type CoordinationRole = "PROSECUTOR" | "DEFENDER" | "UMPIRE" | "EXECUTOR";

export interface TripartiteIdentity {
  task: { objective: string; constraints: string[] };
  context: { sessionLogs: string[]; empiricalGrounding: string };
  coordination: { role: CoordinationRole; escalationThreshold: number };
}

export function buildTripartitePrompt(identity: TripartiteIdentity): string {
  const parts: string[] = [];

  parts.push("## TASK LAYER");
  parts.push(`Objective: ${identity.task.objective}`);
  parts.push("Constraints:");
  for (const c of identity.task.constraints) {
    parts.push(`- ${c}`);
  }

  parts.push("\n## CONTEXT LAYER");
  if (identity.context.empiricalGrounding.trim()) {
    parts.push(identity.context.empiricalGrounding.trim());
  }
  if (identity.context.sessionLogs.length > 0) {
    parts.push("Session Logs:");
    for (const l of identity.context.sessionLogs) {
      parts.push(`- ${l}`);
    }
  }

  parts.push("\n## COORDINATION LAYER");
  parts.push(`Current Role: ${identity.coordination.role}`);
  parts.push(`Escalation threshold: ${identity.coordination.escalationThreshold}`);

  if (identity.coordination.role === "PROSECUTOR") {
    parts.push("Rule: Critique the proposal strictly for logical collisions and constraint violations.");
  } else if (identity.coordination.role === "DEFENDER") {
    parts.push("Rule: Defend the proposal, addressing the critique constructively.");
  } else if (identity.coordination.role === "UMPIRE") {
    parts.push("Rule: Synthesize critique and defense into a final resolved output.");
  } else {
    parts.push("Rule: Execute the task within constraints using provided context.");
  }

  return parts.join("\n");
}

export function wrapWithTripartiteLayers(
  basePrompt: string,
  objective: string,
  role: CoordinationRole = "EXECUTOR",
): string {
  const identity: TripartiteIdentity = {
    task: {
      objective,
      constraints: [
        "Follow evidence and citation rules from the base prompt.",
        "Do not invent facts absent from context.",
      ],
    },
    context: {
      sessionLogs: [],
      empiricalGrounding: basePrompt,
    },
    coordination: { role, escalationThreshold: 0.5 },
  };
  return buildTripartitePrompt(identity);
}
