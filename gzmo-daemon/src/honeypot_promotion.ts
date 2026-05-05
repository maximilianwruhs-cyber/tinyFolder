import { safeWriteText } from "./vault_fs";
import { type EdgeStore, type HoneypotEdgeCandidate } from "./honeypot_edges";
import { slugifyTitle, writeHoneypotNode, type HoneypotNode } from "./honeypot_nodes";
import { updateExecutableMasterIndex } from "./executable_master_index";
import { readCoreWisdomRouting } from "./core_wisdom";
import { validateEdgeCandidate } from "./linc_filter";

interface HoneypotDigest {
  promotedPairs: Record<string, { nodeSlug: string; promoted_at: string }>;
  lastRun: string;
}

const DIGEST_PATH = "GZMO/.gzmo_honeypot_digest.json";

function readIntEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, n));
}

function readFloatEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, n));
}

function isoToMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function pairKey(a: string, b: string): string {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return [x, y].sort((p, q) => p.localeCompare(q)).join("::");
}

export class HoneypotPromotionEngine {
  private vaultPath: string;
  private edgeStore: EdgeStore;
  private digest: HoneypotDigest = { promotedPairs: {}, lastRun: "" };
  private digestLoaded = false;

  constructor(vaultPath: string, edgeStore: EdgeStore) {
    this.vaultPath = vaultPath;
    this.edgeStore = edgeStore;
  }

  private async ensureDigest(): Promise<void> {
    if (this.digestLoaded) return;
    this.digestLoaded = true;
    try {
      const f = Bun.file(`${this.vaultPath}/${DIGEST_PATH}`);
      if (await f.exists()) {
        const parsed = await f.json();
        if (parsed && typeof parsed === "object") {
          const rec = parsed as Partial<HoneypotDigest>;
          this.digest = {
            promotedPairs: (rec.promotedPairs && typeof rec.promotedPairs === "object") ? rec.promotedPairs as any : {},
            lastRun: typeof rec.lastRun === "string" ? rec.lastRun : "",
          };
        }
      }
    } catch {
      // keep defaults
    }
  }

  private async saveDigest(): Promise<void> {
    await safeWriteText(this.vaultPath, `${this.vaultPath}/${DIGEST_PATH}`, JSON.stringify(this.digest, null, 2)).catch(() => {});
  }

  async cycle(): Promise<{ promoted: number; nodes: string[] }> {
    await this.ensureDigest();

    const routing = await readCoreWisdomRouting(this.vaultPath).catch(() => null);
    const routed = routing?.pipelines?.edgeIngest ?? {};

    const windowHours = readIntEnv("GZMO_HONEYPOT_WINDOW_HOURS", Number(routed.windowHours ?? 24), 1, 24 * 30);
    const maxPromotions = readIntEnv("GZMO_HONEYPOT_PROMOTE_BUDGET", Number(routed.promoteBudget ?? 2), 1, 20);

    // Thresholds can stay env-driven for now; they can be moved into Core Wisdom later.
    const kEdges = readIntEnv("GZMO_HONEYPOT_PROMOTE_K", 3, 2, 50);
    const mSources = readIntEnv("GZMO_HONEYPOT_PROMOTE_M", 2, 1, 20);
    const qConfidence = readFloatEnv("GZMO_HONEYPOT_PROMOTE_Q", 0.6, 0.0, 1.0);

    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;

    let edges: HoneypotEdgeCandidate[] = [];
    try {
      edges = await this.edgeStore.readAll();
    } catch {
      this.digest.lastRun = new Date().toISOString();
      await this.saveDigest();
      return { promoted: 0, nodes: [] };
    }

    const recent = edges.filter((e) => isoToMs(e.created_at) >= cutoff);
    if (recent.length === 0) {
      this.digest.lastRun = new Date().toISOString();
      await this.saveDigest();
      return { promoted: 0, nodes: [] };
    }

    // Filter by L.I.N.C. if available: drop edges with linc_score below threshold.
    const lincMinScore = readFloatEnv("GZMO_HONEYPOT_LINC_MIN", 0.5, 0.0, 1.0);
    const lincEnabled = String(process.env.GZMO_LINC_FILTER ?? "on").toLowerCase() !== "off";
    const lincFiltered = lincEnabled
      ? recent.filter((e) => {
          // If edge already has linc_score from self_ask emission, use it.
          // Otherwise, validate on-the-fly (handles legacy edges without scores).
          if (e.linc_score === undefined) {
            const v = validateEdgeCandidate(e);
            e.linc_score = v.score;
            e.linc_violations = v.violations;
          }
          return (e.linc_score ?? 0) >= lincMinScore;
        })
      : recent;

    if (lincFiltered.length === 0) {
      console.log(`[LINC-PROMOTION] All ${recent.length} edges filtered (threshold=${lincMinScore})`);
      this.digest.lastRun = new Date().toISOString();
      await this.saveDigest();
      return { promoted: 0, nodes: [] };
    }

    // Cluster heuristic v0: group by unordered node pair.
    const clusters = new Map<string, HoneypotEdgeCandidate[]>();
    for (const e of lincFiltered) {
      const key = pairKey(e.from, e.to);
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(e);
    }

    const scored = [...clusters.entries()].map(([key, es]) => {
      const avg = es.reduce((a, b) => a + (Number(b.confidence) || 0), 0) / Math.max(1, es.length);
      // Factor in L.I.N.C. scores: weighted blend of confidence and linc_score.
      const avgLinc = es.reduce((a, b) => a + (Number(b.linc_score) || 0), 0) / Math.max(1, es.length);
      const compositeScore = avg * 0.6 + avgLinc * 0.4; // 60% confidence, 40% LINC quality
      const cabinetFiles = new Set(es.map((x) => x.source_refs?.cabinet_file).filter(Boolean) as string[]);
      return { key, edges: es, avgConfidence: compositeScore, sourceCount: cabinetFiles.size, edgeCount: es.length };
    })
      .filter((c) => c.edgeCount >= kEdges && c.sourceCount >= mSources && c.avgConfidence >= qConfidence)
      .sort((a, b) => (b.edgeCount - a.edgeCount) || (b.avgConfidence - a.avgConfidence));

    const promoted: string[] = [];
    for (const c of scored) {
      if (promoted.length >= maxPromotions) break;
      if (this.digest.promotedPairs[c.key]) continue; // already promoted

      const parts = c.key.split("::");
      const a = parts[0] ?? "";
      const b = parts[1] ?? "";
      const title = `HP ${a} × ${b}`;
      const slug = slugifyTitle(title);

      const cabinetFiles = [...new Set(c.edges.map((x) => x.source_refs?.cabinet_file).filter(Boolean) as string[])].slice(0, 20);
      const claims = c.edges.map((x) => x.claim).filter(Boolean).slice(0, 8);
      const quotes = c.edges.flatMap((x) => x.evidence_quotes ?? []).filter(Boolean).slice(0, 4);

      const node: HoneypotNode = {
        type: "honeypot_node",
        layer: 1,
        title,
        slug,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        confidence: Math.max(0.0, Math.min(1.0, c.avgConfidence)),
        status: "compiled",
        tags: ["honeypot", "layer-1", "intersection"],
        summary: `Promoted intersection between ${a} and ${b} from ${c.edgeCount} edge candidates (window=${windowHours}h).`,
        distilled_claims: claims,
        invariants: quotes.length ? quotes.map((q) => `Evidence quote: "${q}"`) : [],
        contradictions: [],
        sources: cabinetFiles.map((f) => `GZMO/Thought_Cabinet/${f}`),
        primary_links: [a, b],
        context_links: [],
        child_nodes: [a, b],
        child_edges: [],
      };

      await writeHoneypotNode(this.vaultPath, node).catch(() => {});
      this.digest.promotedPairs[c.key] = { nodeSlug: slug, promoted_at: new Date().toISOString() };
      promoted.push(`${slug}.md`);
    }

    this.digest.lastRun = new Date().toISOString();
    await this.saveDigest();

    // Keep the Executable master index aligned with promoted honeypots.
    if (promoted.length > 0) {
      await updateExecutableMasterIndex(this.vaultPath, { note: `Promoted ${promoted.length} honeypot(s).` }).catch(() => {});
    }
    return { promoted: promoted.length, nodes: promoted };
  }
}

