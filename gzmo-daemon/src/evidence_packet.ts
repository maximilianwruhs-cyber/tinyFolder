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

export interface EvidencePacketPart {
  idx: number;
  text: string;
  snippetIds: string[]; // snippet IDs intended for this part (subset of packet.snippets)
}

export interface EvidencePacketMulti {
  packet: EvidencePacket; // union packet (stable E# IDs)
  parts: EvidencePacketPart[]; // ordered by idx
}

function clampText(s: string, maxChars: number): string {
  const t = String(s ?? "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trimEnd() + "\n…";
}

function extractBacktickedPaths(s: string): string[] {
  const out: string[] = [];
  const text = String(s ?? "");
  // Conservative: only allow paths that look like absolute or vault-relative file paths.
  const re = /`([^`\n]{2,240})`/g;
  for (const m of text.matchAll(re)) {
    const raw = String(m[1] ?? "").trim();
    if (!raw) continue;
    if (raw.includes("\t")) continue;
    // Skip things that are clearly not paths.
    if (raw.includes(" ")) continue;
    if (raw.includes("://")) continue;
    if (!(raw.includes("/") || raw.includes("\\"))) continue;
    out.push(raw.replace(/\\/g, "/"));
  }
  return [...new Set(out)];
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
    // Allow paths that appear in deterministic local facts / vault index to pass the safety verifier.
    // These are the most reliable sources for operational outputs like GZMO/TELEMETRY.json.
    for (const p of extractBacktickedPaths(localFacts)) allowed.add(p);
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

function makeSnippetKey(r: { file?: string; heading?: string; text: string }): string {
  return `${r.file ?? ""}::${r.heading ?? ""}::${r.text}`;
}

/**
 * Build a union evidence packet plus a deterministic mapping from numbered parts -> snippet IDs.
 * IDs are assigned globally (E1 local facts if present, then E2.. in insertion order).
 */
export function compileEvidencePacketMulti(params: {
  localFacts?: string;
  globalResults?: SearchResult[];
  parts: { idx: number; text: string; results: SearchResult[] }[];
  maxSnippets?: number;
  maxSnippetChars?: number;
  maxGlobalSnippets?: number;
  maxSnippetsPerPart?: number;
}): EvidencePacketMulti {
  const maxSnippets = params.maxSnippets ?? 12;
  const maxSnippetChars = params.maxSnippetChars ?? 900;
  const maxGlobalSnippets = params.maxGlobalSnippets ?? 4;
  const maxSnippetsPerPart = params.maxSnippetsPerPart ?? 3;

  const snippets: EvidenceSnippet[] = [];
  const allowed = new Set<string>();
  const partsOut: EvidencePacketPart[] = [];
  const seen = new Set<string>();

  const localFacts = (params.localFacts ?? "").trim();
  if (localFacts) {
    for (const p of extractBacktickedPaths(localFacts)) allowed.add(p);
    snippets.push({
      id: "E1",
      kind: "local_facts",
      text: clampText(localFacts, maxSnippetChars * 2),
    });
    seen.add(makeSnippetKey({ file: "LOCAL_FACTS", heading: "local", text: localFacts }));
  }

  const pushResult = (r: SearchResult): string | null => {
    if (snippets.length >= maxSnippets) return null;
    const key = makeSnippetKey(r);
    if (seen.has(key)) return null;
    seen.add(key);
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
    return id;
  };

  // Global results (brief): add first N, then per-part.
  const globalResults = params.globalResults ?? [];
  let globalAdded = 0;
  for (const r of globalResults) {
    if (globalAdded >= maxGlobalSnippets) break;
    const id = pushResult(r);
    if (id) globalAdded++;
  }

  // Per-part results: preserve part order, limit per part, keep mapping to IDs.
  const parts = (params.parts ?? []).slice().sort((a, b) => a.idx - b.idx);
  for (const p of parts) {
    const ids: string[] = [];
    for (const r of p.results) {
      if (ids.length >= maxSnippetsPerPart) break;
      const id = pushResult(r);
      if (id) ids.push(id);
    }
    // If a part has no retrieval snippets, allow citing deterministic local facts (E1) if present.
    // This keeps the per-part citation contract satisfiable while still failing closed on content.
    const filled = ids.length === 0 && snippets.some((s) => s.id === "E1") ? ["E1"] : ids;
    partsOut.push({ idx: p.idx, text: p.text, snippetIds: filled });
  }

  return { packet: { snippets, allowedPaths: [...allowed] }, parts: partsOut };
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

export function renderEvidencePacketMulti(multi: EvidencePacketMulti): string {
  const packet = multi.packet;
  if (!packet.snippets.length) return "";
  const out: string[] = [];
  out.push("## Evidence Packet");
  out.push("Use ONLY these snippets as evidence. Cite by ID like [E2].");
  if (multi.parts.length > 0) {
    out.push("For numbered prompts, output exactly one bullet per part in order, and cite evidence from that part’s IDs.");
  }
  if (multi.parts.length > 0) {
    out.push("");
    out.push("### Per-part evidence map (numbered prompts)");
    for (const p of multi.parts) {
      const ids = p.snippetIds.length > 0 ? p.snippetIds.map((id) => `[${id}]`).join(" ") : "(no relevant snippets)";
      out.push(`- Part ${p.idx}: ${ids}`);
    }
  }
  for (const snip of packet.snippets) {
    const header =
      snip.kind === "local_facts"
        ? `[${snip.id}] Local Facts (deterministic)`
        : `[${snip.id}] ${snip.file ?? "?"} — ${snip.heading ?? "?"} (${snip.score !== undefined ? `${Math.round(snip.score * 100)}%` : "?"})`;
    out.push(header);
    out.push("```");
    out.push(snip.text);
    out.push("```");
  }
  return "\n" + out.join("\n") + "\n";
}

