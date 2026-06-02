"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Node, NodeChange, Viewport } from "@xyflow/react";
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
import { useFollowExecution, computeFollowSelection } from "./useFollowExecution";
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
   * Pixel width of a panel that **overlays** (absolutely positioned over)
   * the graph viewport, occluding the right side. The follow-execution
   * camera offsets its center to keep the active node visually centered
   * in the unoccluded area. Defaults to 0.
   *
   * When the panel is a **flex sibling** (e.g., inside `ResizableSplit`),
   * the ReactFlow container already has the correct reduced width and
   * `setCenter`/`fitView` operate within those bounds — set this to 0
   * (the default) to avoid double-compensating the viewport offset.
   */
  readonly panelOffsetPx?: number;
  /**
   * Whether task nodes can be dragged to rearrange the layout.
   * Useful for presentations and demos where the auto-layout is too
   * dense. Drag positions are ephemeral (in-memory only) and reset
   * when the underlying graph structure changes.
   * @default false
   */
  readonly nodesDraggable?: boolean;
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
  nodesDraggable: draggable = false,
  className,
}: WorkflowExecutionGraphProps) {
  const graphState = useWorkflowExecutionGraph({
    executionId,
    execution: externalExecution,
    taskStates: externalTaskStates,
    onAutoSelectTask,
    nodesDraggable: draggable,
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
  const [didInitialFit, setDidInitialFit] = useState(false);
  const isInitializedRef = useRef(false);
  const didFitGuardRef = useRef(false);

  // ── Ephemeral drag positions ───────────────────────────────────────
  // Resets when the execution changes (navigating to a different run).
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    setDragPositions({});
  }, [executionId]);

  const hasDragOverrides = draggable && Object.keys(dragPositions).length > 0;

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!draggable) return;
      const posChanges = changes.filter(
        (c): c is NodeChange & { type: "position"; position: { x: number; y: number } } =>
          c.type === "position" && "position" in c && c.position != null,
      );
      if (posChanges.length === 0) return;
      setDragPositions((prev) => {
        const next = { ...prev };
        for (const c of posChanges) {
          next[c.id] = c.position;
        }
        return next;
      });
    },
    [draggable],
  );

  const handleResetLayout = useCallback(() => {
    setDragPositions({});
  }, []);

  const performInitialFit = useCallback(() => {
    if (didFitGuardRef.current) return;
    didFitGuardRef.current = true;
    fitView({ padding: 0.15, duration: getAnimationDuration(300) });
    setDidInitialFit(true);
  }, [fitView]);

  // onInit fires when ReactFlow's container is measured and the
  // viewport is ready — replacing the fragile 50ms setTimeout.
  const handleInit = useCallback(() => {
    isInitializedRef.current = true;
    if (nodes.length > 0) {
      performInitialFit();
    }
  }, [nodes.length, performInitialFit]);

  // When nodes arrive after onInit (async data), fit once they're ready.
  useEffect(() => {
    if (isInitializedRef.current && nodes.length > 0) {
      performInitialFit();
    }
  }, [nodes.length, performInitialFit]);

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
    didInitialFit,
    isTerminal,
    panelOffsetPx,
  });

  // ── Follow-selection: auto-select the active task while following ──
  // Couples node selection to the follow state machine so "Follow" means
  // viewport centering + node highlighting + inspector display.
  useEffect(() => {
    const taskToSelect = computeFollowSelection({
      isFollowing,
      activeTaskName: activeTaskInfo?.taskName ?? null,
      currentSelectedTask: selectedTaskName,
    });
    if (!taskToSelect) return;
    setSelectedTaskName(taskToSelect);
    onTaskSelect?.(taskToSelect);
  }, [isFollowing, activeTaskInfo?.taskName, selectedTaskName, setSelectedTaskName, onTaskSelect]);

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
      if (isFollowing) disableFollow();
    },
    [selectedTaskName, setSelectedTaskName, onTaskSelect, isFollowing, disableFollow],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedTaskName(null);
    onTaskSelect?.(null);
    if (isFollowing) disableFollow();
  }, [setSelectedTaskName, onTaskSelect, isFollowing, disableFollow]);

  const onMoveStart = useCallback(
    (event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      handleMoveStart(event, viewport);
    },
    [handleMoveStart],
  );

  // Mark selected node + apply drag position overrides
  const nodesWithSelection = useMemo(
    () =>
      nodes.map((n) => {
        const selected = (n.data as CanvasTaskNodeData).taskName === selectedTaskName;
        const pos = dragPositions[n.id];
        return pos
          ? { ...n, selected, position: pos }
          : selected !== n.selected
            ? { ...n, selected }
            : n;
      }),
    [nodes, selectedTaskName, dragPositions],
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

        {/* Reset layout pill — shown when nodes have been manually repositioned */}
        {hasDragOverrides && (
          <button
            type="button"
            onClick={handleResetLayout}
            className={cn(
              "absolute left-3 z-50 rounded-full border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-background,#fff)] px-3 py-1 text-xs text-[var(--stgm-foreground,#1a1a2e)] shadow-sm transition-colors hover:bg-[var(--stgm-muted,#f5f5f5)]",
              versionMismatch ? "top-12" : "top-3",
            )}
          >
            Reset layout
          </button>
        )}

        <ReactFlow
          nodes={nodesWithSelection}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onInit={handleInit}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onMoveStart={onMoveStart}
          onNodesChange={draggable ? handleNodesChange : undefined}
          nodesDraggable={draggable}
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
