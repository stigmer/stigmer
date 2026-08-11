"use client";

import { memo, useCallback, useContext, useMemo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import type { CanvasTransitionEdgeData } from "./workflow-graph-conversions.js";
import type { EdgeExecutionState } from "./execution/index.js";
import type { EdgeDiffStatus } from "./diff/types.js";
import { CanvasActionsContext } from "./CanvasActionsContext.js";
import { TaskPickerPopover } from "./TaskPickerPopover.js";
import { useWorkflowGraphMode } from "./WorkflowGraphModeContext.js";

// ---------------------------------------------------------------------------
// Execution-state visual mapping (DD-T06-005)
// ---------------------------------------------------------------------------

interface EdgeVisualStyle {
  readonly strokeClass: string;
  readonly opacity: number;
  readonly dashArray?: string;
  readonly animate?: boolean;
  readonly labelDimmed: boolean;
}

const EDGE_EXECUTION_STYLES: Record<EdgeExecutionState, EdgeVisualStyle> = {
  taken: {
    strokeClass: "stg:!stroke-[var(--stgm-success,#22c55e)]",
    opacity: 1,
    labelDimmed: false,
  },
  not_taken: {
    strokeClass: "stg:!stroke-[var(--stgm-muted-foreground,#737373)]",
    opacity: 0.3,
    dashArray: "5 5",
    labelDimmed: true,
  },
  active: {
    strokeClass: "stg:!stroke-[var(--stgm-primary,#6366f1)]",
    opacity: 1,
    dashArray: "8 4",
    animate: true,
    labelDimmed: false,
  },
  not_reached: {
    strokeClass: "stg:!stroke-[var(--stgm-muted-foreground,#737373)]",
    opacity: 0.25,
    labelDimmed: true,
  },
};

const EDGE_DIFF_STYLES: Record<EdgeDiffStatus, EdgeVisualStyle> = {
  added: {
    strokeClass: "stg:!stroke-[var(--stgm-success,#22c55e)]",
    opacity: 1,
    labelDimmed: false,
  },
  removed: {
    strokeClass: "stg:!stroke-[var(--stgm-destructive,#ef4444)]",
    opacity: 0.3,
    dashArray: "5 5",
    labelDimmed: true,
  },
  unchanged: {
    strokeClass: "stg:!stroke-[var(--stgm-muted-foreground,#737373)]",
    opacity: 0.6,
    labelDimmed: false,
  },
};

/**
 * Custom React Flow edge rendering a directed transition between tasks.
 *
 * Uses smoothstep routing (90-degree bends) with an arrowhead marker.
 * Optionally renders a label pill for named branches (switch_case cases,
 * human_input outcomes).
 *
 * In execution mode, applies per-edge visual treatment based on
 * `data.executionState` (T06): taken/not_taken/active/not_reached.
 *
 * Shows a "+" button at the midpoint on hover in design mode. Clicking
 * the button inserts a new task node between the source and target.
 *
 * @since T15 (Visual Canvas Editor), T06 (Branch Highlighting)
 */
export const CanvasTransitionEdge = memo(function CanvasTransitionEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps & { data?: CanvasTransitionEdgeData }) {
  const mode = useWorkflowGraphMode();
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const label = data?.label;
  const execState = data?.executionState;
  const diffState = (data as CanvasTransitionEdgeData & { diffState?: EdgeDiffStatus })?.diffState;
  const actions = useContext(CanvasActionsContext);
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const insertBtnRef = useRef<HTMLButtonElement>(null);
  const isDesignMode = mode === "design";
  const isExecutionMode = mode === "execution";
  const isDiffMode = mode === "diff";

  const handleOpenPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const handlePickerOpenChange = useCallback((nextOpen: boolean) => {
    setPickerOpen(nextOpen);
  }, []);

  const handleKindSelected = useCallback(
    (kindString: string) => {
      actions?.insertTaskOnEdge(id, kindString);
    },
    [actions, id],
  );

  const insertionContext = useMemo(() => {
    const graph = actions?.getGraphModel();
    if (!graph) return null;
    const sourceNode = graph.nodes.find((n) => n.id === source);
    const targetNode = graph.nodes.find((n) => n.id === target);
    return {
      mode: "edge-splice" as const,
      edgeId: id,
      sourceNodeId: source,
      sourceDisplayName: sourceNode?.taskName ?? source,
      targetNodeId: target,
      targetDisplayName: targetNode?.taskName ?? target,
    };
  }, [actions, id, source, target]);

  // Resolve visual style: diff mode → diff styles, execution mode → execution styles, else defaults.
  const execVisual = isDiffMode && diffState
    ? EDGE_DIFF_STYLES[diffState]
    : isExecutionMode && execState
      ? EDGE_EXECUTION_STYLES[execState]
      : null;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={cn(
          execVisual
            ? execVisual.strokeClass
            : "stg:!stroke-[var(--stgm-border-prominent,#a3a3a3)]",
          selected && "stg:!stroke-[var(--stgm-ring,#3b82f6)]",
          !isDesignMode && !execVisual && "stg:!opacity-60",
          execVisual?.animate && "stgm-edge-active",
        )}
        style={{
          strokeWidth: selected ? 2.5 : 2,
          ...(execVisual && { opacity: execVisual.opacity }),
          ...(execVisual?.dashArray && { strokeDasharray: execVisual.dashArray }),
        }}
        data-edge-execution-state={execState}
      />
      <EdgeLabelRenderer>
        <div
          className="stg:pointer-events-auto stg:absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={isDesignMode ? () => setHovered(true) : undefined}
          onMouseLeave={isDesignMode ? () => setHovered(false) : undefined}
        >
          {label && (
            <div
              className={cn(
                "stgm stg:mb-1 stg:rounded-full stg:border stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:px-2 stg:py-0.5 stg:text-center stg:text-[10px] stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)] stg:shadow-sm",
                execVisual?.labelDimmed && "stg:opacity-30",
              )}
              aria-label={
                execState
                  ? `Branch ${label}, ${execState.replace(/_/g, " ")}`
                  : `Branch ${label}`
              }
            >
              {label}
            </div>
          )}

          {/* Insert button and picker — design mode only */}
          {isDesignMode && (
            <>
              <button
                ref={insertBtnRef}
                type="button"
                onClick={handleOpenPicker}
                className={cn(
                  "stg:flex stg:h-5 stg:w-5 stg:items-center stg:justify-center stg:rounded-full stg:border stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:text-[var(--stgm-muted-foreground,#737373)] stg:shadow-sm stg:transition-all",
                  "stg:hover:border-[var(--stgm-primary,#6366f1)] stg:hover:bg-[var(--stgm-primary,#6366f1)] stg:hover:text-[var(--stgm-primary-foreground,#fff)]",
                  hovered || selected || pickerOpen ? "stg:scale-100 stg:opacity-100" : "stg:scale-75 stg:opacity-0",
                )}
                aria-label="Insert task here"
                title="Insert task"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 2v6M2 5h6" />
                </svg>
              </button>

              <TaskPickerPopover
                open={pickerOpen}
                onOpenChange={handlePickerOpenChange}
                onSelectKind={handleKindSelected}
                anchorRef={insertBtnRef}
                insertionContext={insertionContext}
                graph={actions?.getGraphModel() ?? null}
                side="bottom"
              />
            </>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
