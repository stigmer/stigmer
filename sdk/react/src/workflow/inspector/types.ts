import type { ReactNode } from "react";
import type { WorkflowGraphNode, WorkflowGraphEdge, WorkflowGraphModel } from "../workflow-graph-model";
import type { TaskKindDescriptor, TaskKindCategory } from "../types";
import type { TopologyNodeCategory } from "../useWorkflowTopology";

/** Identifiers for design-mode inspector tabs. */
export type DesignTabId = "configure" | "branches" | "catch" | "iteration" | "data" | "runtime" | "advanced" | "docs";

/** Identifiers for execution-mode inspector tabs (matches T05). */
export type ExecutionTabId = "summary" | "input" | "output" | "error" | "retries" | "agent" | "events";

/** Union of all possible inspector tab identifiers. */
export type InspectorTabId = DesignTabId | ExecutionTabId;

/** Operating mode of the inspector panel. */
export type InspectorMode = "design" | "execution";

/**
 * Resolved identity for the node currently displayed in the inspector header.
 *
 * Computed once per selection change — avoids redundant lookups in child components.
 */
export interface InspectorNodeIdentity {
  readonly nodeId: string;
  readonly taskName: string;
  readonly kindString: string;
  readonly category: TopologyNodeCategory;
  readonly categoryColor: string;
  readonly displayName: string;
  readonly description?: string;
  readonly icon?: string;
}

/**
 * Describes a tab that should be visible in the inspector.
 *
 * Extends TabItem from the shared Tabs component with inspector-specific
 * metadata for conditional rendering.
 */
export interface InspectorTabDefinition {
  readonly id: InspectorTabId;
  readonly label: string;
  readonly badge?: number;
  readonly icon?: ReactNode;
}

/**
 * Mutation callbacks for the design-mode inspector.
 *
 * Passed from `WorkflowCanvasEditor` through `useWorkflowCanvas`.
 * Each callback is optional to support read-only embedding.
 */
export interface InspectorMutations {
  readonly onUpdateField: (nodeId: string, fieldPath: string, value: unknown) => void;
  readonly onRenameNode: (nodeId: string, newName: string) => void;
  readonly onUpdateExport: (nodeId: string, exportAs: string | undefined) => void;
  readonly onUpdateFlow: (nodeId: string, thenTarget: string | undefined) => void;
  readonly onDeleteEdge?: (edgeId: string) => void;
  readonly onDeleteNode?: (nodeId: string) => void;
  readonly onDuplicateNode?: (nodeId: string) => void;
  readonly onToggleDisabled?: (nodeId: string) => void;
  readonly onWrapInTryCatch?: (nodeId: string) => void;
  readonly onUpdateBranchRouting?: (
    nodeId: string,
    handleId: string,
    targetTask: string | undefined,
  ) => void;
  readonly onMigrateBranchHandle?: (
    nodeId: string,
    oldHandleId: string,
    newHandleId: string,
  ) => void;
  readonly onRemoveBranchEdges?: (nodeId: string, handleId: string) => void;
  readonly onRemoveSwitchCase?: (switchNodeId: string, caseName: string) => void;
  readonly onReorderSwitchCases?: (switchNodeId: string, newOrder: readonly string[]) => void;
  readonly onRemoveForkBranch?: (forkNodeId: string, branchName: string) => void;
  readonly onReorderForkBranches?: (forkNodeId: string, newOrder: readonly string[]) => void;
  readonly onRenameForkBranch?: (forkNodeId: string, oldName: string, newName: string) => void;
  readonly onSetForkCompete?: (forkNodeId: string, compete: boolean) => void;
  readonly onUpdateCatchConfig?: (tryCatchNodeId: string, updates: { as?: string; compensate?: boolean }) => void;
  readonly onRemoveCatchBlock?: (tryCatchNodeId: string) => void;
  readonly onUpdateForEachConfig?: (forEachNodeId: string, updates: Partial<{ each: string; in: string; max_parallelism: number; batch_size: number; on_error: string }>) => void;
}
