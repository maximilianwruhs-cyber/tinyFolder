import type { SearchResult } from "./search";

export interface EvidenceSnippet {
  id: string; // stable within one response (E1, E2, ...)
  kind: "local_facts" | "retrieval";
  file?: string;
  heading?: string;
  score?: number;
  text: string;
  metadata?: SearchResult["metadata"];
}

export interface EvidencePacket {
  snippets: EvidenceSnippet[];
  allowedPaths: string[]; // file paths that appeared in evidence
}

function clampText(s: string, maxChars: number): string {
  const t = String(s ?? "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trimEnd() + "\n…";
}

export function compileEvidencePacket(params: {
  localFacts?: string;
  results?: SearchResult[];
  maxSnippets?: number;
  maxSnippetChars?: number;
}): EvidencePacket {
  const maxSnippets = params.maxSnippets ?? 10;
  const maxSnippetChars = params.maxSnippetChars ?? 900;
  const snippets: EvidenceSnippet[] = [];
  const allowed = new Set<string>();

  const localFacts = (params.localFacts ?? "").trim();
  if (localFacts) {
    snippets.push({
      id: "E1",
      kind: "local_facts",
      text: clampText(localFacts, maxSnippetChars * 2),
    });
  }

  const results = params.results ?? [];
  for (const r of results) {
    if (snippets.length >= maxSnippets) break;
    const id = `E${snippets.length + 1}`;
    snippets.push({
      id,
      kind: "retrieval",
      file: r.file,
      heading: r.heading,
      score: r.score,
      text: clampText(r.text, maxSnippetChars),
      metadata: r.metadata,
    });
    if (r.file) allowed.add(r.file);
  }

  return { snippets, allowedPaths: [...allowed] };
}

export function renderEvidencePacket(packet: EvidencePacket): string {
  if (!packet.snippets.length) return "";
  const parts: string[] = [];
  parts.push("## Evidence Packet");
  parts.push("Use ONLY these snippets as evidence. Cite by ID like [E2].");
  for (const snip of packet.snippets) {
    const header =
      snip.kind === "local_facts"
        ? `[${snip.id}] Local Facts (deterministic)`
        : `[${snip.id}] ${snip.file ?? "?"} — ${snip.heading ?? "?"} (${snip.score !== undefined ? `${Math.round(snip.score * 100)}%` : "?"})`;
    parts.push(header);
    parts.push("```");
    parts.push(snip.text);
    parts.push("```");
  }
  return "\n" + parts.join("\n") + "\n";
}

