"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";
import { useWorkflowExecution } from "./useWorkflowExecution";
import { useWorkflowExecutionEventStream } from "./useWorkflowExecutionEventStream";
import { serializeWorkflowYaml } from "./serialize-workflow-yaml";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { yamlToGraph, toReactFlowElements } from "./workflow-graph-conversions";
import type { CanvasTaskNodeData, NodeExecutionState } from "./workflow-graph-conversions";
import { applyDagreLayout } from "./layout";
import { EXECUTION_DAGRE_CONFIG } from "./canvas-constants";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store";
import type { WorkflowGraphModel } from "./workflow-graph-model";
import { deriveEdgeExecutionStates, deriveForkProgress } from "./execution";

/** Options for {@link useWorkflowExecutionGraph}. */
export interface UseWorkflowExecutionGraphOptions {
  /** ID of the workflow execution to visualize. */
  readonly executionId: string;

  /**
   * Pre-fetched execution from the parent. When provided, the hook
   * skips its own `useWorkflowExecution` call — eliminating the
   * duplicate fetch.
   */
  readonly execution?: WorkflowExecution | null;

  /**
   * Externally-derived task states from a shared event store. When
   * provided, the hook skips its own `useWorkflowExecutionEventStream`
   * call — eliminating the duplicate gRPC subscription.
   */
  readonly taskStates?: ReadonlyMap<string, DerivedTaskState>;

  /**
   * Callback invoked once when the hook auto-selects a failed task
   * on a terminal execution. The parent can wire this to its own
   * `setSelectedTaskName` to keep the inspector in sync.
   *
   * Without this, auto-selection only affects the hook's internal
   * `selectedTaskName` state and is invisible to sibling components.
   */
  readonly onAutoSelectTask?: (taskName: string) => void;

  /**
   * When `true`, non-sentinel nodes are marked `draggable: true` so
   * the parent component can allow ephemeral drag repositioning.
   * Sentinel nodes (Start/End) remain non-draggable regardless.
   * @default false
   */
  readonly nodesDraggable?: boolean;
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
  /** Task states from the event stream (for the inspector). */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
}

const EMPTY_TASK_STATES: ReadonlyMap<string, DerivedTaskState> = new Map();
const TERMINAL_PHASES = new Set([3, 4, 5, 6]);

/**
 * Behavior hook that builds a complete read-only execution graph by:
 * 1. Resolving the workflow definition (always fetched — it's the graph source)
 * 2. Serializing to YAML and parsing into a graph model
 * 3. Computing dagre layout
 * 4. Converting to React Flow elements
 * 5. Merging live execution state into node data
 *
 * When `execution` and `taskStates` are provided externally (from a
 * parent that already subscribes), the hook skips its own duplicate
 * subscriptions. When omitted, it falls back to independent fetching
 * for standalone `<WorkflowExecutionGraph executionId="..." />` usage.
 */
export function useWorkflowExecutionGraph(
  options: UseWorkflowExecutionGraphOptions,
): UseWorkflowExecutionGraphReturn {
  const { executionId, onAutoSelectTask, nodesDraggable = false } = options;
  const stigmer = useStigmer();

  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  // ── Execution data: use external or fetch own ────────────────────

  const ownExecution = useWorkflowExecution(
    options.execution !== undefined ? null : executionId,
  );

  const execution = options.execution !== undefined
    ? options.execution
    : ownExecution.execution;

  const isLoadingExecution = options.execution !== undefined
    ? false
    : ownExecution.isLoading;

  const executionError = options.execution !== undefined
    ? null
    : ownExecution.error;

  const phase = execution?.status?.phase;

  // ── Workflow definition fetch (always needed for graph building) ──

  const workflowId = execution?.spec?.workflowId || null;
  const workflowInstanceId = execution?.spec?.workflowInstanceId || null;

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

  // ── Build graph model ────────────────────────────────────────────

  const graphBuild = useMemo<{
    elements: { nodes: Node[]; edges: Edge[] };
    graphModel: WorkflowGraphModel;
  } | null>(() => {
    if (!workflow) return null;
    try {
      const yaml = serializeWorkflowYaml(workflow);
      const graph = yamlToGraph(yaml);
      const laidOut = applyDagreLayout(graph, EXECUTION_DAGRE_CONFIG);
      return { elements: toReactFlowElements(laidOut), graphModel: laidOut };
    } catch {
      return null;
    }
  }, [workflow]);

  const baseElements = graphBuild?.elements ?? null;
  const graphModel = graphBuild?.graphModel ?? null;

  // ── Task states: use external or subscribe own ───────────────────

  const ownStream = useWorkflowExecutionEventStream(
    options.taskStates !== undefined ? null : executionId,
    { executionPhase: phase },
  );

  const taskStates = options.taskStates !== undefined
    ? options.taskStates
    : ownStream.taskStates;

  // ── Merge execution state into nodes (T04) + fork progress (T06) + agent activity ──

  const pendingApprovals = execution?.status?.pendingApprovals;

  const nodesWithExecution = useMemo<Node[]>(() => {
    if (!baseElements) return [];
    return baseElements.nodes.map((node) => {
      const nodeData = node.data as CanvasTaskNodeData;
      if (nodeData.isSentinel) {
        return nodesDraggable ? { ...node, draggable: false } : node;
      }

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

      // T06: Derive fork progress for fork nodes.
      const forkProgress =
        nodeData.kind === WorkflowTaskKind.fork && nodeData.config
          ? deriveForkProgress(nodeData.config, taskStates)
          : null;

      // Agent activity for running agent_call nodes.
      const agentActivity =
        taskState?.status === "running" &&
        taskState.agentSlug &&
        (taskState.currentToolName || taskState.messagesCount > 0)
          ? {
              agentSlug: taskState.agentSlug,
              currentToolName: taskState.currentToolName,
              messagesCount: taskState.messagesCount,
              toolCallsCount: taskState.toolCallsCount,
            }
          : undefined;

      // Approval tool name from pending approvals matched by childExecutionId.
      let approvalToolName: string | undefined;
      if (taskState?.status === "waiting_approval" && taskState.childExecutionId && pendingApprovals) {
        const match = pendingApprovals.find(
          (pa) => pa.childAgentExecutionId === taskState.childExecutionId,
        );
        if (match?.approval?.toolName) {
          approvalToolName = match.approval.toolName;
        }
      }

      return {
        ...node,
        data: {
          ...nodeData,
          executionState,
          ...(forkProgress && { forkProgress }),
          ...(agentActivity && { agentActivity }),
          ...(approvalToolName && { approvalToolName }),
        },
        draggable: nodesDraggable,
        connectable: false,
        deletable: false,
      };
    });
  }, [baseElements, taskStates, pendingApprovals, nodesDraggable]);

  // ── Merge execution state into edges (T06) ──────────────────────

  const edgesWithExecution = useMemo<Edge[]>(() => {
    if (!baseElements || !graphModel) return [];

    const edgeStates = deriveEdgeExecutionStates(
      graphModel.edges,
      graphModel.nodes,
      taskStates,
    );

    return baseElements.edges.map((edge) => {
      const execState = edgeStates.get(edge.id);
      if (!execState || execState === "not_reached") return edge;
      return {
        ...edge,
        data: { ...edge.data, executionState: execState },
      };
    });
  }, [baseElements, graphModel, taskStates]);

  // ── Version mismatch detection ───────────────────────────────────

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

  // ── Loading / error aggregation ──────────────────────────────────

  const isLoading = isLoadingExecution || isLoadingWorkflow;
  const error = executionError?.message
    ?? workflowError?.message
    ?? (!isLoading && !baseElements && effectiveWorkflowId ? "Unable to build workflow graph" : null)
    ?? null;

  // ── Auto-select failed task (fires once on terminal phase) ───────

  const didAutoSelectRef = useRef(false);

  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (!phase || !TERMINAL_PHASES.has(phase)) return;
    if (selectedTaskName) return;

    for (const [name, state] of taskStates) {
      if (state.status === "failed") {
        didAutoSelectRef.current = true;
        setSelectedTaskName(name);
        onAutoSelectTask?.(name);
        return;
      }
    }
  }, [phase, taskStates, selectedTaskName, onAutoSelectTask]);

  return {
    nodes: nodesWithExecution,
    edges: edgesWithExecution,
    executionPhase: phase,
    selectedTaskName,
    setSelectedTaskName,
    isLoading,
    error,
    versionMismatch,
    taskStates,
  };
}
