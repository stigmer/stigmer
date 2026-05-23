"use client";

import { memo, useMemo } from "react";
import type { WorkflowGraphModel } from "./workflow-graph-model";
import type { CanvasSelection } from "./useWorkflowCanvas";
import type { TaskKindDescriptor } from "./types";
import { InspectorShell } from "./inspector/InspectorShell";
import type { InspectorMutations } from "./inspector/types";

/** Props for {@link WorkflowInspectorPanel}. */
export interface WorkflowInspectorPanelProps {
  /** Currently selected element on the canvas. */
  readonly selection: CanvasSelection | null;
  /** The current graph model for node/edge lookups. */
  readonly graph: WorkflowGraphModel | null;
  /** Descriptor for the selected node's task kind. */
  readonly descriptor: TaskKindDescriptor | undefined;
  /** Called when a config field value changes. */
  readonly onUpdateField: (nodeId: string, fieldPath: string, value: unknown) => void;
  /** Called when a node is renamed. */
  readonly onRenameNode: (nodeId: string, newName: string) => void;
  /** Called when a node's export.as changes. */
  readonly onUpdateExport: (nodeId: string, exportAs: string | undefined) => void;
  /** Called when a node's flow.then changes. */
  readonly onUpdateFlow: (nodeId: string, thenTarget: string | undefined) => void;
  /** Called to delete an edge. */
  readonly onDeleteEdge?: (edgeId: string) => void;
  /** Called to delete a node (task). */
  readonly onDeleteNode?: (nodeId: string) => void;
  /** Called to duplicate a node. */
  readonly onDuplicateNode?: (nodeId: string) => void;
  /** Called to toggle disabled state on a node. */
  readonly onToggleDisabled?: (nodeId: string) => void;
  /** Called to wrap a node in a try/catch container. */
  readonly onWrapInTryCatch?: (nodeId: string) => void;
  /** Called to create/update/remove an edge for a specific branch handle. */
  readonly onUpdateBranchRouting?: (
    nodeId: string,
    handleId: string,
    targetTask: string | undefined,
  ) => void;
  /** Called when a branch handle is renamed (case/outcome rename). */
  readonly onMigrateBranchHandle?: (
    nodeId: string,
    oldHandleId: string,
    newHandleId: string,
  ) => void;
  /** Called to remove all edges from a specific branch handle. */
  readonly onRemoveBranchEdges?: (nodeId: string, handleId: string) => void;
  /** Validation errors keyed by node ID. */
  readonly validationErrors?: ReadonlyMap<string, readonly string[]>;
  /** Content to render when nothing is selected (workflow summary). */
  readonly emptyState?: React.ReactNode;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Inspector panel for the visual canvas editor.
 *
 * Thin wrapper that bridges the callback-based prop API from
 * `WorkflowCanvasEditor` into the tabbed `InspectorShell` architecture.
 *
 * The shell renders a tabbed inspector with a consistent header, actions
 * menu, and per-tab content (Configure, Data, Runtime, Advanced, Docs).
 *
 * @since T15 Batch 3 (original), T10 (refactored to tabbed shell)
 */
export const WorkflowInspectorPanel = memo(function WorkflowInspectorPanel({
  selection,
  graph,
  descriptor,
  onUpdateField,
  onRenameNode,
  onUpdateExport,
  onUpdateFlow,
  onDeleteEdge,
  onDeleteNode,
  onDuplicateNode,
  onToggleDisabled,
  onWrapInTryCatch,
  onUpdateBranchRouting,
  onMigrateBranchHandle,
  onRemoveBranchEdges,
  validationErrors,
  emptyState,
  className,
}: WorkflowInspectorPanelProps) {
  const mutations = useMemo((): InspectorMutations => ({
    onUpdateField,
    onRenameNode,
    onUpdateExport,
    onUpdateFlow,
    onDeleteEdge,
    onDeleteNode,
    onDuplicateNode,
    onToggleDisabled,
    onWrapInTryCatch,
    onUpdateBranchRouting,
    onMigrateBranchHandle,
    onRemoveBranchEdges,
  }), [
    onUpdateField,
    onRenameNode,
    onUpdateExport,
    onUpdateFlow,
    onDeleteEdge,
    onDeleteNode,
    onDuplicateNode,
    onToggleDisabled,
    onWrapInTryCatch,
    onUpdateBranchRouting,
    onMigrateBranchHandle,
    onRemoveBranchEdges,
  ]);

  return (
    <InspectorShell
      selection={selection}
      graph={graph}
      descriptor={descriptor}
      mutations={mutations}
      validationErrors={validationErrors}
      emptyState={emptyState}
      className={className}
    />
  );
});
