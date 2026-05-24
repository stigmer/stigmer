/**
 * Builds a merged workflow graph model for visual diff rendering.
 *
 * The merged graph contains:
 * 1. All nodes from the "after" graph (added, modified, unchanged)
 * 2. Removed nodes from the "before" graph (not in after)
 * 3. All edges from the "after" graph plus removed edges from "before"
 *
 * Caller applies `applyDagreLayout()` to the result for positioning.
 *
 * @since T14 (AI-Assisted Workflow Creation)
 */

import type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
} from "../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type { GraphDiff } from "./types";

/**
 * Creates a unified graph model containing nodes/edges from both the
 * before and after graphs, suitable for rendering a visual diff.
 *
 * - Starts with all "after" nodes and edges.
 * - Inserts "removed" nodes from before (not in after).
 * - Inserts "removed" edges from before (matched by semantic triple).
 * - Uses the "after" graph's document/description/env/budget metadata.
 */
export function buildDiffGraph(
  before: WorkflowGraphModel,
  after: WorkflowGraphModel,
  diff: GraphDiff,
): WorkflowGraphModel {
  const afterNodeIds = new Set(after.nodes.map((n) => n.id));

  // Start with after nodes, then append removed nodes from before
  const mergedNodes: WorkflowGraphNode[] = [...after.nodes];

  for (const [nodeId, entry] of diff.nodes) {
    if (entry.status === "removed" && entry.beforeNode && !afterNodeIds.has(nodeId)) {
      mergedNodes.push(entry.beforeNode);
    }
  }

  // Build semantic key set for after edges
  const afterEdgeKeys = new Set(
    after.edges.map((e) => edgeKey(e.source, e.target, e.sourceHandle)),
  );

  // Start with after edges, append removed edges from before
  const mergedEdges: WorkflowGraphEdge[] = [...after.edges];
  let syntheticEdgeCounter = after.edges.length;

  for (const [key, entry] of diff.edges) {
    if (entry.status === "removed") {
      // Find the original edge in before graph
      const originalEdge = before.edges.find(
        (e) => edgeKey(e.source, e.target, e.sourceHandle) === key,
      );
      if (originalEdge && !afterEdgeKeys.has(key)) {
        mergedEdges.push({
          ...originalEdge,
          id: `diff_removed_${syntheticEdgeCounter++}`,
        });
      }
    }
  }

  return {
    document: after.document,
    description: after.description,
    env: after.env,
    budget: after.budget,
    nodes: mergedNodes,
    edges: mergedEdges,
  };
}

function edgeKey(source: string, target: string, sourceHandle?: string): string {
  return sourceHandle ? `${source}|${target}|${sourceHandle}` : `${source}|${target}`;
}
