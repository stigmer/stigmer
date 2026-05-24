import type { WorkflowGraphNode } from "../workflow-graph-model";

/**
 * Diff status for a single node in the merged diff graph.
 * Used by NodeShell for visual treatment and DiffBadge for status icons.
 */
export type NodeDiffStatus = "added" | "removed" | "modified" | "unchanged";

/**
 * Diff status for a single edge in the merged diff graph.
 * Used by CanvasTransitionEdge for stroke/dash styling.
 */
export type EdgeDiffStatus = "added" | "removed" | "unchanged";

/** Diff entry describing the change to a single node. */
export interface NodeDiffEntry {
  readonly taskName: string;
  readonly status: NodeDiffStatus;
  readonly beforeNode?: WorkflowGraphNode;
  readonly afterNode?: WorkflowGraphNode;
  /** Top-level config keys that differ (for badge count display). */
  readonly changedFields?: readonly string[];
}

/** Diff entry describing the change to a single edge. */
export interface EdgeDiffEntry {
  readonly edgeKey: string;
  readonly status: EdgeDiffStatus;
}

/** Complete diff result between two workflow graph models. */
export interface GraphDiff {
  readonly nodes: ReadonlyMap<string, NodeDiffEntry>;
  readonly edges: ReadonlyMap<string, EdgeDiffEntry>;
  readonly summary: { added: number; removed: number; modified: number };
}
