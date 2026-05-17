"use client";

import { useMemo } from "react";
import { parse as parseYaml } from "yaml";

/** A node in the workflow topology graph. */
export interface TopologyNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly category: TopologyNodeCategory;
  /** Layout position computed by dagre (set after layout). */
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
}

/** An edge in the workflow topology graph. */
export interface TopologyEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
}

export type TopologyNodeCategory =
  | "start"
  | "end"
  | "ai"
  | "control_flow"
  | "invocation"
  | "data"
  | "governance"
  | "event"
  | "unspecified";

/** Return value of {@link useWorkflowTopology}. */
export interface UseWorkflowTopologyReturn {
  readonly nodes: readonly TopologyNode[];
  readonly edges: readonly TopologyEdge[];
}

const AI_KINDS = new Set(["agent_call", "llm_call", "eval"]);
const CONTROL_FLOW_KINDS = new Set(["switch_case", "for_each", "fork", "try_catch"]);
const INVOCATION_KINDS = new Set(["http_call", "grpc_call", "activity_call", "run_workflow"]);
const DATA_KINDS = new Set(["set_vars", "transform"]);
const GOVERNANCE_KINDS = new Set(["human_input", "validate"]);
const EVENT_KINDS = new Set(["listen", "wait", "emit_event", "notification", "raise_error"]);

const NODE_WIDTH = 180;
const NODE_HEIGHT = 40;

/**
 * Behavior hook that computes a DAG topology from workflow YAML.
 *
 * Parses the YAML into tasks and builds a node + edge graph suitable
 * for rendering. Handles sequential flow, explicit `flow.then` directives,
 * and `switch_case` branching edges.
 *
 * Returns stable refs (DD-010) — the result is memoized and only
 * recomputed when the YAML content changes.
 *
 * @param yaml - The current workflow YAML string (or `null`/empty to skip).
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export function useWorkflowTopology(
  yaml: string | null,
): UseWorkflowTopologyReturn {
  return useMemo(() => {
    if (!yaml?.trim()) return EMPTY_TOPOLOGY;

    try {
      return computeTopology(yaml);
    } catch {
      return EMPTY_TOPOLOGY;
    }
  }, [yaml]);
}

const EMPTY_TOPOLOGY: UseWorkflowTopologyReturn = { nodes: [], edges: [] };

// ---------------------------------------------------------------------------
// Topology computation
// ---------------------------------------------------------------------------

interface RawTask {
  name: string;
  kind: string;
  task_config?: Record<string, unknown>;
  taskConfig?: Record<string, unknown>;
  flow?: { then?: string };
  export?: { as?: string };
}

function computeTopology(yaml: string): UseWorkflowTopologyReturn {
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    return EMPTY_TOPOLOGY;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return EMPTY_TOPOLOGY;
  }

  const doc = parsed as Record<string, unknown>;
  const spec = doc.spec as Record<string, unknown> | undefined;
  if (!spec) return EMPTY_TOPOLOGY;

  const rawTasks = spec.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) return EMPTY_TOPOLOGY;

  const tasks = rawTasks.filter(
    (t): t is RawTask =>
      t != null && typeof t === "object" && typeof (t as RawTask).name === "string",
  );

  if (tasks.length === 0) return EMPTY_TOPOLOGY;

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const taskNameSet = new Set(tasks.map((t) => t.name));

  const startNode: TopologyNode = {
    id: "__start__",
    label: "Start",
    kind: "start",
    category: "start",
    x: 0, y: 0,
    width: NODE_WIDTH, height: NODE_HEIGHT,
  };
  nodes.push(startNode);

  for (const task of tasks) {
    nodes.push({
      id: task.name,
      label: task.name,
      kind: task.kind || "unspecified",
      category: categorizeKind(task.kind),
      x: 0, y: 0,
      width: NODE_WIDTH, height: NODE_HEIGHT,
    });
  }

  // Edge: start → first task
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

    // switch_case: add edges for each case
    const config = task.task_config ?? task.taskConfig;
    if (task.kind === "switch_case" && config) {
      const cases = (config as Record<string, unknown>).cases;
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

    // Default: sequential to next task
    if (i < tasks.length - 1) {
      edges.push({ source: task.name, target: tasks[i + 1].name });
    } else {
      tasksWithEndFlow.add(task.name);
    }
  }

  // Add end node if any tasks flow to "end" or the last task has no explicit successor
  if (tasksWithEndFlow.size > 0) {
    const endNode: TopologyNode = {
      id: "__end__",
      label: "End",
      kind: "end",
      category: "end",
      x: 0, y: 0,
      width: NODE_WIDTH, height: NODE_HEIGHT,
    };
    nodes.push(endNode);

    for (const name of tasksWithEndFlow) {
      edges.push({ source: name, target: "__end__" });
    }
  }

  return { nodes, edges };
}

function categorizeKind(kind: string): TopologyNodeCategory {
  if (AI_KINDS.has(kind)) return "ai";
  if (CONTROL_FLOW_KINDS.has(kind)) return "control_flow";
  if (INVOCATION_KINDS.has(kind)) return "invocation";
  if (DATA_KINDS.has(kind)) return "data";
  if (GOVERNANCE_KINDS.has(kind)) return "governance";
  if (EVENT_KINDS.has(kind)) return "event";
  return "unspecified";
}
