import type { WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge } from "../workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model.js";
import {
  CANVAS_NODE_WIDTH,
  CANVAS_NODE_HEIGHT,
  SENTINEL_NODE_WIDTH,
  SENTINEL_NODE_HEIGHT,
} from "../canvas-constants.js";
import type {
  ElkGraph,
  ElkNode,
  ElkEdge,
  ElkPort,
  LayoutInput,
  NodeDimensions,
  NodePortAssignment,
} from "./types.js";
import { computePortAssignments } from "./port-assignment.js";

// ---------------------------------------------------------------------------
// ELK Layout Options (workflow-optimized defaults)
// ---------------------------------------------------------------------------

/**
 * Default ELK layout options tuned for top-to-bottom workflow visualization.
 *
 * Key choices:
 * - NETWORK_SIMPLEX node placement minimizes total edge length
 * - LAYER_SWEEP crossing minimization with greedy switching reduces edge crossings
 * - ORTHOGONAL routing produces clean right-angle edges
 * - considerModelOrder preserves YAML definition order when unconstrained
 * - FIXED_SIDE port constraints keep inputs on top, outputs on bottom
 */
export const ELK_WORKFLOW_DEFAULTS: Readonly<Record<string, string>> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
  "elk.spacing.nodeNode": "30",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "15",
  "elk.portConstraints": "FIXED_SIDE",
  "elk.portAlignment.default": "CENTER",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transforms a {@link WorkflowGraphModel} into an ELK-compatible JSON graph.
 *
 * The preprocessor:
 * 1. Assigns ports to each node based on task kind (via port-assignment module)
 * 2. Sizes nodes using the provided dimension function (or constants)
 * 3. Maps edges to port-to-port connections for ELK's port-aware routing
 * 4. Applies ELK layout options (configurable via overrides)
 *
 * Compound nodes (for_each, try_catch as containers) are NOT supported in this
 * implementation — the graph model is flat (AD-T03-003). All nodes are peers.
 *
 * @param input - The layout input containing graph, scope, and options.
 * @param layoutOptionsOverrides - Optional ELK option overrides.
 * @returns An ELK JSON graph ready for `elk.layout()`.
 */
export function preprocessForElk(
  input: LayoutInput,
  layoutOptionsOverrides?: Readonly<Record<string, string>>,
): ElkGraph {
  const { graph, getNodeDimensions = defaultNodeDimensions } = input;

  const portAssignments = computePortAssignments(graph.nodes, graph.edges);
  const children = buildElkNodes(graph.nodes, portAssignments, getNodeDimensions);
  const edges = buildElkEdges(graph.edges, portAssignments);

  return {
    id: "root",
    layoutOptions: {
      ...ELK_WORKFLOW_DEFAULTS,
      ...layoutOptionsOverrides,
    },
    children,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Node construction
// ---------------------------------------------------------------------------

function buildElkNodes(
  nodes: readonly WorkflowGraphNode[],
  portAssignments: ReadonlyMap<string, NodePortAssignment>,
  getNodeDimensions: (node: WorkflowGraphNode) => NodeDimensions,
): ElkNode[] {
  return nodes.map((node) => {
    const dims = getNodeDimensions(node);
    const assignment = portAssignments.get(node.id);
    const ports = assignment ? buildElkPorts(assignment) : [];

    const elkNode: ElkNode = {
      id: node.id,
      width: dims.width,
      height: dims.height,
      ports,
      labels: [{ text: node.taskName }],
    };

    if (ports.length > 0) {
      return {
        ...elkNode,
        layoutOptions: {
          "elk.portConstraints": "FIXED_ORDER",
        },
      };
    }

    return elkNode;
  });
}

function buildElkPorts(assignment: NodePortAssignment): ElkPort[] {
  const ports: ElkPort[] = [];

  for (const port of assignment.inputPorts) {
    ports.push({
      id: port.id,
      width: 8,
      height: 8,
      layoutOptions: {
        "elk.port.side": port.side,
        "elk.port.index": String(port.index),
      },
    });
  }

  for (const port of assignment.outputPorts) {
    ports.push({
      id: port.id,
      width: 8,
      height: 8,
      layoutOptions: {
        "elk.port.side": port.side,
        "elk.port.index": String(port.index),
      },
    });
  }

  return ports;
}

// ---------------------------------------------------------------------------
// Edge construction
// ---------------------------------------------------------------------------

/**
 * Maps workflow graph edges to ELK edges connecting source/target ports.
 *
 * Edge routing logic:
 * - If the edge has a `sourceHandle`, find the matching output port by handle ID
 * - Otherwise, use the node's default output port (`{nodeId}__out`)
 * - Target is always the target node's input port (`{targetId}__in`)
 */
function buildElkEdges(
  edges: readonly WorkflowGraphEdge[],
  portAssignments: ReadonlyMap<string, NodePortAssignment>,
): ElkEdge[] {
  return edges.map((edge) => {
    const sourcePort = resolveSourcePort(edge, portAssignments);
    const targetPort = resolveTargetPort(edge, portAssignments);

    return {
      id: edge.id,
      sources: [sourcePort],
      targets: [targetPort],
    };
  });
}

function resolveSourcePort(
  edge: WorkflowGraphEdge,
  portAssignments: ReadonlyMap<string, NodePortAssignment>,
): string {
  const assignment = portAssignments.get(edge.source);
  if (!assignment || assignment.outputPorts.length === 0) {
    return edge.source;
  }

  if (edge.sourceHandle) {
    const matchingPort = assignment.outputPorts.find(
      (p) => p.id === `${edge.source}__${edge.sourceHandle}`,
    );
    if (matchingPort) return matchingPort.id;
  }

  return assignment.outputPorts[0].id;
}

function resolveTargetPort(
  edge: WorkflowGraphEdge,
  portAssignments: ReadonlyMap<string, NodePortAssignment>,
): string {
  const assignment = portAssignments.get(edge.target);
  if (!assignment || assignment.inputPorts.length === 0) {
    return edge.target;
  }

  return assignment.inputPorts[0].id;
}

// ---------------------------------------------------------------------------
// Default dimensions
// ---------------------------------------------------------------------------

function defaultNodeDimensions(node: WorkflowGraphNode): NodeDimensions {
  const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
  return {
    width: isSentinel ? SENTINEL_NODE_WIDTH : CANVAS_NODE_WIDTH,
    height: isSentinel ? SENTINEL_NODE_HEIGHT : CANVAS_NODE_HEIGHT,
  };
}
