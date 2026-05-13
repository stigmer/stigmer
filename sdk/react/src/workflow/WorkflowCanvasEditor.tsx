"use client";

import { lazy, Suspense, memo, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowCanvas } from "./useWorkflowCanvas";
import { WorkflowTaskPalette } from "./WorkflowTaskPalette";
import { WorkflowInspectorPanel } from "./WorkflowInspectorPanel";
import { DeleteEdgeCommand } from "./graph-commands";

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
  /** Whether to show the task palette sidebar. Defaults to true. */
  readonly showPalette?: boolean;
  /** Whether to show the inspector panel. Defaults to true. */
  readonly showInspector?: boolean;
  /** Called when the save button is clicked. Receives the serialized YAML. */
  readonly onSave?: (yaml: string) => void;
  /** Whether a save is currently in progress. */
  readonly isSaving?: boolean;
  /** Map of nodeId -> error messages for validation badge rendering. */
  readonly nodeErrors?: ReadonlyMap<string, readonly string[]>;
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
 * Renders a task palette (left), interactive canvas (center), and toolbar
 * with undo/redo and auto-layout controls. Wrapped with `React.lazy` +
 * `Suspense` per DD-013 so the `@xyflow/react` bundle is only loaded
 * when this component is mounted.
 *
 * @since T15 (Visual Canvas Editor)
 */
export const WorkflowCanvasEditor = memo(function WorkflowCanvasEditor({
  yaml,
  onNodeSelect,
  onEdgeSelect,
  onSelectionClear,
  showPalette = true,
  showInspector = true,
  onSave,
  isSaving = false,
  nodeErrors,
  className,
  loadingFallback,
}: WorkflowCanvasEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvas = useWorkflowCanvas(yaml, containerRef);

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

  const handleSave = useCallback(() => {
    if (!onSave) return;
    const yamlStr = canvas.serializeToYaml();
    if (yamlStr) onSave(yamlStr);
  }, [onSave, canvas.serializeToYaml]);

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      canvas.onEdgesDelete([{ id: edgeId } as import("@xyflow/react").Edge]);
    },
    [canvas.onEdgesDelete],
  );

  const descriptor = canvas.selection?.type === "node"
    ? canvas.getNodeDescriptor(canvas.selection.id)
    : undefined;

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
      <div className={cn("flex h-full w-full items-center justify-center", className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-sm text-[var(--stgm-muted-foreground,#737373)]">
            No workflow to visualize
          </span>
          <span className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
            Drag a task from the palette to get started
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("stgm relative flex h-full w-full", className)}
      tabIndex={-1}
    >
      {showPalette && <WorkflowTaskPalette />}

      <div className="relative flex-1">
        <CanvasToolbar
          onAutoLayout={canvas.autoLayout}
          onUndo={canvas.undo}
          onRedo={canvas.redo}
          canUndo={canvas.canUndo}
          canRedo={canvas.canRedo}
          isDirty={canvas.isDirty}
          onSave={onSave ? handleSave : undefined}
          isSaving={isSaving}
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
            onConnect={canvas.onConnect}
            isValidConnection={canvas.isValidConnection}
            onDrop={canvas.onDrop}
            onDragOver={canvas.onDragOver}
            onNodesDelete={canvas.onNodesDelete}
            onEdgesDelete={canvas.onEdgesDelete}
          />
        </Suspense>
      </div>

      {showInspector && (
        <div className="w-[280px] min-w-[240px] overflow-hidden border-l border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-background,#fff)]">
          <WorkflowInspectorPanel
            selection={canvas.selection}
            graph={canvas.graph}
            descriptor={descriptor}
            onUpdateField={canvas.updateNodeField}
            onRenameNode={canvas.renameNode}
            onUpdateExport={canvas.updateNodeExport}
            onUpdateFlow={canvas.updateNodeFlow}
            onDeleteEdge={handleDeleteEdge}
            onUpdateBranchRouting={canvas.updateBranchRouting}
            onMigrateBranchHandle={canvas.migrateBranchHandle}
            onRemoveBranchEdges={canvas.removeBranchEdges}
          />
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Canvas toolbar
// ---------------------------------------------------------------------------

function CanvasToolbar({
  onAutoLayout,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isDirty,
  onSave,
  isSaving = false,
}: {
  onAutoLayout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  onSave?: () => void;
  isSaving?: boolean;
}) {
  const btnClass =
    "rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1 text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)] shadow-sm hover:bg-[var(--stgm-muted,#f5f5f5)] active:bg-[var(--stgm-accent,#e5e5e5)] disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
      <button type="button" onClick={onUndo} disabled={!canUndo} className={btnClass} aria-label="Undo" title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} className={btnClass} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        Redo
      </button>
      <div className="mx-1 h-4 w-px bg-[var(--stgm-border,#d4d4d8)]" aria-hidden="true" />
      <button type="button" onClick={onAutoLayout} className={btnClass} aria-label="Auto-layout">
        Auto-layout
      </button>
      {onSave && (
        <>
          <div className="mx-1 h-4 w-px bg-[var(--stgm-border,#d4d4d8)]" aria-hidden="true" />
          <button
            type="button"
            onClick={onSave}
            disabled={!isDirty || isSaving}
            className="rounded bg-[var(--stgm-primary,#6366f1)] px-2.5 py-1 text-xs font-medium text-[var(--stgm-primary-foreground,#fff)] shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? "Saving\u2026" : "Save"}
          </button>
        </>
      )}
      {isDirty && !onSave && (
        <span className="ml-1 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          Modified
        </span>
      )}
    </div>
  );
}
