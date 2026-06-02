import type { WorkflowGraphModel, WorkflowGraphEdge } from "../workflow-graph-model";
import type {
  ElkLayoutResult,
  ElkEdgeSection,
  LayoutResult,
  LayoutScope,
  Position2D,
} from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transforms ELK layout output into a {@link LayoutResult}, applying scope
 * filtering to determine which nodes receive new positions.
 *
 * ELK produces center coordinates for nodes. This function converts them
 * to top-left coordinates (React Flow convention: position = top-left corner).
 *
 * Scope filtering (AD-T03-005):
 * - `whole-graph`: all computed positions are included
 * - `selected`: only positions for nodes in the selection set are included
 * - `downstream`: only positions for the target node and all reachable
 *   downstream nodes (via BFS on edges) are included
 *
 * @param elkResult - The raw result from `elk.layout()`.
 * @param scope - Which nodes should receive new positions.
 * @param graph - The original graph (needed for downstream traversal).
 * @param durationMs - Wall-clock layout time to include in the result.
 * @param engine - Engine name for attribution.
 */
export function postprocessElkResult(
  elkResult: ElkLayoutResult,
  scope: LayoutScope,
  graph: WorkflowGraphModel,
  durationMs: number,
  engine: string,
): LayoutResult {
  const allPositions = extractPositions(elkResult);
  const edgePaths = extractEdgePaths(elkResult);
  const filteredPositions = filterByScope(allPositions, scope, graph);

  return {
    positions: filteredPositions,
    edgePaths: edgePaths.size > 0 ? edgePaths : undefined,
    durationMs,
    engine,
  };
}

// ---------------------------------------------------------------------------
// Position extraction
// ---------------------------------------------------------------------------

/**
 * ELK returns node positions as (x, y) relative to the parent.
 * Since we have a flat graph (no compound nodes), all positions are
 * relative to the root — which maps directly to React Flow coordinates.
 *
 * ELK's (x, y) is the top-left corner of the node bounding box,
 * which matches React Flow's position convention.
 */
function extractPositions(elkResult: ElkLayoutResult): Map<string, Position2D> {
  const positions = new Map<string, Position2D>();

  if (!elkResult.children) return positions;

  for (const child of elkResult.children) {
    positions.set(child.id, { x: child.x, y: child.y });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Edge path extraction
// ---------------------------------------------------------------------------

function extractEdgePaths(elkResult: ElkLayoutResult): Map<string, Position2D[]> {
  const paths = new Map<string, Position2D[]>();

  if (!elkResult.edges) return paths;

  for (const edge of elkResult.edges) {
    if (!edge.sections || edge.sections.length === 0) continue;

    const points = flattenEdgeSections(edge.sections);
    if (points.length > 0) {
      paths.set(edge.id, points);
    }
  }

  return paths;
}

function flattenEdgeSections(sections: readonly ElkEdgeSection[]): Position2D[] {
  const points: Position2D[] = [];

  for (const section of sections) {
    points.push(section.startPoint);
    if (section.bendPoints) {
      points.push(...section.bendPoints);
    }
    points.push(section.endPoint);
  }

  return points;
}

// ---------------------------------------------------------------------------
// Scope filtering
// ---------------------------------------------------------------------------

function filterByScope(
  positions: Map<string, Position2D>,
  scope: LayoutScope,
  graph: WorkflowGraphModel,
): ReadonlyMap<string, Position2D> {
  switch (scope.type) {
    case "whole-graph":
      return positions;

    case "selected":
      return filterToSet(positions, scope.nodeIds);

    case "downstream":
      return filterToDownstream(positions, scope.fromNodeId, graph.edges);
  }
}

function filterToSet(
  positions: Map<string, Position2D>,
  nodeIds: ReadonlySet<string>,
): ReadonlyMap<string, Position2D> {
  const filtered = new Map<string, Position2D>();
  for (const [id, pos] of positions) {
    if (nodeIds.has(id)) {
      filtered.set(id, pos);
    }
  }
  return filtered;
}

function filterToDownstream(
  positions: Map<string, Position2D>,
  fromNodeId: string,
  edges: readonly WorkflowGraphEdge[],
): ReadonlyMap<string, Position2D> {
  const reachable = computeDownstreamSet(fromNodeId, edges);
  const filtered = new Map<string, Position2D>();
  for (const [id, pos] of positions) {
    if (reachable.has(id)) {
      filtered.set(id, pos);
    }
  }
  return filtered;
}

/**
 * BFS from a starting node following directed edges to find all
 * reachable downstream nodes (including the starting node itself).
 */
function computeDownstreamSet(
  fromNodeId: string,
  edges: readonly WorkflowGraphEdge[],
): ReadonlySet<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.source);
    if (targets) {
      targets.push(edge.target);
    } else {
      adjacency.set(edge.source, [edge.target]);
    }
  }

  const visited = new Set<string>();
  const queue: string[] = [fromNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  return visited;
}
