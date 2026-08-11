"use client";

import { cn } from "@stigmer/theme";
import type { WorkflowGraphEdge, WorkflowGraphModel } from "../workflow-graph-model.js";

/** Props for {@link EdgeInspector}. */
export interface EdgeInspectorProps {
  readonly edge: WorkflowGraphEdge;
  readonly graph: WorkflowGraphModel;
  readonly onDeleteEdge?: (edgeId: string) => void;
  readonly className?: string;
}

/**
 * Inspector for a selected edge (connection between two tasks).
 *
 * Shows source/target, label, port, and a delete action.
 *
 * @since T10 (Inspector Panel Refactor) — extracted from WorkflowInspectorPanel
 */
export function EdgeInspector({
  edge,
  graph,
  onDeleteEdge,
  className,
}: EdgeInspectorProps) {
  const sourceNode = graph.nodes.find((n) => n.id === edge.source);
  const targetNode = graph.nodes.find((n) => n.id === edge.target);

  return (
    <div className={cn("stg:flex stg:h-full stg:flex-col stg:gap-4 stg:p-3", className)}>
      <h3 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
        Connection
      </h3>

      <div className="stg:flex stg:flex-col stg:gap-2">
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-xs">
          <span className="stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
            {sourceNode?.taskName ?? edge.source}
          </span>
          <span className="stg:text-[var(--stgm-muted-foreground,#737373)]">→</span>
          <span className="stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
            {targetNode?.taskName ?? edge.target}
          </span>
        </div>

        {edge.label && (
          <div className="stg:flex stg:items-center stg:gap-1.5">
            <span className="stg:text-[11px] stg:text-[var(--stgm-muted-foreground,#737373)]">Label:</span>
            <span className="stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">{edge.label}</span>
          </div>
        )}

        {edge.sourceHandle && (
          <div className="stg:flex stg:items-center stg:gap-1.5">
            <span className="stg:text-[11px] stg:text-[var(--stgm-muted-foreground,#737373)]">Port:</span>
            <span className="stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">{edge.sourceHandle}</span>
          </div>
        )}
      </div>

      {onDeleteEdge && (
        <button
          type="button"
          onClick={() => onDeleteEdge(edge.id)}
          className="stg:self-start stg:rounded stg:px-2 stg:py-1 stg:text-xs stg:text-[var(--stgm-destructive,#ef4444)] stg:hover:bg-[var(--stgm-destructive,#ef4444)]/10"
        >
          Delete connection
        </button>
      )}
    </div>
  );
}
