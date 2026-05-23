import dagre from "@dagrejs/dagre";
import { getVisualSpec } from "../task-type-visual-registry";
import { taskKindToString } from "../workflow-graph-conversions";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model";
import {
  DAGRE_CONFIG,
  SENTINEL_NODE_WIDTH,
  SENTINEL_NODE_HEIGHT,
} from "../canvas-constants";

/**
 * Synchronous dagre layout that uses per-node dimensions from the visual
 * registry (T01). Produces a positioned `WorkflowGraphModel` suitable for
 * immediate rendering without a blank-canvas flash.
 *
 * This is the shared layout utility used by both the interactive canvas
 * editor (initial YAML parse) and the read-only execution graph.
 */
export function applyDagreLayout(graph: WorkflowGraphModel): WorkflowGraphModel {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: DAGRE_CONFIG.rankdir,
    ranksep: DAGRE_CONFIG.ranksep,
    nodesep: DAGRE_CONFIG.nodesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
    if (isSentinel) {
      g.setNode(node.id, { width: SENTINEL_NODE_WIDTH, height: SENTINEL_NODE_HEIGHT });
    } else {
      const kindString = taskKindToString(node.kind);
      const spec = getVisualSpec(kindString);
      g.setNode(node.id, { width: spec.defaultWidth, height: spec.defaultHeight });
    }
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes: WorkflowGraphNode[] = graph.nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
    let w: number;
    let h: number;
    if (isSentinel) {
      w = SENTINEL_NODE_WIDTH;
      h = SENTINEL_NODE_HEIGHT;
    } else {
      const kindString = taskKindToString(node.kind);
      const spec = getVisualSpec(kindString);
      w = spec.defaultWidth;
      h = spec.defaultHeight;
    }
    return {
      ...node,
      position: {
        x: (dagreNode?.x ?? 0) - w / 2,
        y: (dagreNode?.y ?? 0) - h / 2,
      },
    };
  });

  return { ...graph, nodes: layoutNodes };
}
