"use client";

import { useCallback, useMemo, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";
import { useWorkflowExecution } from "./useWorkflowExecution";
import { useWorkflowExecutionEventStream } from "./useWorkflowExecutionEventStream";
import { serializeWorkflowYaml } from "./serialize-workflow-yaml";
import { yamlToGraph, toReactFlowElements } from "./workflow-graph-conversions";
import type { CanvasTaskNodeData, NodeExecutionState } from "./workflow-graph-conversions";
import { applyDagreLayout } from "./layout";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store";

/** Options for {@link useWorkflowExecutionGraph}. */
export interface UseWorkflowExecutionGraphOptions {
  /** ID of the workflow execution to visualize. */
  readonly executionId: string;
}

/** Return value of {@link useWorkflowExecutionGraph}. */
export interface UseWorkflowExecutionGraphReturn {
  /** React Flow nodes with execution state merged into data. */
  readonly nodes: Node[];
  /** React Flow edges. */
  readonly edges: Edge[];
  /** Current execution lifecycle phase. */
  readonly executionPhase: ExecutionPhase | undefined;
  /** Currently selected task name in the graph. */
  readonly selectedTaskName: string | null;
  /** Set the selected task in the graph. */
  readonly setSelectedTaskName: (name: string | null) => void;
  /** `true` while the graph model is being loaded (workflow fetch + parse). */
  readonly isLoading: boolean;
  /** Error from workflow fetch or graph building. */
  readonly error: string | null;
  /**
   * When the workflow has been modified since this execution ran,
   * indicates the mismatch. `null` when no mismatch detected.
   */
  readonly versionMismatch: string | null;
  /** Task states from the event stream (for the inspector stub). */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
}

/**
 * Behavior hook that builds a complete read-only execution graph by:
 * 1. Fetching the execution to get the workflow reference
 * 2. Fetching the Workflow proto to get the definition
 * 3. Serializing to YAML and parsing into a graph model
 * 4. Computing dagre layout
 * 5. Converting to React Flow elements
 * 6. Merging live execution state from the event stream
 *
 * All data fetching goes through `useStigmer()` — no Console dependencies.
 */
export function useWorkflowExecutionGraph(
  options: UseWorkflowExecutionGraphOptions,
): UseWorkflowExecutionGraphReturn {
  const { executionId } = options;
  const stigmer = useStigmer();

  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  // 1. Fetch execution metadata
  const {
    execution,
    isLoading: isLoadingExecution,
    error: executionError,
  } = useWorkflowExecution(executionId);

  const phase = execution?.status?.phase;

  // 2. Resolve workflowId from execution spec
  const workflowId = execution?.spec?.workflowId || null;
  const workflowInstanceId = execution?.spec?.workflowInstanceId || null;

  // If we only have workflowInstanceId, resolve it to workflowId
  const instanceFetchFn = !workflowId && workflowInstanceId
    ? async () => {
        try {
          const instance = await stigmer.workflowInstance.get(workflowInstanceId);
          return instance.spec?.workflowId ?? null;
        } catch {
          return null;
        }
      }
    : null;

  const { data: resolvedWorkflowId } = useFetch(
    instanceFetchFn,
    [workflowInstanceId, stigmer],
    null,
  );

  const effectiveWorkflowId = workflowId || resolvedWorkflowId;

  // 3. Fetch the Workflow proto
  const workflowFetchFn = effectiveWorkflowId
    ? async () => {
        try {
          return await stigmer.workflow.get(effectiveWorkflowId);
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    : null;

  const {
    data: workflow,
    isLoading: isLoadingWorkflow,
    error: workflowError,
  } = useFetch(workflowFetchFn, [effectiveWorkflowId, stigmer], null);

  // 4. Build graph model: serialize -> parse -> layout -> elements
  const baseElements = useMemo<{ nodes: Node[]; edges: Edge[] } | null>(() => {
    if (!workflow) return null;
    try {
      const yaml = serializeWorkflowYaml(workflow);
      const graph = yamlToGraph(yaml);
      const laidOut = applyDagreLayout(graph);
      return toReactFlowElements(laidOut);
    } catch {
      return null;
    }
  }, [workflow]);

  // 5. Subscribe to execution event stream for live task states
  const {
    taskStates,
    streamState: _streamState,
  } = useWorkflowExecutionEventStream(executionId, {
    executionPhase: phase,
  });

  // 6. Merge execution state into node data
  const nodesWithExecution = useMemo<Node[]>(() => {
    if (!baseElements) return [];
    return baseElements.nodes.map((node) => {
      const nodeData = node.data as CanvasTaskNodeData;
      if (nodeData.isSentinel) return node;

      const taskState = taskStates.get(nodeData.taskName);
      const executionState: NodeExecutionState = taskState
        ? {
            status: taskState.status,
            durationMs: taskState.durationMs,
            costMicros: taskState.costMicros,
            attemptNumber: taskState.attemptNumber,
            error: taskState.error || undefined,
          }
        : { status: "not_reached" };

      return {
        ...node,
        data: { ...nodeData, executionState },
        draggable: false,
        connectable: false,
        deletable: false,
      };
    });
  }, [baseElements, taskStates]);

  const edges = useMemo<Edge[]>(() => {
    if (!baseElements) return [];
    return baseElements.edges;
  }, [baseElements]);

  // 7. Detect version mismatch
  const versionMismatch = useMemo<string | null>(() => {
    if (!execution?.status?.tasks || !baseElements) return null;

    const executionTaskNames = new Set(
      execution.status.tasks.map((t) => t.taskName).filter(Boolean),
    );
    const graphTaskNames = new Set(
      baseElements.nodes
        .map((n) => (n.data as CanvasTaskNodeData).taskName)
        .filter((name) => name !== "Start" && name !== "End"),
    );

    const inExecutionNotGraph = [...executionTaskNames].filter((n) => !graphTaskNames.has(n));
    const inGraphNotExecution = [...graphTaskNames].filter((n) => !executionTaskNames.has(n));

    if (inExecutionNotGraph.length > 0 || inGraphNotExecution.length > 0) {
      return "The workflow definition may have changed since this execution ran. The graph shows the current version.";
    }
    return null;
  }, [execution?.status?.tasks, baseElements]);

  // Aggregate loading/error state
  const isLoading = isLoadingExecution || isLoadingWorkflow;
  const error = executionError?.message
    ?? workflowError?.message
    ?? (!isLoading && !baseElements && effectiveWorkflowId ? "Unable to build workflow graph" : null)
    ?? null;

  // Auto-select failed task on initial load
  const autoSelectFailed = useCallback(() => {
    if (selectedTaskName) return;
    for (const [name, state] of taskStates) {
      if (state.status === "failed") {
        setSelectedTaskName(name);
        return;
      }
    }
  }, [taskStates, selectedTaskName]);

  // Trigger auto-select when task states arrive and phase is terminal
  useMemo(() => {
    if (phase && [3, 4, 5, 6].includes(phase)) {
      autoSelectFailed();
    }
  }, [phase, autoSelectFailed]);

  return {
    nodes: nodesWithExecution,
    edges,
    executionPhase: phase,
    selectedTaskName,
    setSelectedTaskName,
    isLoading,
    error,
    versionMismatch,
    taskStates,
  };
}
