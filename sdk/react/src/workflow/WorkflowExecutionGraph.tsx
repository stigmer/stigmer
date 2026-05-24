"use client";

import "@xyflow/react/dist/style.css";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { Node, Viewport } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import { WorkflowNode } from "./WorkflowNode";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge";
import { CANVAS_TASK_NODE_TYPE, CANVAS_TRANSITION_EDGE_TYPE } from "./workflow-graph-conversions";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { WorkflowGraphModeProvider } from "./WorkflowGraphModeContext";
import { useWorkflowExecutionGraph } from "./useWorkflowExecutionGraph";
import type { UseWorkflowExecutionGraphReturn } from "./useWorkflowExecutionGraph";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { useFollowExecution } from "./useFollowExecution";
import { useActiveTaskName } from "./useActiveTaskName";
import { useExecutionAnnouncements } from "./useExecutionAnnouncements";
import { ExecutionActiveTaskIndicator } from "./ExecutionActiveTaskIndicator";
import { getAnimationDuration } from "./motion-preference";

/** Props for {@link WorkflowExecutionGraph}. */
export interface WorkflowExecutionGraphProps {
  /** ID of the workflow execution to visualize. */
  readonly executionId: string;
  /** Callback when a task node is selected or deselected. */
  readonly onTaskSelect?: (taskName: string | null) => void;
  /** When true, the viewport auto-pans to follow the currently running node. */
  readonly followExecution?: boolean;
  /**
   * Pre-fetched execution from the parent. When provided, the graph
   * skips its own execution fetch — eliminating duplicate API calls.
   * Pass `undefined` (or omit) for standalone usage.
   */
  readonly execution?: WorkflowExecution | null;
  /**
   * Externally-derived task states from a shared event store. When
   * provided, the graph skips its own event stream subscription.
   * Pass `undefined` (or omit) for standalone usage.
   */
  readonly taskStates?: ReadonlyMap<string, DerivedTaskState>;
  /**
   * Callback invoked when the graph auto-selects a failed task on
   * terminal executions. Wire this to the parent's selected-task
   * state to keep sibling components (like the inspector) in sync.
   */
  readonly onAutoSelectTask?: (taskName: string) => void;
  /**
   * Pixel width of adjacent panels (inspector, sidebar) that occlude
   * the right side of the graph viewport. The follow-execution camera
   * offsets its center to keep the active node visually centered in the
   * unoccluded area. Defaults to 0.
   */
  readonly panelOffsetPx?: number;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

const nodeTypes = {
  [CANVAS_TASK_NODE_TYPE]: WorkflowNode,
} as const;

const edgeTypes = {
  [CANVAS_TRANSITION_EDGE_TYPE]: CanvasTransitionEdge,
} as const;

const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
};

/**
 * Read-only execution graph canvas for workflow executions.
 *
 * Reuses the same `WorkflowNode` / `NodeShell` node rendering system from
 * the visual editor, wrapped in execution mode context to show live status
 * overlays instead of editing affordances.
 *
 * Designed for embedding in both the Stigmer Console and third-party
 * dashboards — no routing, auth, or app-shell dependencies (DD-004).
 *
 * @example
 * ```tsx
 * <WorkflowExecutionGraph
 *   executionId="wex_abc123"
 *   onTaskSelect={(name) => setInspectedTask(name)}
 * />
 * ```
 */
export const WorkflowExecutionGraph = memo(function WorkflowExecutionGraph(
  props: WorkflowExecutionGraphProps,
) {
  return (
    <ReactFlowProvider>
      <WorkflowExecutionGraphInner {...props} />
    </ReactFlowProvider>
  );
});

const TERMINAL_EXECUTION_PHASES = new Set([3, 4, 5, 6]);

function WorkflowExecutionGraphInner({
  executionId,
  onTaskSelect,
  followExecution = false,
  execution: externalExecution,
  taskStates: externalTaskStates,
  onAutoSelectTask,
  panelOffsetPx = 0,
  className,
}: WorkflowExecutionGraphProps) {
  const graphState = useWorkflowExecutionGraph({
    executionId,
    execution: externalExecution,
    taskStates: externalTaskStates,
    onAutoSelectTask,
  });
  const {
    nodes,
    edges,
    isLoading,
    error,
    selectedTaskName,
    setSelectedTaskName,
    versionMismatch,
    taskStates,
    executionPhase,
  } = graphState;

  const { fitView } = useReactFlow();
  const didFitRef = useRef(false);

  // Fit view on first render with nodes
  useEffect(() => {
    if (nodes.length > 0 && !didFitRef.current) {
      didFitRef.current = true;
      setTimeout(() => fitView({ padding: 0.15, duration: getAnimationDuration(300) }), 50);
    }
  }, [nodes.length, fitView]);

  // Derive active task name stably from taskStates (not from nodes array — DD-010)
  const activeTaskInfo = useActiveTaskName(taskStates);
  const isTerminal = executionPhase != null && TERMINAL_EXECUTION_PHASES.has(executionPhase);

  // Follow-execution state machine
  const {
    isFollowing,
    enableFollow,
    disableFollow,
    handleMoveStart,
  } = useFollowExecution({
    enabled: followExecution,
    activeTaskName: activeTaskInfo?.taskName ?? null,
    nodes,
    didInitialFit: didFitRef.current,
    isTerminal,
    panelOffsetPx,
  });

  // Screen reader announcements for task state changes
  const announcement = useExecutionAnnouncements(taskStates);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as CanvasTaskNodeData;
      if (data.isSentinel) return;
      const name = data.taskName;
      const next = name === selectedTaskName ? null : name;
      setSelectedTaskName(next);
      onTaskSelect?.(next);
    },
    [selectedTaskName, setSelectedTaskName, onTaskSelect],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedTaskName(null);
    onTaskSelect?.(null);
  }, [setSelectedTaskName, onTaskSelect]);

  const onMoveStart = useCallback(
    (event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      handleMoveStart(event, viewport);
    },
    [handleMoveStart],
  );

  // Mark selected node
  const nodesWithSelection = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: (n.data as CanvasTaskNodeData).taskName === selectedTaskName,
      })),
    [nodes, selectedTaskName],
  );

  if (isLoading) {
    return (
      <div className={cn("flex h-full items-center justify-center", className)}>
        <GraphLoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-2 px-6 text-center", className)}>
        <p className="text-sm text-[var(--stgm-muted-foreground,#737373)]">{error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center text-sm text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No graph available for this execution
      </div>
    );
  }

  return (
    <WorkflowGraphModeProvider mode="execution">
      <div className={cn("relative h-full w-full", className)}>
        {versionMismatch && (
          <div className="absolute left-3 right-3 top-3 z-50 rounded-md border border-[var(--stgm-warning,#f59e0b)]/30 bg-[var(--stgm-warning,#f59e0b)]/5 px-3 py-2 text-xs text-[var(--stgm-foreground,#1a1a2e)]">
            {versionMismatch}
          </div>
        )}

        {/* Active task indicator — visible at any zoom level */}
        {followExecution && activeTaskInfo && (
          <ExecutionActiveTaskIndicator
            activeTask={activeTaskInfo}
            isFollowing={isFollowing}
            onFollowToggle={isFollowing ? disableFollow : enableFollow}
            onJumpToTask={() => enableFollow()}
          />
        )}

        <ReactFlow
          nodes={nodesWithSelection}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onMoveStart={onMoveStart}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={true}
          elementsSelectable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          fitView={false}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          aria-label="Workflow execution graph. Use Tab to navigate between tasks."
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as CanvasTaskNodeData;
              const status = data.executionState?.status;
              if (status === "completed") return "var(--stgm-success, #22c55e)";
              if (status === "failed") return "var(--stgm-destructive, #ef4444)";
              if (status === "running") return "var(--stgm-primary, #6366f1)";
              return "var(--stgm-muted, #e5e5e5)";
            }}
            pannable
            zoomable
          />
        </ReactFlow>

        {/* Screen reader live region for execution state announcements */}
        <div
          role="log"
          aria-live="polite"
          aria-atomic="false"
          className="sr-only"
        >
          {announcement}
        </div>
      </div>
    </WorkflowGraphModeProvider>
  );
}

function GraphLoadingSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="h-3 w-24 animate-pulse rounded bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="mt-2 flex gap-4">
        <div className="h-10 w-32 animate-pulse rounded-md bg-[var(--stgm-muted,#e5e5e5)]" />
        <div className="h-10 w-32 animate-pulse rounded-md bg-[var(--stgm-muted,#e5e5e5)]" />
      </div>
    </div>
  );
}

export type { UseWorkflowExecutionGraphReturn, DerivedTaskState };
