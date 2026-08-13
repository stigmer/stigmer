"use client";

import { lazy, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { ReactFlowProvider } from "@xyflow/react";
import { useWorkflowCanvas } from "./useWorkflowCanvas.js";
import type { LayoutEngine } from "./layout/index.js";
import { WorkflowTaskPalette } from "./WorkflowTaskPalette.js";
import { WorkflowInspectorPanel } from "./WorkflowInspectorPanel.js";
import { WorkflowSummaryPanel } from "./inspector/WorkflowSummaryPanel.js";
import { CanvasActionsContext } from "./CanvasActionsContext.js";
import type { CanvasActions } from "./CanvasActionsContext.js";
import { CanvasContextMenu } from "./CanvasContextMenu.js";
import type { CanvasContextMenuTarget } from "./CanvasContextMenu.js";
import { TaskPickerPopover } from "./TaskPickerPopover.js";
import { useCanvasKeyboardShortcuts } from "./useCanvasKeyboardShortcuts.js";
import { ViewYamlDialog } from "./ViewYamlDialog.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../internal/tooltip.js";

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
  /** Called when the canvas dirty state changes. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Map of nodeId -> error messages for validation badge rendering. */
  readonly nodeErrors?: ReadonlyMap<string, readonly string[]>;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** Fallback to show while the canvas loads (DD-013 lazy loading). */
  readonly loadingFallback?: ReactNode;
  /**
   * Layout engine for the "Auto Layout" action.
   * Pass the result of {@link useElkLayoutEngine} for ELK-powered layout.
   * When omitted, dagre is used as the default.
   */
  readonly layoutEngine?: LayoutEngine | null;
}

const LazyCanvasInner = lazy(() =>
  import("./WorkflowCanvasInner.js").then((m) => ({ default: m.WorkflowCanvasInner })),
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
const WorkflowCanvasEditorInner = memo(function WorkflowCanvasEditorInner({
  yaml,
  onNodeSelect,
  onEdgeSelect,
  onSelectionClear,
  showPalette = true,
  showInspector = true,
  onSave,
  isSaving = false,
  onDirtyChange,
  nodeErrors,
  className,
  loadingFallback,
  layoutEngine,
}: WorkflowCanvasEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvas = useWorkflowCanvas(yaml, { layoutEngine: layoutEngine ?? undefined });
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const togglePalette = useCallback(() => setPaletteCollapsed((p) => !p), []);

  // ---------------------------------------------------------------------------
  // Context menu state (AD-T05)
  // ---------------------------------------------------------------------------

  const [contextMenu, setContextMenu] = useState<{
    target: CanvasContextMenuTarget;
    position: { x: number; y: number };
  } | null>(null);

  const [pendingPicker, setPendingPicker] = useState<{
    purpose: "add-after-node" | "insert-on-edge" | "add-at-position";
    sourceId?: string;
    position: { x: number; y: number };
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (T07)
  // ---------------------------------------------------------------------------

  const handleKeyboardDismiss = useCallback(() => {
    setContextMenu(null);
    setPendingPicker(null);
  }, []);

  const handleRequestTaskPicker = useCallback(
    (position: { x: number; y: number }, sourceNodeId?: string) => {
      if (sourceNodeId) {
        // "N" pressed with a node selected — find the node's screen position
        // and anchor the picker below it. The node's position in the React Flow
        // coordinate space is stored in the graph model; we approximate the
        // screen position from the node element if available, otherwise fall
        // back to the container center.
        const nodeEl = containerRef.current?.querySelector(
          `[data-id="${CSS.escape(sourceNodeId)}"]`,
        );
        if (nodeEl) {
          const rect = nodeEl.getBoundingClientRect();
          setPendingPicker({
            purpose: "add-after-node",
            sourceId: sourceNodeId,
            position: { x: rect.left + rect.width / 2, y: rect.bottom + 8 },
          });
        } else {
          setPendingPicker({
            purpose: "add-after-node",
            sourceId: sourceNodeId,
            position,
          });
        }
      } else {
        setPendingPicker({
          purpose: "add-at-position",
          position,
        });
      }
    },
    [],
  );

  useCanvasKeyboardShortcuts({
    containerRef,
    selection: canvas.selection,
    duplicateNode: canvas.duplicateNode,
    selectAll: canvas.selectAll,
    clearSelection: canvas.clearSelection,
    onRequestTaskPicker: handleRequestTaskPicker,
    onDismiss: handleKeyboardDismiss,
    copySelection: canvas.copySelection,
    pasteAtCenter: canvas.pasteAtCenter,
    cutSelection: canvas.cutSelection,
    undo: canvas.undo,
    redo: canvas.redo,
  });

  // All canvas shortcuts are gated on focus being inside the container,
  // but React Flow's pane prevents default on mousedown, so pane clicks
  // never move focus into it on their own — without this, Cmd+Z (etc.)
  // after a pane interaction silently does nothing (oss#588). Focusing
  // unconditionally also commits-and-blurs an inspector field when the
  // user clicks back into the canvas. Scoped to the canvas column so
  // palette and inspector clicks keep their native focus flow; when the
  // press lands on a real focusable (node, toolbar button, picker
  // input), the default mousedown focus takes over right after.
  const handleCanvasPointerDownCapture = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  // Deleting the focused node drops DOM focus to <body> when React Flow
  // unmounts the element, disarming every canvas shortcut at exactly the
  // moment the user reaches for Cmd+Z (oss#588). Return focus to the
  // container after any node deletion so undo stays reachable.
  const handleNodesDelete = useCallback(
    (deleted: Parameters<typeof canvas.onNodesDelete>[0]) => {
      canvas.onNodesDelete(deleted);
      containerRef.current?.focus({ preventScroll: true });
    },
    [canvas.onNodesDelete],
  );

  useEffect(() => {
    onDirtyChange?.(canvas.isDirty);
  }, [canvas.isDirty, onDirtyChange]);

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
    setContextMenu(null);
  }, [canvas.clearSelection, onSelectionClear]);

  // ---------------------------------------------------------------------------
  // Context menu event handlers (AD-T05)
  // ---------------------------------------------------------------------------

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => {
      event.preventDefault();
      const taskName = (node.data?.taskName as string) ?? node.id;
      setContextMenu({
        target: { type: "node", id: node.id, taskName },
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      event.preventDefault();
      setContextMenu({
        target: { type: "edge", id: edge.id },
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      setContextMenu({
        target: { type: "pane" },
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const handleContextMenuOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setContextMenu(null);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Context menu action handlers (AD-T05)
  // ---------------------------------------------------------------------------

  const handleContextMenuDeleteNode = useCallback(
    (nodeId: string) => {
      handleNodesDelete([{ id: nodeId } as import("@xyflow/react").Node]);
      setContextMenu(null);
    },
    [handleNodesDelete],
  );

  const handleContextMenuDuplicateNode = useCallback(
    (nodeId: string) => {
      canvas.duplicateNode(nodeId);
      setContextMenu(null);
    },
    [canvas.duplicateNode],
  );

  const handleContextMenuAddTaskAfter = useCallback(
    (nodeId: string) => {
      const pos = contextMenu?.position;
      setContextMenu(null);
      if (pos) {
        setPendingPicker({ purpose: "add-after-node", sourceId: nodeId, position: pos });
      }
    },
    [contextMenu?.position],
  );

  const handleContextMenuDeleteEdge = useCallback(
    (edgeId: string) => {
      canvas.onEdgesDelete([{ id: edgeId } as import("@xyflow/react").Edge]);
      setContextMenu(null);
    },
    [canvas.onEdgesDelete],
  );

  const handleContextMenuInsertTaskOnEdge = useCallback(
    (edgeId: string) => {
      const pos = contextMenu?.position;
      setContextMenu(null);
      if (pos) {
        setPendingPicker({ purpose: "insert-on-edge", sourceId: edgeId, position: pos });
      }
    },
    [contextMenu?.position],
  );

  const handleContextMenuAddTaskAtPosition = useCallback(() => {
    const pos = contextMenu?.position;
    setContextMenu(null);
    if (pos) {
      setPendingPicker({ purpose: "add-at-position", position: pos });
    }
  }, [contextMenu?.position]);

  const handleContextMenuSelectAll = useCallback(() => {
    canvas.selectAll();
    setContextMenu(null);
  }, [canvas.selectAll]);

  const handleContextMenuAutoLayout = useCallback(() => {
    canvas.autoLayout();
    setContextMenu(null);
  }, [canvas.autoLayout]);

  const handleContextMenuToggleDisabled = useCallback(
    (nodeId: string) => {
      canvas.toggleNodeDisabled(nodeId);
      setContextMenu(null);
    },
    [canvas.toggleNodeDisabled],
  );

  const handleContextMenuWrapInTryCatch = useCallback(
    (nodeId: string) => {
      canvas.wrapInTryCatch(nodeId);
      setContextMenu(null);
    },
    [canvas.wrapInTryCatch],
  );

  const handleContextMenuCopyNode = useCallback(
    (nodeId: string) => {
      canvas.selectNode(nodeId);
      canvas.copySelection();
      setContextMenu(null);
    },
    [canvas.selectNode, canvas.copySelection],
  );

  const handleContextMenuRenameNode = useCallback(
    (nodeId: string) => {
      canvas.selectNode(nodeId);
      setContextMenu(null);
    },
    [canvas.selectNode],
  );

  const [viewYamlNodeId, setViewYamlNodeId] = useState<string | null>(null);

  const handleContextMenuViewYaml = useCallback(
    (nodeId: string) => {
      setViewYamlNodeId(nodeId);
      setContextMenu(null);
    },
    [],
  );

  const handleContextMenuPaste = useCallback(() => {
    canvas.pasteAtCenter();
    setContextMenu(null);
  }, [canvas.pasteAtCenter]);

  const handleContextMenuFitView = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuCopySelection = useCallback(() => {
    canvas.copySelection();
    setContextMenu(null);
  }, [canvas.copySelection]);

  const handleContextMenuDuplicateSelection = useCallback(() => {
    canvas.duplicateSelection();
    setContextMenu(null);
  }, [canvas.duplicateSelection]);

  const handleContextMenuDisableSelection = useCallback(() => {
    canvas.disableSelection();
    setContextMenu(null);
  }, [canvas.disableSelection]);

  const handleContextMenuDeleteSelection = useCallback(() => {
    canvas.deleteSelection();
    setContextMenu(null);
    // Same focus restoration as handleNodesDelete — the selection may
    // include the focused node element.
    containerRef.current?.focus({ preventScroll: true });
  }, [canvas.deleteSelection]);

  const handleSelectionContextMenu = useCallback(
    (event: React.MouseEvent, selectedNodes: { id: string }[]) => {
      event.preventDefault();
      const nonSentinels = selectedNodes.filter((n) => n.id !== "__start__" && n.id !== "__end__");
      if (nonSentinels.length === 0) return;
      setContextMenu({
        target: { type: "selection", count: nonSentinels.length },
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Pending picker handlers (two-step menu-to-picker flow, AD-T05)
  // ---------------------------------------------------------------------------

  const pendingPickerVirtualAnchor = useMemo(() => {
    if (!pendingPicker) return { current: null };
    const { x, y } = pendingPicker.position;
    const virtualEl = document.createElement("button");
    virtualEl.getBoundingClientRect = () => ({
      x,
      y,
      width: 0,
      height: 0,
      top: y,
      right: x,
      bottom: y,
      left: x,
      toJSON: () => ({}),
    });
    return { current: virtualEl };
  }, [pendingPicker]);

  const handlePendingPickerOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setPendingPicker(null);
    }
  }, []);

  const handlePendingPickerSelectKind = useCallback(
    (kindString: string) => {
      if (!pendingPicker) return;

      if (pendingPicker.purpose === "add-after-node" && pendingPicker.sourceId) {
        canvas.addSuccessorTask(pendingPicker.sourceId, kindString);
      } else if (pendingPicker.purpose === "insert-on-edge" && pendingPicker.sourceId) {
        canvas.insertTaskOnEdge(pendingPicker.sourceId, kindString);
      } else if (pendingPicker.purpose === "add-at-position") {
        canvas.addNodeAtPosition(kindString, pendingPicker.position);
      }

      setPendingPicker(null);
    },
    [pendingPicker, canvas.addSuccessorTask, canvas.insertTaskOnEdge, canvas.addNodeAtPosition],
  );

  const pendingInsertionContext = useMemo(() => {
    if (!pendingPicker) return null;
    if (pendingPicker.purpose === "add-after-node" && pendingPicker.sourceId) {
      const graphModel = canvas.getGraphModel();
      const sourceNode = graphModel.nodes.find((n) => n.id === pendingPicker.sourceId);
      return {
        mode: "append-after" as const,
        sourceNodeId: pendingPicker.sourceId,
        sourceDisplayName: sourceNode?.taskName ?? pendingPicker.sourceId,
      };
    }
    if (pendingPicker.purpose === "insert-on-edge" && pendingPicker.sourceId) {
      const graphModel = canvas.getGraphModel();
      const edge = graphModel.edges.find((e) => e.id === pendingPicker.sourceId);
      if (!edge) return null;
      const sourceNode = graphModel.nodes.find((n) => n.id === edge.source);
      const targetNode = graphModel.nodes.find((n) => n.id === edge.target);
      return {
        mode: "edge-splice" as const,
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceDisplayName: sourceNode?.taskName ?? edge.source,
        targetDisplayName: targetNode?.taskName ?? edge.target,
      };
    }
    return { mode: "add-at-position" as const };
  }, [pendingPicker, canvas]);

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

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      handleNodesDelete([{ id: nodeId } as import("@xyflow/react").Node]);
    },
    [handleNodesDelete],
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      canvas.duplicateNode(nodeId);
    },
    [canvas.duplicateNode],
  );

  const canvasActions = useMemo<CanvasActions>(
    () => ({
      insertTaskOnEdge: canvas.insertTaskOnEdge,
      deleteNode: handleDeleteNode,
      addSuccessorTask: canvas.addSuccessorTask,
      duplicateNode: handleDuplicateNode,
      addSwitchCase: canvas.addSwitchCase,
      addForkBranch: canvas.addForkBranch,
      addCatchHandler: canvas.addCatchHandler,
      removeSwitchCase: canvas.removeSwitchCase,
      reorderSwitchCases: canvas.reorderSwitchCases,
      removeForkBranch: canvas.removeForkBranch,
      reorderForkBranches: canvas.reorderForkBranches,
      renameForkBranch: canvas.renameForkBranch,
      setForkCompete: canvas.setForkCompete,
      updateCatchConfig: canvas.updateCatchConfig,
      removeCatchBlock: canvas.removeCatchBlock,
      updateForEachConfig: canvas.updateForEachConfig,
      getGraphModel: canvas.getGraphModel,
    }),
    [
      canvas.insertTaskOnEdge,
      handleDeleteNode,
      canvas.addSuccessorTask,
      handleDuplicateNode,
      canvas.addSwitchCase,
      canvas.addForkBranch,
      canvas.addCatchHandler,
      canvas.removeSwitchCase,
      canvas.reorderSwitchCases,
      canvas.removeForkBranch,
      canvas.reorderForkBranches,
      canvas.renameForkBranch,
      canvas.setForkCompete,
      canvas.updateCatchConfig,
      canvas.removeCatchBlock,
      canvas.updateForEachConfig,
      canvas.getGraphModel,
    ],
  );

  const descriptor = canvas.selection?.type === "node"
    ? canvas.getNodeDescriptor(canvas.selection.id)
    : undefined;

  const selectionAnnouncement = useMemo(() => {
    if (!canvas.selection || !canvas.graph) return "";
    if (canvas.selection.type === "node") {
      const node = canvas.graph.nodes.find((n) => n.id === canvas.selection!.id);
      if (!node) return "";
      return `Selected task: ${node.taskName}`;
    }
    if (canvas.selection.type === "edge") {
      const edge = canvas.graph.edges.find((e) => e.id === canvas.selection!.id);
      if (!edge) return "";
      return `Selected edge: ${edge.source} to ${edge.target}`;
    }
    return "";
  }, [canvas.selection, canvas.graph]);

  const fallback = loadingFallback ?? (
    <div className="stg:flex stg:h-full stg:w-full stg:items-center stg:justify-center stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]">
      Loading canvas…
    </div>
  );

  if (canvas.error) {
    return (
      <div className={cn("stg:flex stg:h-full stg:w-full stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:p-4", className)}>
        <span className="stg:text-sm stg:font-medium stg:text-[var(--stgm-destructive,#ef4444)]">
          Failed to parse workflow
        </span>
        <span className="stg:max-w-md stg:text-center stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
          {canvas.error}
        </span>
      </div>
    );
  }

  const hasGraph = !!canvas.graph;

  return (
    <div
      ref={containerRef}
      className={cn("stgm stg:relative stg:flex stg:h-full stg:w-full", className)}
      tabIndex={-1}
    >
      <div className="stg:sr-only" aria-live="polite" aria-atomic="true">
        {selectionAnnouncement}
      </div>

      {showPalette && !paletteCollapsed && <WorkflowTaskPalette />}

      <div className="stg:relative stg:flex-1" onPointerDownCapture={handleCanvasPointerDownCapture}>
        {showPalette && (
          <PaletteToggle
            collapsed={paletteCollapsed}
            onToggle={togglePalette}
          />
        )}
        {hasGraph && (
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
        )}
        <CanvasActionsContext.Provider value={canvasActions}>
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
              onNodesDelete={handleNodesDelete}
              onEdgesDelete={canvas.onEdgesDelete}
              onNodeContextMenu={handleNodeContextMenu}
              onEdgeContextMenu={handleEdgeContextMenu}
              onPaneContextMenu={handlePaneContextMenu}
              onSelectionContextMenu={handleSelectionContextMenu}
              nodeErrors={nodeErrors}
            />
          </Suspense>
          {!hasGraph && (
            <div className="stg:pointer-events-none stg:absolute stg:inset-0 stg:flex stg:items-center stg:justify-center">
              <div className="stg:flex stg:flex-col stg:items-center stg:gap-2 stg:text-center">
                <span className="stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]">
                  No workflow to visualize
                </span>
                <span className="stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
                  Drag a task from the palette to get started
                </span>
              </div>
            </div>
          )}
        </CanvasActionsContext.Provider>

        <CanvasContextMenu
          open={contextMenu !== null}
          onOpenChange={handleContextMenuOpenChange}
          target={contextMenu?.target ?? null}
          position={contextMenu?.position ?? null}
          onDeleteNode={handleContextMenuDeleteNode}
          onDuplicateNode={handleContextMenuDuplicateNode}
          onAddTaskAfter={handleContextMenuAddTaskAfter}
          onToggleDisabled={handleContextMenuToggleDisabled}
          onWrapInTryCatch={handleContextMenuWrapInTryCatch}
          onCopyNode={handleContextMenuCopyNode}
          onRenameNode={handleContextMenuRenameNode}
          onViewYaml={handleContextMenuViewYaml}
          onDeleteEdge={handleContextMenuDeleteEdge}
          onInsertTaskOnEdge={handleContextMenuInsertTaskOnEdge}
          onAddTaskAtPosition={handleContextMenuAddTaskAtPosition}
          onSelectAll={handleContextMenuSelectAll}
          onAutoLayout={handleContextMenuAutoLayout}
          onPaste={handleContextMenuPaste}
          hasClipboard={canvas.hasClipboard}
          onFitView={handleContextMenuFitView}
          onCopySelection={handleContextMenuCopySelection}
          onDuplicateSelection={handleContextMenuDuplicateSelection}
          onDisableSelection={handleContextMenuDisableSelection}
          onDeleteSelection={handleContextMenuDeleteSelection}
        />

        <TaskPickerPopover
          open={pendingPicker !== null}
          onOpenChange={handlePendingPickerOpenChange}
          onSelectKind={handlePendingPickerSelectKind}
          anchorRef={pendingPickerVirtualAnchor}
          insertionContext={pendingInsertionContext}
          graph={canvas.getGraphModel()}
          side="bottom"
        />

        <ViewYamlDialog
          nodeId={viewYamlNodeId}
          graph={canvas.graph}
          onClose={() => setViewYamlNodeId(null)}
        />
      </div>

      {showInspector && hasGraph && (
        <div className="stg:w-[280px] stg:min-w-[240px] stg:overflow-hidden stg:border-l stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))]">
          <WorkflowInspectorPanel
            selection={canvas.selection}
            graph={canvas.graph}
            descriptor={descriptor}
            onUpdateField={canvas.updateNodeField}
            onRenameNode={canvas.renameNode}
            onUpdateExport={canvas.updateNodeExport}
            onUpdateFlow={canvas.updateNodeFlow}
            onDeleteEdge={handleDeleteEdge}
            onDeleteNode={handleDeleteNode}
            onDuplicateNode={handleDuplicateNode}
            onToggleDisabled={canvas.toggleNodeDisabled}
            onWrapInTryCatch={canvas.wrapInTryCatch}
            onUpdateBranchRouting={canvas.updateBranchRouting}
            onMigrateBranchHandle={canvas.migrateBranchHandle}
            onRemoveBranchEdges={canvas.removeBranchEdges}
            onViewYaml={handleContextMenuViewYaml}
            validationErrors={nodeErrors}
            emptyState={canvas.graph ? <WorkflowSummaryPanel graph={canvas.graph} validationErrors={nodeErrors} /> : undefined}
          />
        </div>
      )}
    </div>
  );
});

/**
 * Outer wrapper that provides the React Flow zustand store context.
 *
 * `useWorkflowCanvas` (called inside the inner component) uses `useReactFlow()`
 * which requires a `<ReactFlowProvider>` ancestor. The `<ReactFlow>` component
 * inside `WorkflowCanvasInner` creates its own store but that is too late — the
 * hook runs before the child mounts. This wrapper solves the provider ordering.
 */
export const WorkflowCanvasEditor = memo(function WorkflowCanvasEditor(
  props: WorkflowCanvasEditorProps,
) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasEditorInner {...props} />
    </ReactFlowProvider>
  );
});

// ---------------------------------------------------------------------------
// Canvas toolbar
// ---------------------------------------------------------------------------

function PaletteToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "stg:absolute stg:left-2 stg:z-10 stg:rounded stg:border stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:p-1 stg:shadow-sm",
              "stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:active:bg-[var(--stgm-accent,#e5e5e5)]",
              collapsed ? "stg:top-2" : "stg:bottom-2",
            )}
            aria-label={collapsed ? "Show task palette" : "Hide task palette"}
          />
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stg:text-[var(--stgm-foreground,#1a1a2e)]"
        >
          {collapsed ? (
            <>
              <rect x="1" y="1" width="5" height="14" rx="1" />
              <path d="M10 8h5M11 6l2 2-2 2" />
            </>
          ) : (
            <>
              <rect x="1" y="1" width="5" height="14" rx="1" />
              <path d="M14 8H9M13 6l-2 2 2 2" />
            </>
          )}
        </svg>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed ? "Show task palette" : "Hide task palette"}
      </TooltipContent>
    </Tooltip>
  );
}

const toolbarIsMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const TOOLBAR_SHORTCUTS = {
  undo: toolbarIsMac ? "\u2318Z" : "Ctrl+Z",
  redo: toolbarIsMac ? "\u21E7\u2318Z" : "Ctrl+Shift+Z",
  save: toolbarIsMac ? "\u2318S" : "Ctrl+S",
} as const;

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
    "stg:rounded stg:border stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)] stg:shadow-sm stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:active:bg-[var(--stgm-accent,#e5e5e5)] stg:disabled:cursor-not-allowed stg:disabled:opacity-40";

  return (
    // Undo/Redo show their keyboard shortcut on the house tooltip; the
    // trigger is a wrapper span so the shortcut stays discoverable while the
    // button is disabled (disabled buttons receive no pointer events).
    // Auto-layout's label is already visible text — no tooltip to add. The
    // provider is context-only and groups the buttons' hover delay.
    <TooltipProvider>
      <div className="stg:absolute stg:left-2 stg:top-2 stg:z-10 stg:flex stg:items-center stg:gap-1">
        <Tooltip>
          <TooltipTrigger render={<span className="stg:inline-flex" />}>
            <button type="button" onClick={onUndo} disabled={!canUndo} className={btnClass} aria-label="Undo">
              Undo
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{TOOLBAR_SHORTCUTS.undo}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<span className="stg:inline-flex" />}>
            <button type="button" onClick={onRedo} disabled={!canRedo} className={btnClass} aria-label="Redo">
              Redo
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{TOOLBAR_SHORTCUTS.redo}</TooltipContent>
        </Tooltip>
        <div className="stg:mx-1 stg:h-4 stg:w-px stg:bg-[var(--stgm-border,#d4d4d8)]" aria-hidden="true" />
        <button type="button" onClick={onAutoLayout} className={btnClass} aria-label="Auto-layout">
          Auto-layout
        </button>
        {onSave && (
          <>
            <div className="stg:mx-1 stg:h-4 stg:w-px stg:bg-[var(--stgm-border,#d4d4d8)]" aria-hidden="true" />
            <button
              type="button"
              onClick={onSave}
              disabled={!isDirty || isSaving}
              className="stg:rounded stg:bg-[var(--stgm-primary,#6366f1)] stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-[var(--stgm-primary-foreground,#fff)] stg:shadow-sm stg:hover:opacity-90 stg:disabled:cursor-not-allowed stg:disabled:opacity-40"
            >
              {isSaving ? "Saving\u2026" : "Save"}
            </button>
          </>
        )}
        {isDirty && !onSave && (
          <span className="stg:ml-1 stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
            Modified
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}
