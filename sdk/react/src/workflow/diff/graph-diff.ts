/**
 * Pure diff engine for workflow graph models.
 *
 * Compares two WorkflowGraphModel instances and produces a GraphDiff
 * describing which nodes/edges were added, removed, or modified.
 *
 * Node matching is by `id` (task name). Edge matching is by semantic
 * triple `(source, target, sourceHandle)` — NOT by edge ID, which is
 * unstable across parses.
 *
 * @since T14 (AI-Assisted Workflow Creation)
 */

import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type {
  NodeDiffStatus,
  NodeDiffEntry,
  EdgeDiffEntry,
  EdgeDiffStatus,
  GraphDiff,
} from "./types";

// ---------------------------------------------------------------------------
// JSON deep equality
// ---------------------------------------------------------------------------

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === "bigint" || typeof b === "bigint") {
    return String(a) === String(b);
  }

  if (typeof a !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== (b as unknown[]).length) return false;
    return a.every((item, i) => jsonEqual(item, (b as unknown[])[i]));
  }

  if (Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((key) => key in bObj && jsonEqual(aObj[key], bObj[key]));
}

// ---------------------------------------------------------------------------
// Edge semantic key
// ---------------------------------------------------------------------------

function edgeSemanticKey(
  source: string,
  target: string,
  sourceHandle?: string,
): string {
  return sourceHandle
    ? `${source}|${target}|${sourceHandle}`
    : `${source}|${target}`;
}

// ---------------------------------------------------------------------------
// computeGraphDiff
// ---------------------------------------------------------------------------

/**
 * Computes a structural diff between two workflow graph models.
 *
 * - Nodes are matched by `id` (which is the task name).
 * - Sentinel nodes (`__start__`, `__end__`) are excluded from the diff.
 * - Modified detection compares `kind`, `config` (deep equal), and `export.as`.
 * - Edges are matched by semantic triple `(source, target, sourceHandle)`.
 * - `changedFields` lists top-level config keys that differ.
 */
export function computeGraphDiff(
  before: WorkflowGraphModel,
  after: WorkflowGraphModel,
): GraphDiff {
  const SENTINELS = new Set([START_NODE_ID, END_NODE_ID]);

  // -- Node diff --
  const beforeNodes = new Map(
    before.nodes
      .filter((n) => !SENTINELS.has(n.id))
      .map((n) => [n.id, n]),
  );
  const afterNodes = new Map(
    after.nodes
      .filter((n) => !SENTINELS.has(n.id))
      .map((n) => [n.id, n]),
  );

  const nodeDiffs = new Map<string, NodeDiffEntry>();
  let added = 0;
  let removed = 0;
  let modified = 0;

  // Nodes in after: either added or potentially modified
  for (const [id, afterNode] of afterNodes) {
    const beforeNode = beforeNodes.get(id);
    if (!beforeNode) {
      nodeDiffs.set(id, {
        taskName: afterNode.taskName,
        status: "added",
        afterNode,
      });
      added++;
    } else {
      const status = computeNodeDiffStatus(beforeNode, afterNode);
      const changedFields =
        status === "modified"
          ? computeChangedFields(beforeNode.config, afterNode.config)
          : undefined;
      nodeDiffs.set(id, {
        taskName: afterNode.taskName,
        status,
        beforeNode,
        afterNode,
        changedFields,
      });
      if (status === "modified") modified++;
    }
  }

  // Nodes only in before: removed
  for (const [id, beforeNode] of beforeNodes) {
    if (!afterNodes.has(id)) {
      nodeDiffs.set(id, {
        taskName: beforeNode.taskName,
        status: "removed",
        beforeNode,
      });
      removed++;
    }
  }

  // -- Edge diff --
  const beforeEdgeMap = new Map(
    before.edges.map((e) => [
      edgeSemanticKey(e.source, e.target, e.sourceHandle),
      e,
    ]),
  );
  const afterEdgeMap = new Map(
    after.edges.map((e) => [
      edgeSemanticKey(e.source, e.target, e.sourceHandle),
      e,
    ]),
  );

  const edgeDiffs = new Map<string, EdgeDiffEntry>();

  for (const [key] of afterEdgeMap) {
    const status: EdgeDiffStatus = beforeEdgeMap.has(key) ? "unchanged" : "added";
    edgeDiffs.set(key, { edgeKey: key, status });
  }

  for (const [key] of beforeEdgeMap) {
    if (!afterEdgeMap.has(key)) {
      edgeDiffs.set(key, { edgeKey: key, status: "removed" });
    }
  }

  return {
    nodes: nodeDiffs,
    edges: edgeDiffs,
    summary: { added, removed, modified },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeNodeDiffStatus(
  before: WorkflowGraphNode,
  after: WorkflowGraphNode,
): NodeDiffStatus {
  if (before.kind !== after.kind) return "modified";
  if (!jsonEqual(before.config as unknown, after.config as unknown)) return "modified";
  if ((before.export?.as ?? "") !== (after.export?.as ?? "")) return "modified";
  return "unchanged";
}

function computeChangedFields(
  beforeConfig: JsonObject,
  afterConfig: JsonObject,
): string[] {
  const allKeys = new Set([
    ...Object.keys(beforeConfig),
    ...Object.keys(afterConfig),
  ]);

  const changed: string[] = [];
  for (const key of allKeys) {
    if (!jsonEqual(beforeConfig[key], afterConfig[key])) {
      changed.push(key);
    }
  }
  return changed;
}

export { jsonEqual };
