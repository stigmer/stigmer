"use client";

import { memo, useCallback, useContext, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import type { CanvasTransitionEdgeData } from "./workflow-graph-conversions";
import { CanvasActionsContext } from "./CanvasActionsContext";

/**
 * Custom React Flow edge rendering a directed transition between tasks.
 *
 * Uses smoothstep routing (90-degree bends) with an arrowhead marker.
 * Optionally renders a label pill for named branches (switch_case cases,
 * human_input outcomes).
 *
 * Shows a "+" button at the midpoint on hover. Clicking the button inserts
 * a new task node between the source and target, splitting this edge.
 *
 * @since T15 (Visual Canvas Editor)
 */
export const CanvasTransitionEdge = memo(function CanvasTransitionEdge({
  id,
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
  const actions = useContext(CanvasActionsContext);
  const [hovered, setHovered] = useState(false);

  const handleInsert = useCallback(() => {
    actions?.insertTaskOnEdge(id, "agent_call");
  }, [actions, id]);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={cn(
          "!stroke-[var(--stgm-border-prominent,#a3a3a3)]",
          selected && "!stroke-[var(--stgm-ring,#3b82f6)]",
        )}
        style={{
          strokeWidth: selected ? 2.5 : 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {label && (
            <div className="stgm mb-1 rounded-full border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] px-2 py-0.5 text-center text-[10px] font-medium text-[var(--stgm-foreground,#1a1a2e)] shadow-sm">
              {label}
            </div>
          )}
          <button
            type="button"
            onClick={handleInsert}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] text-[var(--stgm-muted-foreground,#737373)] shadow-sm transition-all",
              "hover:border-[var(--stgm-primary,#6366f1)] hover:bg-[var(--stgm-primary,#6366f1)] hover:text-[var(--stgm-primary-foreground,#fff)]",
              hovered || selected ? "scale-100 opacity-100" : "scale-75 opacity-0",
            )}
            aria-label="Insert task here"
            title="Insert task"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M5 2v6M2 5h6" />
            </svg>
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
