/**
 * Tree-of-Thought controller — budgeted expansion and best-path selection.
 */

import type { ReasoningNode, ReasoningNodeType } from "../reasoning_trace";
import type { ChaosSnapshot } from "../types";
import { Phase } from "../types";
import { readIntEnv } from "../pipelines/helpers";

export interface ToTConfig {
  maxDepth: number;
  maxBranchesPerNode: number;
  maxTotalNodes: number;
  evaluationThreshold: number;
  enableRetry: boolean;
}

export function budgetFromChaos(snap: ChaosSnapshot): ToTConfig {
  const baseDepth = Math.floor(snap.energy / 25);
  const phaseBonus = snap.phase === Phase.Build ? 1 : snap.phase === Phase.Drop ? -1 : 0;
  const maxDepth = Math.max(1, Math.min(5, baseDepth + phaseBonus));
  const maxBranches = snap.llmValence < -0.3 ? 1 : snap.llmValence > 0.3 ? 3 : 2;
  const maxTotalNodes = readIntEnv("GZMO_TOT_MAX_NODES", 15, 4, 64);
  const minScoreRaw = process.env.GZMO_TOT_MIN_SCORE;
  const minScore = minScoreRaw !== undefined ? Number.parseFloat(minScoreRaw) : 0.5;

  return {
    maxDepth,
    maxBranchesPerNode: maxBranches,
    maxTotalNodes,
    evaluationThreshold: Number.isFinite(minScore) ? Math.max(0, Math.min(1, minScore)) : 0.5,
    enableRetry: snap.energy > 40,
  };
}

export type ToTNode = ReasoningNode & {
  children: ToTNode[];
  explored: boolean;
  pruned: boolean;
};

export class ToTController {
  private config: ToTConfig;
  private nodes: ToTNode[] = [];
  readonly traceId: string;

  constructor(config: ToTConfig, traceId: string, rootSummary: string) {
    this.config = config;
    this.traceId = traceId;
    const root: ToTNode = {
      node_id: "tot_root",
      trace_id: traceId,
      parent_id: null,
      type: "analyze",
      depth: 0,
      prompt_summary: rootSummary.slice(0, 140),
      outcome: "success",
      elapsed_ms: 0,
      timestamp: new Date().toISOString(),
      children: [],
      explored: false,
      pruned: false,
    };
    this.nodes.push(root);
  }

  get root(): ToTNode | undefined {
    return this.nodes.find((n) => n.parent_id === null);
  }

  get activeNodes(): ToTNode[] {
    return this.nodes.filter((n) => !n.pruned);
  }

  get totalNodes(): number {
    return this.nodes.length;
  }

  get allNodes(): ToTNode[] {
    return this.nodes;
  }

  canExpand(node: ToTNode): boolean {
    if (node.pruned || node.explored) return false;
    if (this.totalNodes >= this.config.maxTotalNodes) return false;
    if (node.depth >= this.config.maxDepth) return false;
    const expandable: ReasoningNodeType[] = ["analyze", "retrieve", "vault_read", "dir_list", "reason", "replan"];
    return expandable.includes(node.type);
  }

  addChild(parent: ToTNode, partial: Omit<ToTNode, "children" | "explored" | "pruned" | "trace_id"> & { trace_id?: string }): ToTNode {
    const child: ToTNode = {
      ...partial,
      trace_id: partial.trace_id ?? this.traceId,
      children: [],
      explored: false,
      pruned: false,
    };
    parent.children.push(child);
    this.nodes.push(child);
    return child;
  }

  nextNodeId(): string {
    return `tot_${this.nodes.length}`;
  }

  prune(node: ToTNode): void {
    node.pruned = true;
    for (const child of node.children) this.prune(child);
  }

  /** Prefer terminal verify / answer nodes with scores. */
  bestPath(): ToTNode[] {
    const terminals = this.activeNodes.filter(
      (n) => (n.type === "verify" || n.type === "answer" || n.type === "abstain") && !n.pruned,
    );
    if (terminals.length === 0) return [];

    const scorePath = (path: ToTNode[]): number => {
      const explicit = path
        .map((n) => n.score)
        .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      if (explicit.length > 0) return Math.min(...explicit);
      const fallback = path
        .filter((n) => n.type === "verify" || n.type === "answer" || n.type === "abstain")
        .map((n) => n.score ?? 0.5);
      return fallback.length > 0 ? Math.min(...fallback) : 0;
    };

    const paths = terminals.map((t) => this.pathTo(t));
    paths.sort((a, b) => scorePath(b) - scorePath(a));
    return paths[0] ?? [];
  }

  private pathTo(node: ToTNode): ToTNode[] {
    const path: ToTNode[] = [];
    let current: ToTNode | undefined = node;
    while (current) {
      path.unshift(current);
      current = current.parent_id
        ? (this.nodes.find((n) => n.node_id === current!.parent_id) as ToTNode | undefined)
        : undefined;
    }
    return path;
  }

  flattenForTrace(): ReasoningNode[] {
    const out: ReasoningNode[] = [];
    for (const n of this.nodes) {
      const { children, explored, pruned, ...rn } = n;
      void children;
      void explored;
      void pruned;
      out.push(rn);
    }
    return out;
  }

  findNode(nodeId: string): ToTNode | undefined {
    return this.nodes.find((n) => n.node_id === nodeId) as ToTNode | undefined;
  }

  /**
   * Reset the tree for replanning while keeping critique nodes attached to root.
   */
  replan(rootCritiqueSummary: string): void {
    const root = this.root;
    if (!root) return;

    const kept = root.children.filter((c) => c.type === "critique" && !c.pruned);
    for (const child of [...root.children]) {
      if (!kept.includes(child)) this.prune(child);
    }
    root.children = kept;
    root.type = "replan";
    root.prompt_summary = `Replan: ${rootCritiqueSummary.slice(0, 100)}`;
    root.explored = false;
  }
}
