import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type {
  TopologyNode,
  TopologyEdge,
  TopologyNodeCategory,
  UseWorkflowTopologyReturn,
} from "./useWorkflowTopology";

const AI_KINDS = new Set([
  WorkflowTaskKind.agent_call,
  WorkflowTaskKind.llm_call,
  WorkflowTaskKind.eval,
]);

const CONTROL_FLOW_KINDS = new Set([
  WorkflowTaskKind.switch_case,
  WorkflowTaskKind.for_each,
  WorkflowTaskKind.fork,
  WorkflowTaskKind.try_catch,
]);

const INVOCATION_KINDS = new Set([
  WorkflowTaskKind.http_call,
  WorkflowTaskKind.grpc_call,
  WorkflowTaskKind.activity_call,
  WorkflowTaskKind.run_workflow,
]);

const DATA_KINDS = new Set([
  WorkflowTaskKind.set_vars,
  WorkflowTaskKind.transform,
]);

const GOVERNANCE_KINDS = new Set([
  WorkflowTaskKind.human_input,
  WorkflowTaskKind.validate,
]);

const EVENT_KINDS = new Set([
  WorkflowTaskKind.listen,
  WorkflowTaskKind.wait,
  WorkflowTaskKind.emit_event,
  WorkflowTaskKind.notification,
  WorkflowTaskKind.raise_error,
]);

const NODE_WIDTH = 180;
const NODE_HEIGHT = 40;

const EMPTY: UseWorkflowTopologyReturn = { nodes: [], edges: [] };

/**
 * Builds a DAG topology directly from proto `WorkflowTask[]`.
 *
 * Mirrors the logic in {@link useWorkflowTopology} but operates on
 * typed proto objects instead of parsed YAML, eliminating the need
 * for a round-trip through YAML serialization and re-parsing.
 *
 * Handles sequential flow, explicit `flow.then` directives, and
 * `switch_case` branching edges.
 */
export function topologyFromTasks(
  tasks: readonly WorkflowTask[],
): UseWorkflowTopologyReturn {
  if (tasks.length === 0) return EMPTY;

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const taskNameSet = new Set(tasks.map((t) => t.name));

  nodes.push({
    id: "__start__",
    label: "Start",
    kind: "start",
    category: "start",
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  });

  for (const task of tasks) {
    nodes.push({
      id: task.name,
      label: task.name,
      kind: kindToString(task.kind),
      category: categorizeKind(task.kind),
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  edges.push({ source: "__start__", target: tasks[0].name });

  const tasksWithEndFlow = new Set<string>();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const thenTarget = task.flow?.then;

    if (thenTarget === "end") {
      tasksWithEndFlow.add(task.name);
      continue;
    }

    if (thenTarget && taskNameSet.has(thenTarget)) {
      edges.push({ source: task.name, target: thenTarget });
      continue;
    }

    if (task.kind === WorkflowTaskKind.switch_case && task.taskConfig) {
      const cases = task.taskConfig.cases;
      if (Array.isArray(cases)) {
        let hasDefault = false;
        for (const c of cases) {
          if (c && typeof c === "object") {
            const caseObj = c as Record<string, unknown>;
            const caseThen = caseObj.then as string | undefined;
            if (caseThen && taskNameSet.has(caseThen)) {
              edges.push({
                source: task.name,
                target: caseThen,
                label: (caseObj.name as string) || undefined,
              });
              if (!(caseObj.when as string)) hasDefault = true;
            }
          }
        }
        if (!hasDefault && i < tasks.length - 1) {
          edges.push({ source: task.name, target: tasks[i + 1].name });
        }
        continue;
      }
    }

    if (i < tasks.length - 1) {
      edges.push({ source: task.name, target: tasks[i + 1].name });
    } else {
      tasksWithEndFlow.add(task.name);
    }
  }

  if (tasksWithEndFlow.size > 0) {
    nodes.push({
      id: "__end__",
      label: "End",
      kind: "end",
      category: "end",
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });

    for (const name of tasksWithEndFlow) {
      edges.push({ source: name, target: "__end__" });
    }
  }

  return { nodes, edges };
}

function categorizeKind(kind: WorkflowTaskKind): TopologyNodeCategory {
  if (AI_KINDS.has(kind)) return "ai";
  if (CONTROL_FLOW_KINDS.has(kind)) return "control_flow";
  if (INVOCATION_KINDS.has(kind)) return "invocation";
  if (DATA_KINDS.has(kind)) return "data";
  if (GOVERNANCE_KINDS.has(kind)) return "governance";
  if (EVENT_KINDS.has(kind)) return "event";
  return "unspecified";
}

function kindToString(kind: WorkflowTaskKind): string {
  const entry = Object.entries(WorkflowTaskKind).find(
    ([, v]) => v === kind && typeof v === "number",
  );
  return entry?.[0] ?? "unspecified";
}
