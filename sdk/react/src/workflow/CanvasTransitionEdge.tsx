"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import type { CanvasTransitionEdgeData } from "./workflow-graph-conversions";

/**
 * Custom React Flow edge rendering a directed transition between tasks.
 *
 * Uses smoothstep routing (90-degree bends) with an arrowhead marker.
 * Optionally renders a label pill for named branches (switch_case cases,
 * human_input outcomes).
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

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={cn(
          "!stroke-[var(--stgm-border,#d4d4d8)]",
          selected && "!stroke-[var(--stgm-ring,#3b82f6)]",
        )}
        style={{
          strokeWidth: selected ? 2 : 1.5,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="stgm pointer-events-auto absolute rounded-full border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-0.5 text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)] shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
