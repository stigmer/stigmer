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
    <div className={cn("flex h-full flex-col gap-4 p-3", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
        Connection
      </h3>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-[var(--stgm-foreground,#1a1a2e)]">
            {sourceNode?.taskName ?? edge.source}
          </span>
          <span className="text-[var(--stgm-muted-foreground,#737373)]">→</span>
          <span className="font-medium text-[var(--stgm-foreground,#1a1a2e)]">
            {targetNode?.taskName ?? edge.target}
          </span>
        </div>

        {edge.label && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--stgm-muted-foreground,#737373)]">Label:</span>
            <span className="text-xs text-[var(--stgm-foreground,#1a1a2e)]">{edge.label}</span>
          </div>
        )}

        {edge.sourceHandle && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--stgm-muted-foreground,#737373)]">Port:</span>
            <span className="text-xs text-[var(--stgm-foreground,#1a1a2e)]">{edge.sourceHandle}</span>
          </div>
        )}
      </div>

      {onDeleteEdge && (
        <button
          type="button"
          onClick={() => onDeleteEdge(edge.id)}
          className="self-start rounded px-2 py-1 text-xs text-[var(--stgm-destructive,#ef4444)] hover:bg-[var(--stgm-destructive,#ef4444)]/10"
        >
          Delete connection
        </button>
      )}
    </div>
  );
}
