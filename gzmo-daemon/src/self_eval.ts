import { streamText } from "ai";

export async function selfEvalAndRewrite(params: {
  model: any;
  userPrompt: string;
  answer: string;
  context?: string;
  maxTokens?: number;
}): Promise<{ rewritten: string | null; report: string }> {
  const maxTokens = params.maxTokens ?? 220;
  const system = [
    "You are a strict verifier and editor.",
    "Goal: improve truthfulness without changing intent.",
    "",
    "Rules:",
    "- Only use evidence from the provided CONTEXT block.",
    "- If a claim is not supported by CONTEXT, mark it unsupported and remove/soften it in the rewrite.",
    "- Keep the rewrite concise and preserve the user's requested structure as much as possible.",
    "- Output TWO sections in Markdown exactly:",
    "  1) ## Self-check (claims table) — 3 to 8 bullets, each with Supported/Unsupported + evidence pointer.",
    "  2) ## Rewritten answer — the corrected answer only.",
  ].join("\n");

  const prompt = [
    "CONTEXT:",
    params.context?.trim() ? params.context.trim() : "(none)",
    "",
    "USER_PROMPT:",
    params.userPrompt.trim(),
    "",
    "ANSWER_TO_CHECK:",
    params.answer.trim(),
  ].join("\n");

  const result = streamText({
    model: params.model,
    system,
    prompt,
    temperature: 0.1,
    maxTokens,
  } as any);

  let text = "";
  for await (const chunk of result.textStream) text += chunk;
  text = text.trim();

  const rewritten = text.match(/##\s*Rewritten answer\s*\n([\s\S]*)/i)?.[1]?.trim() ?? null;
  const report = text.match(/##\s*Self-check[\s\S]*?(?=##\s*Rewritten answer)/i)?.[0]?.trim() ?? "";
  return { rewritten: rewritten && rewritten.length > 0 ? rewritten : null, report: report || text };
}

