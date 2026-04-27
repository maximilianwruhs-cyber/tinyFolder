function normalize(s: string): string {
  return String(s ?? "").trim();
}

export function extractAnchors(params: {
  file: string;
  heading: string;
  text: string;
  maxAnchors?: number;
}): string[] {
  const max = params.maxAnchors ?? 30;
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (a: string) => {
    const v = normalize(a);
    if (!v) return;
    if (v.length < 3 || v.length > 80) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  // Wikilinks [[Page]] / [[Page|alias]]
  for (const m of params.text.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]]+)?\]\]/g)) {
    add(m[1]!);
    if (out.length >= max) return out;
  }

  // Backticked identifiers/paths
  for (const m of params.text.matchAll(/`([^`\n]{3,80})`/g)) {
    add(m[1]!);
    if (out.length >= max) return out;
  }

  // Headings (shallow)
  add(params.heading);

  // Title-case-ish terms (very conservative)
  const titleMatches = params.text.match(/\b[A-Z][a-z]+(?:[-_][A-Z][a-z]+|\s+[A-Z][a-z]+){0,3}\b/g) ?? [];
  for (const t of titleMatches.slice(0, 80)) {
    add(t);
    if (out.length >= max) return out;
  }

  return out;
}

