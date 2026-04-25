import type { DoctorFixSuggestion } from "./types";

export interface OllamaDiscovery {
  ok: boolean;
  baseUrl?: string; // e.g. http://127.0.0.1:11434
  v1Url?: string; // e.g. http://127.0.0.1:11434/v1
  details: string;
  models?: string[];
  requiredMissing?: string[];
  fix?: DoctorFixSuggestion[];
}

function stripV1(url: string) {
  return url.endsWith("/v1") ? url.slice(0, -3) : url;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<any> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  return await resp.json();
}

export async function discoverOllama(params: {
  preferredV1Url?: string;
  modelRequired?: string[];
  signal: AbortSignal;
  env?: { httpProxy?: string; httpsProxy?: string; noProxy?: string };
}): Promise<OllamaDiscovery> {
  const required = params.modelRequired ?? [];
  const candidatesBase = [];

  if (params.preferredV1Url) {
    candidatesBase.push(stripV1(params.preferredV1Url));
  }

  // Common defaults. Keep short; avoid scanning the world.
  candidatesBase.push("http://127.0.0.1:11434");
  candidatesBase.push("http://localhost:11434");

  // De-dupe
  const seen = new Set<string>();
  const bases = candidatesBase.filter((b) => {
    const k = b.replace(/\/+$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const proxyFix: DoctorFixSuggestion | null =
    params.env?.httpProxy || params.env?.httpsProxy
      ? {
          id: "proxy.no_proxy",
          title: "Set NO_PROXY for local Ollama",
          severity: "warn",
          rationale: "A proxy env var is set; local HTTP calls to Ollama can be misrouted or refused.",
          commands: [`export NO_PROXY=\"localhost,127.0.0.1\"`],
          docs: [],
        }
      : null;

  for (const base of bases) {
    try {
      const tags = await fetchJson(`${base}/api/tags`, params.signal);
      const models: string[] = Array.isArray(tags?.models)
        ? tags.models.map((m: any) => String(m?.name ?? "")).filter(Boolean)
        : [];
      const hasModel = (req: string) =>
        models.includes(req) ||
        models.includes(`${req}:latest`) ||
        models.some((m) => m.startsWith(`${req}:`));
      const missing = required.filter((r) => !hasModel(r));
      return {
        ok: missing.length === 0,
        baseUrl: base,
        v1Url: `${base}/v1`,
        models,
        requiredMissing: missing.length ? missing : undefined,
        details: missing.length ? `reachable, missing models: ${missing.join(", ")}` : "reachable",
        fix:
          missing.length
            ? [
                ...(proxyFix ? [proxyFix] : []),
                {
                  id: "ollama.pull_models",
                  title: "Pull required Ollama models",
                  severity: "error",
                  rationale: "Doctor requires these models for deep checks.",
                  commands: missing.map((m) => `ollama pull ${m}`),
                  docs: [],
                },
              ]
            : proxyFix
              ? [proxyFix]
              : undefined,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    details: "No reachable Ollama endpoint found (tried localhost/127.0.0.1:11434 and preferred URL).",
    fix: [
      ...(proxyFix ? [proxyFix] : []),
      {
        id: "ollama.serve",
        title: "Start Ollama",
        severity: "error",
        rationale: "Ollama must be running for LLM/embedding checks.",
        commands: ["ollama serve"],
        docs: [],
      },
    ],
  };
}

export async function ollamaChatJson(params: {
  v1Url: string;
  model: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<string> {
  const url = `${params.v1Url.replace(/\/+$/, "")}/chat/completions`;
  const resp = await fetch(url, {
    method: "POST",
    signal: params.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      stream: false,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const json: any = await resp.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("unexpected Ollama response shape");
  return text.trim();
}
