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
import type { NodeChange, Viewport } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import { WorkflowNode } from "./WorkflowNode.js";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge.js";
import { CANVAS_TASK_NODE_TYPE, CANVAS_TRANSITION_EDGE_TYPE } from "./workflow-graph-conversions.js";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";
import { WorkflowGraphModeProvider } from "./WorkflowGraphModeContext.js";
import { useWorkflowExecutionGraph } from "./useWorkflowExecutionGraph.js";
import type { UseWorkflowExecutionGraphReturn } from "./useWorkflowExecutionGraph.js";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store.js";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { useFollowExecution } from "./useFollowExecution.js";
import { useActiveTaskName } from "./useActiveTaskName.js";
import { ExecutionActiveTaskIndicator } from "./ExecutionActiveTaskIndicator.js";
import { useExecutionAnnouncements } from "./useExecutionAnnouncements.js";
import { getAnimationDuration } from "../internal/motion-preference.js";

/** Props for {@link WorkflowExecutionGraph}. */
export interface WorkflowExecutionGraphProps {
  /** ID of the workflow execution to visualize. */
  readonly executionId: string;
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
  /**
   * Whether the graph renders its own `aria-live` region announcing task
   * state changes. Keep the default for standalone embedding. Set `false`
   * when a parent owns a shared announcer for multiple views of the same
   * task states — a live region inside a CSS-hidden (`display:none`) graph
   * is removed from the accessibility tree and would go silent, and two
   * mounted announcers would double-announce.
   * @default true
   */
  readonly announceTaskStates?: boolean;
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
 * Read-only execution graph canvas for workflow executions — a PASSIVE
 * topology visualization (T06): status colors, live overlays, pan/zoom,
 * and follow-the-run camera, with no node selection or click actions. A
 * task's detail lives on its thread card, the single home for task data.
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
 * <WorkflowExecutionGraph executionId="wex_abc123" />
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
  followExecution = false,
  execution: externalExecution,
  taskStates: externalTaskStates,
  panelOffsetPx = 0,
  announceTaskStates = true,
  nodesDraggable: draggable = false,
  className,
}: WorkflowExecutionGraphProps) {
  const graphState = useWorkflowExecutionGraph({
    executionId,
    execution: externalExecution,
    taskStates: externalTaskStates,
    nodesDraggable: draggable,
  });
  const {
    nodes,
    edges,
    isLoading,
    error,
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

  // Screen reader announcements for task state changes (standalone
  // embedding). The viewer sets `announceTaskStates={false}` and owns a
  // shared announcer instead — see the prop docs.
  const announcement = useExecutionAnnouncements(taskStates);

  const onMoveStart = useCallback(
    (event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      handleMoveStart(event, viewport);
    },
    [handleMoveStart],
  );

  // Apply ephemeral drag position overrides
  const nodesWithPositions = useMemo(
    () =>
      nodes.map((n) => {
        const pos = dragPositions[n.id];
        return pos ? { ...n, position: pos } : n;
      }),
    [nodes, dragPositions],
  );

  if (isLoading) {
    return (
      <div className={cn("stg:flex stg:h-full stg:items-center stg:justify-center", className)}>
        <GraphLoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("stg:flex stg:h-full stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:px-6 stg:text-center", className)}>
        <p className="stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]">{error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className={cn("stg:flex stg:h-full stg:items-center stg:justify-center stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No graph available for this execution
      </div>
    );
  }

  return (
    <WorkflowGraphModeProvider mode="execution">
      <div className={cn("stg:relative stg:h-full stg:w-full", className)}>
        {versionMismatch && (
          <div className="stg:absolute stg:left-3 stg:right-3 stg:top-3 stg:z-50 stg:rounded-md stg:border stg:border-[var(--stgm-warning,#f59e0b)]/30 stg:bg-[var(--stgm-warning,#f59e0b)]/5 stg:px-3 stg:py-2 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">
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
              "stg:absolute stg:left-3 stg:z-50 stg:rounded-full stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-background,#fff)] stg:px-3 stg:py-1 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:shadow-sm stg:transition-colors stg:hover:bg-[var(--stgm-muted,#f5f5f5)]",
              versionMismatch ? "stg:top-12" : "stg:top-3",
            )}
          >
            Reset layout
          </button>
        )}

        <ReactFlow
          nodes={nodesWithPositions}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onInit={handleInit}
          onMoveStart={onMoveStart}
          onNodesChange={draggable ? handleNodesChange : undefined}
          nodesDraggable={draggable}
          nodesConnectable={false}
          nodesFocusable={false}
          elementsSelectable={false}
          panOnDrag={true}
          zoomOnScroll={true}
          fitView={false}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          aria-label="Workflow execution graph"
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
        {announceTaskStates && (
          <div
            role="log"
            aria-live="polite"
            aria-atomic="false"
            className="stg:sr-only"
          >
            {announcement}
          </div>
        )}
      </div>
    </WorkflowGraphModeProvider>
  );
}

function GraphLoadingSkeleton() {
  return (
    <div className="stg:flex stg:flex-col stg:items-center stg:gap-3">
      <div className="stg:h-8 stg:w-8 stg:animate-pulse stg:rounded-full stg:bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="stg:h-3 stg:w-24 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="stg:mt-2 stg:flex stg:gap-4">
        <div className="stg:h-10 stg:w-32 stg:animate-pulse stg:rounded-md stg:bg-[var(--stgm-muted,#e5e5e5)]" />
        <div className="stg:h-10 stg:w-32 stg:animate-pulse stg:rounded-md stg:bg-[var(--stgm-muted,#e5e5e5)]" />
      </div>
    </div>
  );
}

export type { UseWorkflowExecutionGraphReturn, DerivedTaskState };
