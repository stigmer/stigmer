import dagre from "@dagrejs/dagre";
import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model.js";
import {
  CANVAS_NODE_WIDTH,
  CANVAS_NODE_HEIGHT,
  SENTINEL_NODE_WIDTH,
  SENTINEL_NODE_HEIGHT,
} from "../canvas-constants.js";
import type { LayoutEngine, LayoutInput, LayoutResult, NodeDimensions, Position2D } from "./types.js";

// ---------------------------------------------------------------------------
// Default node dimension provider
// ---------------------------------------------------------------------------

function defaultNodeDimensions(node: WorkflowGraphNode): NodeDimensions {
  const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
  return {
    width: isSentinel ? SENTINEL_NODE_WIDTH : CANVAS_NODE_WIDTH,
    height: isSentinel ? SENTINEL_NODE_HEIGHT : CANVAS_NODE_HEIGHT,
  };
}

// ---------------------------------------------------------------------------
// Dagre Layout Engine
// ---------------------------------------------------------------------------

const DAGRE_DEFAULTS = {
  rankdir: "TB" as const,
  ranksep: 60,
  nodesep: 30,
};

/**
 * Creates a dagre-based layout engine.
 *
 * This is a synchronous layout algorithm that runs on the main thread.
 * It's lightweight and fast for small-to-medium graphs (<30 nodes) but
 * lacks port awareness, compound node support, and model-order preservation.
 *
 * Used as:
 * - The default fallback when elkjs is not available
 * - The layout engine for the read-only SVG topology preview
 * - A fast approximation for initial YAML parse rendering
 */
export function createDagreLayoutEngine(): LayoutEngine {
  return {
    name: "dagre",
    async layout(input: LayoutInput): Promise<LayoutResult> {
      const start = performance.now();
      const positions = computeDagreLayout(input);
      const durationMs = performance.now() - start;
      return { positions, durationMs, engine: "dagre" };
    },
  };
}

function computeDagreLayout(input: LayoutInput): ReadonlyMap<string, Position2D> {
  const { graph, getNodeDimensions = defaultNodeDimensions } = input;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: DAGRE_DEFAULTS.rankdir,
    ranksep: DAGRE_DEFAULTS.ranksep,
    nodesep: DAGRE_DEFAULTS.nodesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const dims = getNodeDimensions(node);
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, Position2D>();
  for (const node of graph.nodes) {
    const dagreNode = g.node(node.id);
    if (!dagreNode) continue;

    const dims = getNodeDimensions(node);
    positions.set(node.id, {
      x: dagreNode.x - dims.width / 2,
      y: dagreNode.y - dims.height / 2,
    });
  }

  return positions;
}
