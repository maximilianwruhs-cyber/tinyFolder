/**
 * knowledge_graph/graph.ts — Self-developing Knowledge Graph
 *
 * Nodes: entities, claims, sources, sessions
 * Edges: supports | contradicts | refines | part_of | similar_to | derived_from
 *
 * The graph auto-evolves:
 *   1. Every claim recorded is a claim node with a source edge.
 *   2. Claims linked by shared entities get `similar_to` edges via embedding sim.
 *   3. Contradictions detected become `contradicts` edges + auto-hypothesis node.
 *   4. Hot subgraphs (frequently queried) get auto-deepened via research loop.
 *
 * Persistence: line-delimited JSON in vault/GZMO/Knowledge_Graph/
 */

import { join } from "path";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { safeAppendJsonl, atomicWriteJson } from "../vault_fs";

// ── Types ──────────────────────────────────────────────────────

export type KgNodeType = "entity" | "claim" | "source" | "session" | "hypothesis" | "query";

export interface ExtractedEntity {
  text: string;
  type: "person" | "organization" | "concept" | "file" | "code_symbol";
  confidence: number; // 0..1
  sourceFile: string;
  span: { start: number; end: number };
}

/**
 * Extract entities from an answer using lightweight, deterministic heuristics.
 *
 * Intentionally no LLM calls: this must be safe to run on every task completion.
 */
export function extractEntities(answer: string, sourceFile: string): ExtractedEntity[] {
  const text = String(answer ?? "");
  const entities: ExtractedEntity[] = [];

  // File references: backticked or bare relative paths with common extensions.
  const fileRefs = [...text.matchAll(/`?([\w\-./]+\.(?:md|ts|tsx|js|json))`?/g)];
  for (const m of fileRefs) {
    const ref = m[1] ?? "";
    if (!ref) continue;
    // Avoid path traversal patterns.
    if (ref.includes("..")) continue;
    entities.push({
      text: ref,
      type: "file",
      confidence: 0.9,
      sourceFile,
      span: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
    });
  }

  // Code symbols: CamelCase identifiers.
  const codeSymbols = [...text.matchAll(/\b([A-Z][a-zA-Z0-9_]{2,})\b/g)];
  for (const m of codeSymbols) {
    const sym = m[1] ?? "";
    if (!sym) continue;
    if (entities.some((e) => e.type === "code_symbol" && e.text === sym)) continue;
    entities.push({
      text: sym,
      type: "code_symbol",
      confidence: 0.6,
      sourceFile,
      span: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
    });
  }

  // Capitalized phrases (3+ words) as potential concepts.
  const conceptRefs = [...text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,})\b/g)];
  for (const m of conceptRefs) {
    const phrase = (m[1] ?? "").trim();
    if (!phrase) continue;
    if (entities.some((e) => e.text === phrase)) continue;
    entities.push({
      text: phrase,
      type: "concept",
      confidence: 0.5,
      sourceFile,
      span: { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
    });
  }

  return entities;
}

export interface KgNode {
  id: string;
  type: KgNodeType;
  label: string;
  created_at: string;
  updated_at: string;
  version: number;      // incremented on every mutation
  confidence?: number;  // for claims
  embedding?: number[]; // for semantic edge creation
  metadata?: Record<string, unknown>;
  /** Compute a content hash from label+metadata to detect duplicates. */
  content_hash?: string;
}

export type KgEdgeType = "supports" | "contradicts" | "refines" | "part_of" | "similar_to" | "derived_from" | "mentions" | "generated_by";

export interface KgEdge {
  id: string;
  from: string;
  to: string;
  type: KgEdgeType;
  weight: number;
  created_at: string;
  evidence?: string;   // human-readable evidence snippet
  metadata?: Record<string, unknown>;
}

export interface KgSnapshot {
  nodes: Record<string, KgNode>;
  edges: Record<string, KgEdge>;
  query_log: KgQueryEntry[];
  version_counter: number;
}

export interface KgQueryEntry {
  ts: string;
  query: string;
  nodeIds: string[];
  edgeIds: string[];
  hits: number;
}

export interface KgSearchAugment {
  topicNodes: KgNode[];
  connectedClaims: Array<{ claim: KgNode; evidenceFiles: string[] }>;
  graphDistance: number;
}

// ── Internal Helpers ───────────────────────────────────────────

const _instances = new Map<string, KnowledgeGraph>();

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ── Graph ──────────────────────────────────────────────────────

export class KnowledgeGraph {
  private vaultPath: string;
  private dir: string;
  private nodesPath: string;
  private edgesPath: string;
  private queryLogPath: string;
  private nodes = new Map<string, KgNode>();
  private edges = new Map<string, KgEdge>();
  private queryLog: KgQueryEntry[] = [];
  private loaded = false;
  private dirty = false;
  private versionCounter = 1;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.dir = join(vaultPath, "GZMO", "Knowledge_Graph");
    this.nodesPath = join(this.dir, "nodes.jsonl");
    this.edgesPath = join(this.dir, "edges.jsonl");
    this.queryLogPath = join(this.dir, "query_log.jsonl");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  /** Singleton per vault (avoids double-loading). */
  static forVault(vaultPath: string): KnowledgeGraph {
    const key = String(vaultPath || "");
    if (!_instances.has(key)) {
      _instances.set(key, new KnowledgeGraph(key));
    }
    return _instances.get(key)!;
  }

  /** Reset singleton (useful for testing). */
  static reset(vaultPath: string): void {
    _instances.delete(String(vaultPath || ""));
  }

  static resetAll(): void {
    _instances.clear();
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    // Load nodes from JSONL
    if (existsSync(this.nodesPath)) {
      const raw = readFileSync(this.nodesPath, "utf-8");
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          const n = JSON.parse(line) as KgNode;
          this.nodes.set(n.id, n);
        } catch {}
      }
    }
    // Load edges
    if (existsSync(this.edgesPath)) {
      const raw = readFileSync(this.edgesPath, "utf-8");
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          const e = JSON.parse(line) as KgEdge;
          this.edges.set(e.id, e);
        } catch {}
      }
    }
    // Load query log
    if (existsSync(this.queryLogPath)) {
      const raw = readFileSync(this.queryLogPath, "utf-8");
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          const q = JSON.parse(line) as KgQueryEntry;
          this.queryLog.push(q);
        } catch {}
      }
    }
    this.versionCounter = 1 + this.nodes.size + this.edges.size;
  }

  // ── Node CRUD ────────────────────────────────────────────────

  private nextId(prefix: string): string {
    return `${prefix}_${simpleHash(`${Date.now()}_${Math.random()}`)}_${this.versionCounter++}`;
  }

  addNode(n: Omit<KgNode, "id" | "created_at" | "updated_at" | "version"> & Partial<Pick<KgNode, "id">>): string {
    const id = n.id ?? this.nextId(n.type);
    const now = new Date().toISOString();
    const node: KgNode = {
      ...n,
      id,
      created_at: now,
      updated_at: now,
      version: 1,
    } as KgNode;
    // Merge if existing (update version)
    const existing = this.nodes.get(id);
    if (existing) {
      node.version = existing.version + 1;
      node.created_at = existing.created_at;
    }
    this.nodes.set(id, node);
    this.dirty = true;
    return id;
  }

  getNode(id: string): KgNode | undefined { return this.nodes.get(id); }

  removeNode(id: string): void {
    this.nodes.delete(id);
    // cascade delete edges
    for (const [eid, e] of this.edges) {
      if (e.from === id || e.to === id) this.edges.delete(eid);
    }
    this.dirty = true;
  }

  private findOrCreateNodeByHash(type: KgNodeType, label: string, metadata?: Record<string, unknown>): string {
    const contentHash = simpleHash(`${type}:${label}:${JSON.stringify(metadata ?? {})}`);
    for (const [id, n] of this.nodes) {
      if (n.type === type && n.content_hash === contentHash) return id;
    }
    return this.addNode({ type, label, metadata, content_hash: contentHash });
  }

  upsertSource(label: string, metadata?: Record<string, unknown>): string {
    return this.findOrCreateNodeByHash("source", label, metadata);
  }

  upsertEntity(label: string, metadata?: Record<string, unknown>): string {
    return this.findOrCreateNodeByHash("entity", label, metadata);
  }

  upsertClaim(claimText: string, sourceNodeId: string, confidence = 0.8): string {
    const contentHash = simpleHash(claimText);
    // Deduplicate by content hash
    for (const [id, n] of this.nodes) {
      if (n.type === "claim" && n.content_hash === contentHash) {
        // Increment confidence on repeated observation
        n.confidence = Math.min(1, (n.confidence ?? 0.5) + 0.05);
        n.updated_at = new Date().toISOString();
        n.version++;
        this.addEdge(id, sourceNodeId, "supports", 0.6, "Reinforced by additional source");
        return id;
      }
    }
    const id = this.addNode({ type: "claim", label: claimText, confidence, content_hash: contentHash });
    this.addEdge(id, sourceNodeId, "supports", 0.7);
    return id;
  }

  // ── Edge CRUD ────────────────────────────────────────────────

  addEdge(from: string, to: string, type: KgEdgeType, weight = 1.0, evidence?: string): string {
    const id = this.nextId("edge");
    const edge: KgEdge = {
      id,
      from,
      to,
      type,
      weight,
      created_at: new Date().toISOString(),
      evidence,
    };
    this.edges.set(id, edge);
    this.dirty = true;
    return id;
  }

  getEdgesForNode(nodeId: string): KgEdge[] {
    return [...this.edges.values()].filter((e) => e.from === nodeId || e.to === nodeId);
  }

  findEdge(from: string, to: string, type: KgEdgeType): KgEdge | undefined {
    return [...this.edges.values()].find((e) => e.from === from && e.to === to && e.type === type);
  }

  // ── Semantic auto-linking ────────────────────────────────────

  /**
   * Compute cosine sim and create `similar_to` edges for nearby claim pairs.
   * Call periodically or after a batch of new claims.
   */
  async autoLinkSimilar(ollamaBaseUrl: string, threshold = 0.82): Promise<number> {
    const claims = [...this.nodes.values()].filter((n) => n.type === "claim" && !n.embedding);
    if (claims.length === 0) return 0;

    // Embed unembedded claims
    for (const c of claims) {
      try {
        const vec = await embedText(c.label, ollamaBaseUrl);
        c.embedding = vec;
        c.updated_at = new Date().toISOString();
        c.version++;
      } catch {
        continue;
      }
    }

    const allClaims = [...this.nodes.values()].filter((n) => n.type === "claim" && n.embedding);
    let created = 0;
    for (let i = 0; i < allClaims.length; i++) {
      for (let j = i + 1; j < allClaims.length; j++) {
        const a = allClaims[i]!;
        const b = allClaims[j]!;
        const sim = cosineSim(a.embedding!, b.embedding!);
        if (sim >= threshold && !this.findEdge(a.id, b.id, "similar_to")) {
          this.addEdge(a.id, b.id, "similar_to", sim, `Embedding similarity ${sim.toFixed(3)}`);
          created++;
        }
      }
    }
    return created;
  }

  // ── Contradiction graph evolution ────────────────────────────

  detectContradictions(): Array<{ claimA: string; claimB: string; strength: number }> {
    const claims = [...this.nodes.values()].filter((n) => n.type === "claim");
    const out: Array<{ claimA: string; claimB: string; strength: number }> = [];
    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i]!;
        const b = claims[j]!;
        const r = detectContradiction(a.label, b.label);
        if (r.contradiction) {
          out.push({ claimA: a.id, claimB: b.id, strength: r.strength });
          if (!this.findEdge(a.id, b.id, "contradicts")) {
            this.addEdge(a.id, b.id, "contradicts", r.strength, "Auto-detected contradiction");
          }
        }
      }
    }
    return out;
  }

  // ── Query & hot-region tracking ──────────────────────────────

  query(params: {
    nodeTypes?: KgNodeType[];
    labelPattern?: RegExp;
    edgeTypes?: KgEdgeType[];
    fromNodeId?: string;
    toNodeId?: string;
    limit?: number;
  }): { nodes: KgNode[]; edges: KgEdge[] } {
    let nodes = [...this.nodes.values()];
    if (params.nodeTypes) nodes = nodes.filter((n) => params.nodeTypes!.includes(n.type));
    if (params.labelPattern) nodes = nodes.filter((n) => params.labelPattern!.test(n.label));

    let edges = [...this.edges.values()];
    if (params.edgeTypes) edges = edges.filter((e) => params.edgeTypes!.includes(e.type));
    if (params.fromNodeId) edges = edges.filter((e) => e.from === params.fromNodeId);
    if (params.toNodeId) edges = edges.filter((e) => e.to === params.toNodeId);

    const hitNodeIds = new Set<string>();
    for (const e of edges) { hitNodeIds.add(e.from); hitNodeIds.add(e.to); }
    nodes = nodes.filter((n) => hitNodeIds.has(n.id));

    if (params.limit) {
      nodes = nodes.slice(0, params.limit);
      const keep = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    }

    // Log query
    this.queryLog.push({
      ts: new Date().toISOString(),
      query: JSON.stringify(params),
      nodeIds: nodes.map((n) => n.id),
      edgeIds: edges.map((e) => e.id),
      hits: nodes.length + edges.length,
    });

    return { nodes, edges };
  }

  /** Hot nodes: most touched by queries + most edges. */
  hotNodes(n = 10): KgNode[] {
    const scores = new Map<string, number>();
    for (const q of this.queryLog) {
      for (const id of q.nodeIds) scores.set(id, (scores.get(id) ?? 0) + 1);
    }
    for (const e of this.edges.values()) {
      scores.set(e.from, (scores.get(e.from) ?? 0) + e.weight);
      scores.set(e.to, (scores.get(e.to) ?? 0) + e.weight);
    }
    return [...this.nodes.values()]
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
      .slice(0, n);
  }

  /** Subgraph around a node (BFS up to depth). */
  subgraph(centerId: string, depth = 2): { nodes: KgNode[]; edges: KgEdge[] } {
    const visited = new Set<string>();
    const queue: Array<{ id: string; d: number }> = [{ id: centerId, d: 0 }];
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      if (cur.d >= depth) continue;
      for (const e of this.edges.values()) {
        if (e.from === cur.id) queue.push({ id: e.to, d: cur.d + 1 });
        if (e.to === cur.id) queue.push({ id: e.from, d: cur.d + 1 });
      }
    }
    const sn = [...this.nodes.values()].filter((n) => visited.has(n.id));
    const se = [...this.edges.values()].filter((e) => visited.has(e.from) && visited.has(e.to));
    return { nodes: sn, edges: se };
  }

  /**
   * Graph-based search augmentation (bounded + best-effort):
   * - Prefer semantic match when embeddings are available (embed query + cosineSim).
   * - Fall back to substring match when embeddings are unavailable.
   * - Collect connected claims within N hops and return their evidence source files.
   */
  async augmentSearch(
    query: string,
    ollamaBaseUrl: string,
    opts?: { maxTopicNodes?: number; hops?: number; minSimilarity?: number; maxEmbedNodes?: number },
  ): Promise<KgSearchAugment> {
    const q = String(query ?? "").toLowerCase().trim();
    const maxTopicNodes = Math.max(1, Math.min(10, opts?.maxTopicNodes ?? 5));
    const hops = Math.max(1, Math.min(3, opts?.hops ?? 2));
    if (!q) return { topicNodes: [], connectedClaims: [], graphDistance: hops };

    const minSimilarity = Math.max(0.5, Math.min(0.95, opts?.minSimilarity ?? 0.78));
    const maxEmbedNodes = Math.max(0, Math.min(12, opts?.maxEmbedNodes ?? 6));

    // 1) Try semantic match (bounded): embed query, then compare to nodes with embeddings.
    let topicNodes: KgNode[] = [];
    try {
      const qVec = await embedText(q.slice(0, 300), ollamaBaseUrl);

      // Candidate nodes to consider for semantic matching.
      const candidates = [...this.nodes.values()].filter(
        (n) => (n.type === "entity" || n.type === "source" || n.type === "claim") && n.label,
      );

      // Lazily embed a small number of missing nodes (best-effort; expensive calls are capped).
      let embedded = 0;
      for (const n of candidates) {
        if (embedded >= maxEmbedNodes) break;
        if (n.embedding?.length) continue;
        // Prefer embedding claims (most semantically rich) over sources.
        if (n.type !== "claim" && n.type !== "entity") continue;
        try {
          n.embedding = await embedText(n.label.slice(0, 800), ollamaBaseUrl);
          n.updated_at = new Date().toISOString();
          n.version++;
          this.dirty = true;
          embedded++;
        } catch {
          continue;
        }
      }

      const scored = candidates
        .filter((n) => n.embedding?.length)
        .map((n) => ({ node: n, sim: cosineSim(qVec, n.embedding!) }))
        .filter((x) => x.sim >= minSimilarity)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, maxTopicNodes)
        .map((x) => x.node);

      if (scored.length > 0) {
        // Prefer entity/source nodes as “topics” for subgraph expansion.
        const entFirst = scored
          .filter((n) => n.type === "entity" || n.type === "source")
          .slice(0, maxTopicNodes);
        topicNodes = entFirst.length > 0 ? entFirst : scored.slice(0, maxTopicNodes);
      }
    } catch {
      // ignore; fall back to deterministic substring match below
    }

    // 2) Fallback: deterministic substring match.
    if (topicNodes.length === 0) {
      topicNodes = [...this.nodes.values()]
        .filter(
          (n) =>
            (n.type === "entity" || n.type === "source") &&
            n.label.toLowerCase().includes(q.slice(0, 24)),
        )
        .slice(0, maxTopicNodes);
    }

    const connectedClaims: Array<{ claim: KgNode; evidenceFiles: string[] }> = [];
    for (const node of topicNodes) {
      const { nodes: subgraphNodes, edges } = this.subgraph(node.id, hops);
      const claims = subgraphNodes.filter((n) => n.type === "claim");
      for (const claim of claims) {
        const sourceEdges = edges.filter((e) => e.to === claim.id && e.type === "supports");
        const evidenceFiles = sourceEdges
          .map((e) => this.nodes.get(e.from))
          .filter((n): n is KgNode => Boolean(n))
          .map((n) => String(n.metadata?.sourceFile ?? n.label ?? ""))
          .filter((p) => Boolean(p) && !p.includes("..") && !p.startsWith("/"));
        connectedClaims.push({ claim, evidenceFiles: [...new Set(evidenceFiles)] });
      }
    }

    // Deduplicate claims
    const seen = new Set<string>();
    const deduped = connectedClaims.filter((cc) => {
      if (seen.has(cc.claim.id)) return false;
      seen.add(cc.claim.id);
      return true;
    });

    return { topicNodes, connectedClaims: deduped, graphDistance: hops };
  }

  // ── Persistence ──────────────────────────────────────────────

  async persist(): Promise<void> {
    if (!this.dirty) return;
    // Overwrite with latest snapshot (append-only jsonl is append-inefficient for updates)
    // Instead, we write a compact snapshot file.
    const snapshot: KgSnapshot = {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      query_log: this.queryLog.slice(-1000),
      version_counter: this.versionCounter,
    };
    const snapshotPath = join(this.dir, "snapshot.json");
    await atomicWriteJson(this.vaultPath, snapshotPath, snapshot, 0);
    this.dirty = false;
  }

  /** Append-only jsonl for audit trail (in addition to snapshot). */
  async appendAuditEvent(event: { op: string; payload: unknown }): Promise<void> {
    await safeAppendJsonl(this.vaultPath, join("GZMO", "Knowledge_Graph", "audit.jsonl"), { ...event, ts: new Date().toISOString() });
  }

  // ── Export formats ───────────────────────────────────────────

  snapshot(): KgSnapshot {
    return {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      query_log: this.queryLog.slice(-1000),
      version_counter: this.versionCounter,
    };
  }
}

// ── Helpers (shared embeddings) ────────────────────────────────

async function embedText(text: string, ollamaBaseUrl: string): Promise<number[]> {
  const url = ollamaBaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const resp = await fetch(`${url}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: text.slice(0, 2000) }),
  });
  if (!resp.ok) throw new Error(`Embedding failed: ${resp.status}`);
  const data = (await resp.json()) as { embedding: number[] };
  return data.embedding;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    aa += a[i]! * a[i]!;
    bb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
}

function detectContradiction(a: string, b: string): { contradiction: boolean; strength: number } {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const overlapRatio = overlap / Math.max(wordsA.size, wordsB.size);
  const negA = /\b(not|never|no|none|cannot|doesn't|isn't)\b/i.test(a);
  const negB = /\b(not|never|no|none|cannot|doesn't|isn't)\b/i.test(b);
  const oppositePolarity = negA !== negB;
  if (overlapRatio > 0.3 && oppositePolarity) {
    return { contradiction: true, strength: overlapRatio };
  }
  return { contradiction: false, strength: 0 };
}
