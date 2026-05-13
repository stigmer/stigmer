"use client";

import { lazy, Suspense, memo, useCallback } from "react";
import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowCanvas } from "./useWorkflowCanvas";

/** Props for {@link WorkflowCanvasEditor}. */
export interface WorkflowCanvasEditorProps {
  /** The workflow YAML string to render on the canvas. */
  readonly yaml: string | null;
  /** Called when a task node is selected. */
  readonly onNodeSelect?: (nodeId: string) => void;
  /** Called when an edge is selected. */
  readonly onEdgeSelect?: (edgeId: string) => void;
  /** Called when selection is cleared. */
  readonly onSelectionClear?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** Fallback to show while the canvas loads (DD-013 lazy loading). */
  readonly loadingFallback?: ReactNode;
}

const LazyCanvasInner = lazy(() =>
  import("./WorkflowCanvasInner").then((m) => ({ default: m.WorkflowCanvasInner })),
);

/**
 * Visual workflow canvas editor using React Flow.
 *
 * Wrapped with `React.lazy` + `Suspense` per DD-013 so the `@xyflow/react`
 * bundle is only loaded when this component is mounted. Consumers who never
 * render the canvas pay zero bundle cost.
 *
 * @since T15 (Visual Canvas Editor)
 */
export const WorkflowCanvasEditor = memo(function WorkflowCanvasEditor({
  yaml,
  onNodeSelect,
  onEdgeSelect,
  onSelectionClear,
  className,
  loadingFallback,
}: WorkflowCanvasEditorProps) {
  const canvas = useWorkflowCanvas(yaml);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      canvas.selectNode(node.id);
      onNodeSelect?.(node.id);
    },
    [canvas.selectNode, onNodeSelect],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: { id: string }) => {
      canvas.selectEdge(edge.id);
      onEdgeSelect?.(edge.id);
    },
    [canvas.selectEdge, onEdgeSelect],
  );

  const handlePaneClick = useCallback(() => {
    canvas.clearSelection();
    onSelectionClear?.();
  }, [canvas.clearSelection, onSelectionClear]);

  const fallback = loadingFallback ?? (
    <div className="flex h-full w-full items-center justify-center text-sm text-[var(--stgm-muted-foreground,#737373)]">
      Loading canvas…
    </div>
  );

  if (canvas.error) {
    return (
      <div className={cn("flex h-full w-full flex-col items-center justify-center gap-2 p-4", className)}>
        <span className="text-sm font-medium text-[var(--stgm-destructive,#ef4444)]">
          Failed to parse workflow
        </span>
        <span className="max-w-md text-center text-xs text-[var(--stgm-muted-foreground,#737373)]">
          {canvas.error}
        </span>
      </div>
    );
  }

  if (!canvas.graph) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center text-sm text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No workflow to visualize
      </div>
    );
  }

  return (
    <div className={cn("stgm relative h-full w-full", className)}>
      <CanvasToolbar
        onAutoLayout={canvas.autoLayout}
        isDirty={canvas.isDirty}
      />
      <Suspense fallback={fallback}>
        <LazyCanvasInner
          nodes={canvas.nodes}
          edges={canvas.edges}
          onNodesChange={canvas.onNodesChange}
          onEdgesChange={canvas.onEdgesChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
        />
      </Suspense>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Canvas toolbar
// ---------------------------------------------------------------------------

function CanvasToolbar({
  onAutoLayout,
  isDirty,
}: {
  onAutoLayout: () => void;
  isDirty: boolean;
}) {
  return (
    <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
      <button
        type="button"
        onClick={onAutoLayout}
        className="rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1 text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)] shadow-sm hover:bg-[var(--stgm-muted,#f5f5f5)] active:bg-[var(--stgm-accent,#e5e5e5)]"
        aria-label="Auto-layout"
      >
        Auto-layout
      </button>
      {isDirty && (
        <span className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
          Layout modified
        </span>
      )}
    </div>
  );
}
