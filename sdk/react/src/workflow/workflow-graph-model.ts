import type { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { TopologyNodeCategory } from "./useWorkflowTopology";

/**
 * Complete graph representation of a workflow, serving as the source
 * of truth while in canvas editing mode.
 *
 * Carries all data needed to:
 * - Render as React Flow elements (`toReactFlowElements`)
 * - Serialize back to YAML (`graphToYaml`)
 * - Save via the SDK (`graphToWorkflowInput`)
 *
 * @since T15 (Visual Canvas Editor)
 */
export interface WorkflowGraphModel {
  readonly document: WorkflowGraphDocument;
  readonly description?: string;
  readonly env?: Readonly<Record<string, WorkflowGraphEnvVar>>;
  readonly budget?: WorkflowGraphBudget;
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
}

export interface WorkflowGraphDocument {
  readonly dsl: string;
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
}

export interface WorkflowGraphEnvVar {
  readonly defaultValue?: string;
  readonly isSecret?: boolean;
  readonly description?: string;
  readonly optional?: boolean;
}

export interface WorkflowGraphBudget {
  readonly maxCostMicros?: number;
  readonly maxTotalTokens?: number;
  readonly maxDurationSeconds?: number;
  readonly onExceeded?: string;
}

/**
 * A single task node in the workflow graph.
 *
 * Sentinel nodes (`__start__`, `__end__`) use `WorkflowTaskKind` value 0
 * (unspecified) and special category values.
 */
export interface WorkflowGraphNode {
  readonly id: string;
  readonly taskName: string;
  readonly kind: WorkflowTaskKind;
  readonly category: TopologyNodeCategory;
  readonly config: JsonObject;
  readonly export?: { readonly as: string };
  readonly flow?: { readonly then?: string };
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * A directed edge between two nodes in the workflow graph.
 *
 * Edges are inferred from task ordering, explicit `flow.then` directives,
 * `switch_case` branches, and `human_input` outcome routing.
 */
export interface WorkflowGraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  /** For multi-port nodes (switch_case, human_input): identifies the source handle. */
  readonly sourceHandle?: string;
}

/** Sentinel node ID for the workflow entry point. */
export const START_NODE_ID = "__start__" as const;

/** Sentinel node ID for explicit workflow termination. */
export const END_NODE_ID = "__end__" as const;
