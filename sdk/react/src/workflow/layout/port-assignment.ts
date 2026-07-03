import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowGraphNode, WorkflowGraphEdge } from "../workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model.js";
import type { NodePortAssignment, PortDefinition, PortSide } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes port assignments for all nodes in a workflow graph.
 *
 * Port IDs are deterministic and align with the React Flow handle IDs
 * used in `WorkflowNode` (`case_{name}`, `outcome_{name}`). This ensures
 * ELK routes edges to the correct port and the postprocessor can map
 * results back to the React Flow model without translation.
 *
 * @param nodes - All nodes in the workflow graph.
 * @param edges - All edges (used to infer fork branch count).
 */
export function computePortAssignments(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[],
): ReadonlyMap<string, NodePortAssignment> {
  const result = new Map<string, NodePortAssignment>();

  for (const node of nodes) {
    result.set(node.id, computeNodePorts(node, edges));
  }

  return result;
}

/**
 * Computes port assignment for a single node.
 * Exported for unit testing individual cases.
 */
export function computeNodePorts(
  node: WorkflowGraphNode,
  edges: readonly WorkflowGraphEdge[],
): NodePortAssignment {
  const nodeId = node.id;

  if (nodeId === START_NODE_ID) {
    return {
      nodeId,
      inputPorts: [],
      outputPorts: [makePort(`${nodeId}__out`, "SOUTH", 0)],
    };
  }

  if (nodeId === END_NODE_ID) {
    return {
      nodeId,
      inputPorts: [makePort(`${nodeId}__in`, "NORTH", 0)],
      outputPorts: [],
    };
  }

  const inputPorts: PortDefinition[] = [makePort(`${nodeId}__in`, "NORTH", 0)];
  const outputPorts = computeOutputPorts(node, edges);

  return { nodeId, inputPorts, outputPorts };
}

// ---------------------------------------------------------------------------
// Output port computation per task kind
// ---------------------------------------------------------------------------

function computeOutputPorts(
  node: WorkflowGraphNode,
  edges: readonly WorkflowGraphEdge[],
): PortDefinition[] {
  const config = node.config as Record<string, unknown> | undefined;

  if (node.kind === WorkflowTaskKind.switch_case && config) {
    return computeSwitchCasePorts(node.id, config);
  }

  if (node.kind === WorkflowTaskKind.human_input && config) {
    return computeHumanInputPorts(node.id, config);
  }

  if (node.kind === WorkflowTaskKind.fork) {
    return computeForkPorts(node.id, edges);
  }

  return [makePort(`${node.id}__out`, "SOUTH", 0)];
}

/**
 * switch_case: one output port per case entry.
 * Handle ID format matches CanvasTaskNode: `case_{caseName}`.
 */
function computeSwitchCasePorts(
  nodeId: string,
  config: Record<string, unknown>,
): PortDefinition[] {
  const cases = config.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    return [makePort(`${nodeId}__out`, "SOUTH", 0)];
  }

  const ports: PortDefinition[] = [];
  let index = 0;

  for (const c of cases) {
    if (c != null && typeof c === "object" && typeof (c as Record<string, unknown>).name === "string") {
      const caseName = (c as Record<string, unknown>).name as string;
      ports.push(makePort(`${nodeId}__case_${caseName}`, "SOUTH", index, caseName));
      index++;
    }
  }

  return ports.length > 0 ? ports : [makePort(`${nodeId}__out`, "SOUTH", 0)];
}

/**
 * human_input: one output port per outcome entry.
 * Handle ID format matches CanvasTaskNode: `outcome_{outcomeName}`.
 */
function computeHumanInputPorts(
  nodeId: string,
  config: Record<string, unknown>,
): PortDefinition[] {
  const outcomes = config.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return [makePort(`${nodeId}__out`, "SOUTH", 0)];
  }

  const ports: PortDefinition[] = [];
  let index = 0;

  for (const o of outcomes) {
    if (o != null && typeof o === "object" && typeof (o as Record<string, unknown>).name === "string") {
      const outcomeName = (o as Record<string, unknown>).name as string;
      ports.push(makePort(`${nodeId}__outcome_${outcomeName}`, "SOUTH", index, outcomeName));
      index++;
    }
  }

  return ports.length > 0 ? ports : [makePort(`${nodeId}__out`, "SOUTH", 0)];
}

/**
 * fork: one output port per outgoing edge from this node.
 * Handle IDs use a stable index: `branch_{index}`.
 */
function computeForkPorts(
  nodeId: string,
  edges: readonly WorkflowGraphEdge[],
): PortDefinition[] {
  const outgoing = edges.filter((e) => e.source === nodeId);

  if (outgoing.length <= 1) {
    return [makePort(`${nodeId}__out`, "SOUTH", 0)];
  }

  return outgoing.map((edge, index) => {
    const handleId = edge.sourceHandle ?? `branch_${index}`;
    return makePort(`${nodeId}__${handleId}`, "SOUTH", index);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePort(id: string, side: PortSide, index: number, label?: string): PortDefinition {
  return { id, side, index, ...(label !== undefined && { label }) };
}
