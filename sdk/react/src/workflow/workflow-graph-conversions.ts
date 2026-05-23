import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { WorkflowTaskKind, BudgetExceededPolicy } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { Node, Edge } from "@xyflow/react";
import type {
  WorkflowInput,
  WorkflowTaskInput,
  WorkflowDocumentInput,
  ExportInput,
  FlowControlInput,
} from "@stigmer/sdk";
import type { TopologyNodeCategory } from "./useWorkflowTopology";
import type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
  WorkflowGraphDocument,
  WorkflowGraphBudget,
  WorkflowGraphEnvVar,
} from "./workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model";
import { categorizeKind, kindToDisplayName } from "./kind-metadata";
import { getVisualSpec, type VisualClass } from "./task-type-visual-registry";

// ---------------------------------------------------------------------------
// React Flow node/edge type identifiers
// ---------------------------------------------------------------------------

export const CANVAS_TASK_NODE_TYPE = "canvasTask" as const;
export const CANVAS_TRANSITION_EDGE_TYPE = "canvasTransition" as const;

// ---------------------------------------------------------------------------
// Re-export categorizeKind from the canonical module for backward compatibility.
// Callers that previously imported from this file continue to work.
// ---------------------------------------------------------------------------

export { categorizeKind } from "./kind-metadata";

// ---------------------------------------------------------------------------
// Enum maps (reuse the same logic as serialize-workflow-yaml.ts)
// ---------------------------------------------------------------------------

const TASK_KIND_STRINGS: ReadonlyMap<WorkflowTaskKind, string> = new Map(
  Object.entries(WorkflowTaskKind)
    .filter(
      (entry): entry is [string, WorkflowTaskKind] =>
        typeof entry[1] === "number" &&
        entry[1] !== WorkflowTaskKind.workflow_task_kind_unspecified,
    )
    .map(([name, value]) => [value, name]),
);

const STRING_TO_TASK_KIND: ReadonlyMap<string, WorkflowTaskKind> = new Map(
  Array.from(TASK_KIND_STRINGS.entries()).map(([value, name]) => [name, value]),
);

export function taskKindToString(kind: WorkflowTaskKind): string {
  return TASK_KIND_STRINGS.get(kind) ?? `unknown_${kind}`;
}

export function stringToTaskKind(str: string): WorkflowTaskKind {
  return STRING_TO_TASK_KIND.get(str) ?? WorkflowTaskKind.workflow_task_kind_unspecified;
}

const BUDGET_POLICY_STRINGS: ReadonlyMap<BudgetExceededPolicy, string> = new Map([
  [BudgetExceededPolicy.budget_exceeded_terminate, "budget_exceeded_terminate"],
  [BudgetExceededPolicy.budget_exceeded_human_review, "budget_exceeded_human_review"],
  [BudgetExceededPolicy.budget_exceeded_warn, "budget_exceeded_warn"],
]);

const STRING_TO_BUDGET_POLICY: ReadonlyMap<string, BudgetExceededPolicy> = new Map(
  Array.from(BUDGET_POLICY_STRINGS.entries()).map(([v, n]) => [n, v]),
);

// ---------------------------------------------------------------------------
// yamlToGraph
// ---------------------------------------------------------------------------

interface RawTask {
  name: string;
  kind: string;
  task_config?: Record<string, unknown>;
  taskConfig?: Record<string, unknown>;
  flow?: { then?: string };
  export?: { as?: string };
}

/**
 * Parses a Stigmer Workflow YAML string into an editable graph model.
 *
 * Builds nodes from `spec.tasks` with full configuration data, and infers
 * edges from sequential ordering, explicit `flow.then`, `switch_case`
 * branches, `human_input` outcomes, and fallback task references.
 *
 * @throws {Error} When the YAML is fundamentally unparseable or lacks required structure.
 *
 * @since T15 (Visual Canvas Editor)
 */
export function yamlToGraph(yaml: string): WorkflowGraphModel {
  const parsed = parseYamlSafe(yaml);
  const spec = requireObj(parsed.spec, "spec");
  const rawDocument = requireObj(spec.document, "spec.document");

  const document: WorkflowGraphDocument = {
    dsl: typeof rawDocument.dsl === "string" ? rawDocument.dsl : "1.0.0",
    namespace: requireString(rawDocument, "namespace"),
    name: requireString(rawDocument, "name"),
    version: requireString(rawDocument, "version"),
    ...(typeof rawDocument.description === "string" && { description: rawDocument.description }),
  };

  const description = typeof spec.description === "string" ? spec.description : undefined;
  const env = extractEnv(spec);
  const budget = extractBudget(spec);

  const rawTasks = spec.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new Error("Workflow YAML is missing required field: spec.tasks.");
  }

  const tasks = rawTasks.filter(
    (t): t is RawTask =>
      t != null && typeof t === "object" && typeof (t as RawTask).name === "string",
  );

  if (tasks.length === 0) {
    throw new Error("Workflow YAML: spec.tasks contains no valid task entries.");
  }

  const taskNameSet = new Set(tasks.map((t) => t.name));
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];
  let edgeCounter = 0;

  const makeEdgeId = () => `e_${edgeCounter++}`;

  // Sentinel: Start node
  nodes.push({
    id: START_NODE_ID,
    taskName: "Start",
    kind: WorkflowTaskKind.workflow_task_kind_unspecified,
    category: "start",
    config: {} as JsonObject,
    position: { x: 0, y: 0 },
  });

  // Task nodes
  for (const task of tasks) {
    const config = (task.task_config ?? task.taskConfig ?? {}) as JsonObject;
    const kindEnum = stringToTaskKind(task.kind);
    const kindStr = kindEnum !== WorkflowTaskKind.workflow_task_kind_unspecified ? task.kind : task.kind;

    nodes.push({
      id: task.name,
      taskName: task.name,
      kind: kindEnum,
      category: categorizeKind(task.kind),
      config,
      ...(task.export?.as && { export: { as: task.export.as } }),
      ...(task.flow?.then && { flow: { then: task.flow.then } }),
      position: { x: 0, y: 0 },
    });
  }

  // Edge: start → first task
  edges.push({ id: makeEdgeId(), source: START_NODE_ID, target: tasks[0].name });

  const tasksWithEndFlow = new Set<string>();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const thenTarget = task.flow?.then;

    if (thenTarget === "end") {
      tasksWithEndFlow.add(task.name);
      continue;
    }

    if (thenTarget && taskNameSet.has(thenTarget)) {
      edges.push({ id: makeEdgeId(), source: task.name, target: thenTarget });
      continue;
    }

    // switch_case: edges per case branch
    const config = task.task_config ?? task.taskConfig;
    if (task.kind === "switch_case" && config) {
      const cases = (config as Record<string, unknown>).cases;
      if (Array.isArray(cases)) {
        let hasDefault = false;
        for (const c of cases) {
          if (c && typeof c === "object") {
            const caseObj = c as Record<string, unknown>;
            const caseName = caseObj.name as string | undefined;
            const caseThen = caseObj.then as string | undefined;
            if (caseName && caseThen && taskNameSet.has(caseThen)) {
              edges.push({
                id: makeEdgeId(),
                source: task.name,
                target: caseThen,
                label: caseName,
                sourceHandle: `case_${caseName}`,
              });
              if (!(caseObj.when as string)) hasDefault = true;
            }
          }
        }
        if (!hasDefault && i < tasks.length - 1) {
          edges.push({ id: makeEdgeId(), source: task.name, target: tasks[i + 1].name });
        }
        continue;
      }
    }

    // human_input: edges per outcome
    if (task.kind === "human_input" && config) {
      const outcomes = (config as Record<string, unknown>).outcomes;
      if (Array.isArray(outcomes)) {
        let hasOutcomeEdges = false;
        for (const outcome of outcomes) {
          if (outcome && typeof outcome === "object") {
            const outObj = outcome as Record<string, unknown>;
            const outName = outObj.name as string | undefined;
            const outThen = outObj.then as string | undefined;
            if (outName && outThen && taskNameSet.has(outThen)) {
              edges.push({
                id: makeEdgeId(),
                source: task.name,
                target: outThen,
                label: outName,
                sourceHandle: `outcome_${outName}`,
              });
              hasOutcomeEdges = true;
            }
          }
        }
        if (hasOutcomeEdges) continue;
      }
    }

    // Default: sequential to next task
    if (i < tasks.length - 1) {
      edges.push({ id: makeEdgeId(), source: task.name, target: tasks[i + 1].name });
    } else {
      tasksWithEndFlow.add(task.name);
    }
  }

  // Sentinel: End node
  if (tasksWithEndFlow.size > 0) {
    nodes.push({
      id: END_NODE_ID,
      taskName: "End",
      kind: WorkflowTaskKind.workflow_task_kind_unspecified,
      category: "end",
      config: {} as JsonObject,
      position: { x: 0, y: 0 },
    });

    for (const name of tasksWithEndFlow) {
      edges.push({ id: makeEdgeId(), source: name, target: END_NODE_ID });
    }
  }

  return { document, description, env, budget, nodes, edges };
}

// ---------------------------------------------------------------------------
// graphToYaml
// ---------------------------------------------------------------------------

/**
 * Serializes a graph model back to canonical Stigmer Workflow YAML.
 *
 * Uses topological sort to determine task ordering. Sequential transitions
 * (task N → task N+1 in sorted order) are implicit and omitted from YAML.
 * Non-sequential transitions emit explicit `flow.then` directives.
 *
 * @since T15 (Visual Canvas Editor)
 */
export function graphToYaml(graph: WorkflowGraphModel): string {
  const taskNodes = graph.nodes.filter(
    (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
  );

  const sortedTasks = topologicalSort(taskNodes, graph.edges);

  const tasks: Record<string, unknown>[] = sortedTasks.map((node, idx) => {
    const kindStr = taskKindToString(node.kind);
    const result: Record<string, unknown> = {
      name: node.taskName,
      kind: kindStr,
    };

    if (Object.keys(node.config).length > 0) {
      result.task_config = structToPlain(node.config);

      if (kindStr === "switch_case") {
        reconstructSwitchCaseThen(node, graph.edges, result);
      }
      if (kindStr === "human_input") {
        reconstructHumanInputOutcomeThen(node, graph.edges, result);
      }
    }

    if (node.export?.as) {
      result.export = { as: node.export.as };
    }

    // Determine flow.then
    const outgoingEdges = graph.edges.filter(
      (e) => e.source === node.id && !e.sourceHandle,
    );

    if (outgoingEdges.length === 1) {
      const target = outgoingEdges[0].target;
      if (target === END_NODE_ID) {
        result.flow = { then: "end" };
      } else {
        const nextInOrder = sortedTasks[idx + 1];
        if (!nextInOrder || target !== nextInOrder.id) {
          result.flow = { then: target };
        }
      }
    } else if (outgoingEdges.length === 0 && idx < sortedTasks.length - 1) {
      // Terminal task that isn't last in sort order — explicit end
      const hasHandledEdges = graph.edges.some(
        (e) => e.source === node.id && e.sourceHandle,
      );
      if (!hasHandledEdges) {
        result.flow = { then: "end" };
      }
    }

    return result;
  });

  const doc: Record<string, unknown> = {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Workflow",
    metadata: { name: graph.document.name },
    spec: {
      document: {
        dsl: graph.document.dsl,
        namespace: graph.document.namespace,
        name: graph.document.name,
        version: graph.document.version,
        ...(graph.document.description && { description: graph.document.description }),
      },
      ...(graph.description && { description: graph.description }),
      tasks,
      ...(graph.env && Object.keys(graph.env).length > 0 && { env: serializeEnv(graph.env) }),
      ...(graph.budget && hasBudgetValues(graph.budget) && { budget: serializeBudget(graph.budget) }),
    },
  };

  return stringifyYaml(doc, { lineWidth: 0, blockQuote: "literal" });
}

// ---------------------------------------------------------------------------
// graphToWorkflowInput
// ---------------------------------------------------------------------------

/**
 * Converts a graph model into a `WorkflowInput` suitable for
 * `stigmer.workflow.apply()`.
 *
 * This will be the primary save path in Batch 3 when `useWorkflowSave`
 * is extended to accept `WorkflowInput` directly.
 *
 * @since T15 (Visual Canvas Editor)
 */
export function graphToWorkflowInput(
  graph: WorkflowGraphModel,
  org: string,
): WorkflowInput {
  const taskNodes = graph.nodes.filter(
    (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
  );

  const sortedTasks = topologicalSort(taskNodes, graph.edges);

  const tasks: WorkflowTaskInput[] = sortedTasks.map((node, idx) => {
    const result: WorkflowTaskInput = {
      name: node.taskName,
      kind: node.kind,
      taskConfig: node.config,
    };

    if (node.export?.as) {
      (result as { export?: ExportInput }).export = { as: node.export.as };
    }

    // Determine flow.then
    const outgoingEdges = graph.edges.filter(
      (e) => e.source === node.id && !e.sourceHandle,
    );

    if (outgoingEdges.length === 1) {
      const target = outgoingEdges[0].target;
      if (target === END_NODE_ID) {
        (result as { flow?: FlowControlInput }).flow = { then: "end" };
      } else {
        const nextInOrder = sortedTasks[idx + 1];
        if (!nextInOrder || target !== nextInOrder.id) {
          (result as { flow?: FlowControlInput }).flow = { then: target };
        }
      }
    }

    return result;
  });

  const document: WorkflowDocumentInput = {
    dsl: graph.document.dsl,
    namespace: graph.document.namespace,
    name: graph.document.name,
    version: graph.document.version,
    ...(graph.document.description && { description: graph.document.description }),
  };

  const budget = graph.budget && hasBudgetValues(graph.budget)
    ? buildBudgetInput(graph.budget)
    : undefined;

  const env = graph.env && Object.keys(graph.env).length > 0
    ? buildEnvInput(graph.env)
    : undefined;

  return {
    name: graph.document.name,
    org,
    ...(graph.description && { description: graph.description }),
    document,
    tasks,
    ...(env && { env }),
    ...(budget && { budget }),
  };
}

// ---------------------------------------------------------------------------
// toReactFlowElements
// ---------------------------------------------------------------------------

/**
 * Execution status for a single node in the execution graph.
 * Derived from `DerivedTaskState` in the event store, plus a synthetic
 * `"not_reached"` value for nodes the execution has not touched.
 */
export type NodeExecutionStatus =
  | "not_reached"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "retrying"
  | "waiting_approval";

/** Per-node execution state attached to canvas nodes in execution mode. */
export interface NodeExecutionState {
  readonly status: NodeExecutionStatus;
  readonly durationMs?: number;
  readonly costMicros?: bigint;
  readonly attemptNumber?: number;
  readonly error?: string;
}

/** Data payload attached to canvas task nodes. */
export interface CanvasTaskNodeData extends Record<string, unknown> {
  taskName: string;
  kind: WorkflowTaskKind;
  kindString: string;
  category: TopologyNodeCategory;
  visualClass: VisualClass;
  displayName: string;
  ariaShapeLabel: string;
  config: JsonObject;
  exportAs?: string;
  isSentinel: boolean;
  errorCount?: number;
  executionState?: NodeExecutionState;
  /** Fork branch completion progress (T06). Present only for fork nodes in execution mode. */
  forkProgress?: { readonly completed: number; readonly total: number; readonly compete: boolean };
}

/** Data payload attached to canvas transition edges. */
export interface CanvasTransitionEdgeData extends Record<string, unknown> {
  label?: string;
  /** Edge execution state (T06). Present only in execution mode. */
  executionState?: import("./execution").EdgeExecutionState;
}

/**
 * Converts a `WorkflowGraphModel` into React Flow node and edge arrays
 * with the custom type identifiers used by `CanvasTaskNode` and
 * `CanvasTransitionEdge`.
 *
 * @since T15 (Visual Canvas Editor)
 */
export function toReactFlowElements(graph: WorkflowGraphModel): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = graph.nodes.map((node) => {
    const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
    const kindString = taskKindToString(node.kind);
    const visualSpec = getVisualSpec(isSentinel ? node.id : kindString);
    return {
      id: node.id,
      type: CANVAS_TASK_NODE_TYPE,
      position: { x: node.position.x, y: node.position.y },
      data: {
        taskName: node.taskName,
        kind: node.kind,
        kindString,
        category: node.category,
        visualClass: visualSpec.visualClass,
        displayName: isSentinel ? node.taskName : kindToDisplayName(kindString),
        ariaShapeLabel: visualSpec.ariaShapeLabel,
        config: node.config,
        exportAs: node.export?.as,
        isSentinel,
      } satisfies Omit<CanvasTaskNodeData, "errorCount">,
      width: visualSpec.defaultWidth,
      height: visualSpec.defaultHeight,
      draggable: !isSentinel,
      selectable: !isSentinel,
      deletable: !isSentinel,
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    type: CANVAS_TRANSITION_EDGE_TYPE,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    data: { label: edge.label },
    animated: false,
  }));

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

function topologicalSort(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[],
): WorkflowGraphNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Also consider edges from __start__ to find the first task
  const startEdges = edges.filter((e) => e.source === START_NODE_ID);
  for (const se of startEdges) {
    if (inDegree.has(se.target)) {
      inDegree.set(se.target, Math.max(0, (inDegree.get(se.target) ?? 1) - 1));
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const sorted: WorkflowGraphNode[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(id) ?? []) {
      if (visited.has(neighbor)) continue;
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree <= 0) queue.push(neighbor);
    }
  }

  // Append any nodes not reached (cycle protection — preserves original order)
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      sorted.push(node);
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function reconstructSwitchCaseThen(
  node: WorkflowGraphNode,
  edges: readonly WorkflowGraphEdge[],
  result: Record<string, unknown>,
): void {
  const taskConfig = result.task_config as Record<string, unknown> | undefined;
  if (!taskConfig) return;

  const cases = taskConfig.cases;
  if (!Array.isArray(cases)) return;

  const caseEdges = edges.filter(
    (e) => e.source === node.id && e.sourceHandle?.startsWith("case_"),
  );

  for (const edge of caseEdges) {
    const caseName = edge.sourceHandle!.slice(5); // "case_".length
    const caseEntry = cases.find(
      (c) => c && typeof c === "object" && (c as Record<string, unknown>).name === caseName,
    );
    if (caseEntry) {
      (caseEntry as Record<string, unknown>).then = edge.target;
    }
  }
}

function reconstructHumanInputOutcomeThen(
  node: WorkflowGraphNode,
  edges: readonly WorkflowGraphEdge[],
  result: Record<string, unknown>,
): void {
  const taskConfig = result.task_config as Record<string, unknown> | undefined;
  if (!taskConfig) return;

  const outcomes = taskConfig.outcomes;
  if (!Array.isArray(outcomes)) return;

  const outcomeEdges = edges.filter(
    (e) => e.source === node.id && e.sourceHandle?.startsWith("outcome_"),
  );

  for (const edge of outcomeEdges) {
    const outcomeName = edge.sourceHandle!.slice(8); // "outcome_".length
    const outcomeEntry = outcomes.find(
      (o) => o && typeof o === "object" && (o as Record<string, unknown>).name === outcomeName,
    );
    if (outcomeEntry) {
      (outcomeEntry as Record<string, unknown>).then = edge.target;
    }
  }
}

function structToPlain(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return Number(obj);
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(structToPlain);

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = structToPlain(v);
  }
  return result;
}

function serializeEnv(env: Readonly<Record<string, WorkflowGraphEnvVar>>): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, decl] of Object.entries(env)) {
    const entry: Record<string, unknown> = {};
    if (decl.isSecret) entry.is_secret = true;
    if (decl.description) entry.description = decl.description;
    if (decl.optional) entry.optional = true;
    result[key] = entry;
  }
  return result;
}

function serializeBudget(budget: WorkflowGraphBudget): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (budget.maxCostMicros && budget.maxCostMicros > 0) result.max_cost_micros = budget.maxCostMicros;
  if (budget.maxTotalTokens && budget.maxTotalTokens > 0) result.max_total_tokens = budget.maxTotalTokens;
  if (budget.maxDurationSeconds && budget.maxDurationSeconds > 0) result.max_duration_seconds = budget.maxDurationSeconds;
  if (budget.onExceeded) result.on_exceeded = budget.onExceeded;
  return result;
}

function hasBudgetValues(budget: WorkflowGraphBudget): boolean {
  return (
    (budget.maxCostMicros != null && budget.maxCostMicros > 0) ||
    (budget.maxTotalTokens != null && budget.maxTotalTokens > 0) ||
    (budget.maxDurationSeconds != null && budget.maxDurationSeconds > 0)
  );
}

function buildBudgetInput(budget: WorkflowGraphBudget): NonNullable<WorkflowInput["budget"]> {
  const result: NonNullable<WorkflowInput["budget"]> = {};
  if (budget.maxCostMicros && budget.maxCostMicros > 0) {
    result.maxCostMicros = BigInt(budget.maxCostMicros);
  }
  if (budget.maxTotalTokens && budget.maxTotalTokens > 0) {
    result.maxTotalTokens = BigInt(budget.maxTotalTokens);
  }
  if (budget.maxDurationSeconds && budget.maxDurationSeconds > 0) {
    result.maxDurationSeconds = budget.maxDurationSeconds;
  }
  if (budget.onExceeded) {
    const policy = STRING_TO_BUDGET_POLICY.get(budget.onExceeded);
    if (policy !== undefined) result.onExceeded = policy;
  }
  return result;
}

function buildEnvInput(env: Readonly<Record<string, WorkflowGraphEnvVar>>): WorkflowInput["env"] {
  const result: NonNullable<WorkflowInput["env"]> = {};
  for (const [key, decl] of Object.entries(env)) {
    result[key] = {
      ...(decl.isSecret && { isSecret: true }),
      ...(decl.description && { description: decl.description }),
      ...(decl.optional && { optional: true }),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function extractEnv(spec: Record<string, unknown>): Record<string, WorkflowGraphEnvVar> | undefined {
  const raw = spec.env;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const result: Record<string, WorkflowGraphEnvVar> = {};
  let hasEntries = false;

  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    result[key] = {
      ...(typeof (v.is_secret ?? v.isSecret) === "boolean" && { isSecret: (v.is_secret ?? v.isSecret) as boolean }),
      ...(typeof v.description === "string" && { description: v.description }),
      ...(typeof v.optional === "boolean" && { optional: v.optional }),
    };
    hasEntries = true;
  }

  return hasEntries ? result : undefined;
}

function extractBudget(spec: Record<string, unknown>): WorkflowGraphBudget | undefined {
  const raw = spec.budget;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const b = raw as Record<string, unknown>;
  const maxCostMicros = toNumber(b.max_cost_micros ?? b.maxCostMicros);
  const maxTotalTokens = toNumber(b.max_total_tokens ?? b.maxTotalTokens);
  const maxDurationSeconds = toNumber(b.max_duration_seconds ?? b.maxDurationSeconds);
  const onExceeded = typeof (b.on_exceeded ?? b.onExceeded) === "string"
    ? (b.on_exceeded ?? b.onExceeded) as string
    : undefined;

  if (!maxCostMicros && !maxTotalTokens && !maxDurationSeconds) return undefined;

  return {
    ...(maxCostMicros && { maxCostMicros }),
    ...(maxTotalTokens && { maxTotalTokens }),
    ...(maxDurationSeconds && { maxDurationSeconds }),
    ...(onExceeded && { onExceeded }),
  };
}

function parseYamlSafe(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    throw new Error("Failed to parse content as YAML.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML must be a mapping document.");
  }
  return parsed as Record<string, unknown>;
}

function requireObj(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Workflow YAML is missing required field: ${path}.`);
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`Workflow YAML is missing required string field: ${key}.`);
  }
  return val;
}

function toNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val) && val > 0) return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}
