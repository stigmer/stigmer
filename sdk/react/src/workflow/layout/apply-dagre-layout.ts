import dagre from "@dagrejs/dagre";
import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model";
import { DAGRE_CONFIG } from "../canvas-constants";
import type { DagreLayoutConfig } from "../canvas-constants";
import { registryNodeDimensions } from "./registry-dimensions";

/**
 * Synchronous dagre layout that uses per-node dimensions from the visual
 * registry (T01). Produces a positioned `WorkflowGraphModel` suitable for
 * immediate rendering without a blank-canvas flash.
 *
 * This is the shared layout utility used by both the interactive canvas
 * editor (initial YAML parse) and the read-only execution graph.
 *
 * @param graph   The graph model to lay out.
 * @param config  Optional dagre spacing overrides. Defaults to {@link DAGRE_CONFIG}.
 */
export function applyDagreLayout(
  graph: WorkflowGraphModel,
  config: DagreLayoutConfig = DAGRE_CONFIG,
): WorkflowGraphModel {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: config.rankdir,
    ranksep: config.ranksep,
    nodesep: config.nodesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const { width, height } = registryNodeDimensions(node);
    g.setNode(node.id, { width, height });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes: WorkflowGraphNode[] = graph.nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const { width, height } = registryNodeDimensions(node);
    return {
      ...node,
      position: {
        x: (dagreNode?.x ?? 0) - width / 2,
        y: (dagreNode?.y ?? 0) - height / 2,
      },
    };
  });

  return { ...graph, nodes: layoutNodes };
}
