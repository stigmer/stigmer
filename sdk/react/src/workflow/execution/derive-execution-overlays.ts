/**
 * Pure derivation functions for workflow execution overlays.
 *
 * These functions compute edge execution states and fork progress
 * from the graph topology and flat task status map — no React
 * dependency, no side effects, independently importable (DD-003).
 *
 * @since T06 (Branch and Parallel Execution Highlighting)
 */

import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphEdge, WorkflowGraphNode } from "../workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model.js";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Execution state of a single edge in the workflow graph.
 *
 * - `taken`       — execution traversed this edge (source done, target done/failed)
 * - `not_taken`   — a sibling branch was selected instead (source is a completed
 *                    branching node, target is not_reached, but another branch target ran)
 * - `active`      — execution is flowing through this edge right now
 *                    (source done, target currently running)
 * - `not_reached` — execution hasn't reached this edge yet
 */
export type EdgeExecutionState = "taken" | "not_taken" | "active" | "not_reached";

/** Fork progress derived from branch config + flat task status map. */
export interface ForkProgress {
  readonly completed: number;
  readonly total: number;
  readonly compete: boolean;
}

// ---------------------------------------------------------------------------
// Node status helpers
// ---------------------------------------------------------------------------

type ResolvedNodeStatus =
  | "not_reached"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "retrying"
  | "waiting_approval";

const ACTIVE_STATUSES: ReadonlySet<ResolvedNodeStatus> = new Set([
  "running",
  "waiting_approval",
  "retrying",
]);

const TERMINAL_STATUSES: ReadonlySet<ResolvedNodeStatus> = new Set([
  "completed",
  "failed",
  "skipped",
]);

const DONE_STATUSES: ReadonlySet<ResolvedNodeStatus> = new Set([
  "completed",
  "failed",
]);

function resolveNodeStatus(
  nodeId: string,
  taskName: string,
  taskStates: ReadonlyMap<string, DerivedTaskState>,
): ResolvedNodeStatus {
  if (nodeId === START_NODE_ID) return "completed";
  if (nodeId === END_NODE_ID) return "not_reached";
  const state = taskStates.get(taskName);
  return state?.status ?? "not_reached";
}

// ---------------------------------------------------------------------------
// deriveEdgeExecutionStates
// ---------------------------------------------------------------------------

/**
 * Computes execution state for every edge in the workflow graph.
 *
 * Algorithm:
 * 1. Resolve each node's execution status from the flat task state map.
 * 2. Identify branching nodes (nodes with at least one outgoing edge
 *    that carries a `sourceHandle` — switch_case, human_input).
 * 3. For branching nodes, determine whether sibling branches exist
 *    with non-`not_reached` targets to distinguish `not_taken` from
 *    mere `not_reached`.
 * 4. Assign each edge one of: taken, not_taken, active, not_reached.
 */
export function deriveEdgeExecutionStates(
  edges: readonly WorkflowGraphEdge[],
  nodes: readonly WorkflowGraphNode[],
  taskStates: ReadonlyMap<string, DerivedTaskState>,
): ReadonlyMap<string, EdgeExecutionState> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const statusOf = (nodeId: string): ResolvedNodeStatus => {
    const node = nodeById.get(nodeId);
    if (!node) return "not_reached";
    return resolveNodeStatus(nodeId, node.taskName, taskStates);
  };

  // Group edges by source to detect branching nodes and sibling edges.
  const edgesBySource = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of edges) {
    let group = edgesBySource.get(edge.source);
    if (!group) {
      group = [];
      edgesBySource.set(edge.source, group);
    }
    group.push(edge);
  }

  // A branching node has at least one outgoing edge with a sourceHandle.
  const branchingNodes = new Set<string>();
  for (const [source, sourceEdges] of edgesBySource) {
    if (sourceEdges.some((e) => e.sourceHandle != null)) {
      branchingNodes.add(source);
    }
  }

  // Pre-compute: for each branching node, does any branch edge have
  // a non-not_reached target? This confirms the branch has executed
  // and selected at least one path.
  const branchHasSelectedTarget = new Map<string, boolean>();
  for (const source of branchingNodes) {
    const sourceEdges = edgesBySource.get(source) ?? [];
    const hasBranchWithTarget = sourceEdges.some(
      (e) => e.sourceHandle != null && statusOf(e.target) !== "not_reached",
    );
    branchHasSelectedTarget.set(source, hasBranchWithTarget);
  }

  const result = new Map<string, EdgeExecutionState>();

  for (const edge of edges) {
    const sourceStatus = statusOf(edge.source);
    const targetStatus = statusOf(edge.target);

    // Source not yet reached — edge can't have been traversed.
    if (sourceStatus === "not_reached" || sourceStatus === "pending") {
      result.set(edge.id, "not_reached");
      continue;
    }

    const sourceDone = DONE_STATUSES.has(sourceStatus);

    // Active: source is done, target is currently running.
    if (sourceDone && ACTIVE_STATUSES.has(targetStatus)) {
      result.set(edge.id, "active");
      continue;
    }

    // Taken: source is done, target has reached a terminal state.
    if (sourceDone && TERMINAL_STATUSES.has(targetStatus)) {
      result.set(edge.id, "taken");
      continue;
    }

    // Source is active (running itself) — edge to its target is not_reached.
    if (ACTIVE_STATUSES.has(sourceStatus)) {
      result.set(edge.id, "not_reached");
      continue;
    }

    // Branch-specific: source is a completed branching node, target is
    // not_reached, and a sibling branch edge has a non-not_reached target.
    if (
      sourceDone &&
      targetStatus === "not_reached" &&
      edge.sourceHandle != null &&
      branchingNodes.has(edge.source) &&
      branchHasSelectedTarget.get(edge.source)
    ) {
      result.set(edge.id, "not_taken");
      continue;
    }

    // End node edge: if source is done, mark the edge to End as taken.
    if (sourceDone && edge.target === END_NODE_ID) {
      result.set(edge.id, "taken");
      continue;
    }

    result.set(edge.id, "not_reached");
  }

  return result;
}

// ---------------------------------------------------------------------------
// deriveForkProgress
// ---------------------------------------------------------------------------

interface RawForkBranch {
  readonly name?: string;
  readonly do?: readonly RawForkTask[];
}

interface RawForkTask {
  readonly name?: string;
}

/**
 * Computes fork branch completion progress from the fork node's config
 * and the flat task status map.
 *
 * Returns `null` when the config doesn't contain parseable branch data
 * (missing `branches`, empty array, or unrecognizable structure).
 */
export function deriveForkProgress(
  forkConfig: JsonObject,
  taskStates: ReadonlyMap<string, DerivedTaskState>,
): ForkProgress | null {
  const branches = forkConfig.branches;
  if (!Array.isArray(branches) || branches.length === 0) return null;

  const compete = forkConfig.compete === true;
  let completedBranches = 0;
  let totalBranches = 0;

  for (const branch of branches) {
    if (!branch || typeof branch !== "object") continue;
    const b = branch as unknown as RawForkBranch;

    const tasks = b.do;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      totalBranches++;
      continue;
    }

    totalBranches++;

    const allTasksCompleted = tasks.every((task) => {
      if (!task || typeof task !== "object") return false;
      const t = task as RawForkTask;
      if (!t.name) return false;
      const state = taskStates.get(t.name);
      return state?.status === "completed";
    });

    if (allTasksCompleted) completedBranches++;
  }

  if (totalBranches === 0) return null;

  return { completed: completedBranches, total: totalBranches, compete };
}
