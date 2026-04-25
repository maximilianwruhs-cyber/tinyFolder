import * as path from "path";

export interface AnchorVerificationSource {
  label: string;
  text: string;
}

export interface AnchorVerificationResult {
  anchor: string;
  verified: boolean;
  source?: string;
}

export async function loadAnchorSources(params: {
  vaultPath: string;
  taskRequest?: string;
  modelResponse?: string;
  files?: string[];
}): Promise<AnchorVerificationSource[]> {
  const sources: AnchorVerificationSource[] = [];
  if (params.taskRequest) sources.push({ label: "Task request", text: params.taskRequest });
  if (params.modelResponse) sources.push({ label: "Model response", text: params.modelResponse });

  for (const file of params.files ?? []) {
    const normalized = file.replace(/\\/g, "/");
    try {
      const text = await Bun.file(path.join(params.vaultPath, normalized)).text();
      sources.push({ label: normalized, text });
    } catch {
      // Missing files simply cannot verify anchors.
    }
  }
  return sources;
}

export function verifyAnchors(
  anchors: string[],
  sources: AnchorVerificationSource[],
): AnchorVerificationResult[] {
  return anchors
    .map(cleanAnchor)
    .filter((anchor) => anchor.length >= 8)
    .map((anchor) => {
      const normalizedAnchor = normalizeWhitespace(anchor);
      const source = sources.find((candidate) => normalizeWhitespace(candidate.text).includes(normalizedAnchor));
      return source
        ? { anchor, verified: true, source: source.label }
        : { anchor, verified: false };
    });
}

export function summarizeAnchorFailures(results: AnchorVerificationResult[]): string[] {
  return results
    .filter((result) => !result.verified)
    .map((result) => `Missing exact anchor: "${result.anchor.slice(0, 120)}"`);
}

function cleanAnchor(anchor: string): string {
  return anchor
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
