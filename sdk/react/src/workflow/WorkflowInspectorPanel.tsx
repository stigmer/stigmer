"use client";

import { memo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge } from "./workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model";
import type { CanvasSelection } from "./useWorkflowCanvas";
import type { TaskKindDescriptor } from "./types";
import { TaskConfigForm } from "./TaskConfigForm";
import { BranchConditionBuilder } from "./BranchConditionBuilder";
import { ApprovalFormBuilder } from "./ApprovalFormBuilder";
import { CATEGORY_COLORS } from "./canvas-constants";
import { taskKindToString } from "./workflow-graph-conversions";

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
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Inspector panel for the visual canvas editor.
 *
 * Renders a right sidebar with context-sensitive sections based on the
 * selected element: node inspector (Identity, Configuration, Export, Flow),
 * edge inspector (label, source/target), or sentinel summary.
 *
 * Controlled component: receives selection + graph from the canvas hook
 * and calls mutation methods for all edits (AD-T15-B3-004).
 *
 * @since T15 Batch 3 (Inspector + Edit Loop)
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
  onUpdateBranchRouting,
  onMigrateBranchHandle,
  onRemoveBranchEdges,
  className,
}: WorkflowInspectorPanelProps) {
  if (!selection || !graph) {
    return (
      <div className={cn("flex h-full items-center justify-center p-4", className)}>
        <span className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
          Select a task or connection to inspect
        </span>
      </div>
    );
  }

  if (selection.type === "edge") {
    const edge = graph.edges.find((e) => e.id === selection.id);
    if (!edge) return null;
    return (
      <EdgeInspector
        edge={edge}
        graph={graph}
        onDeleteEdge={onDeleteEdge}
        className={className}
      />
    );
  }

  const node = graph.nodes.find((n) => n.id === selection.id);
  if (!node) return null;

  if (node.id === START_NODE_ID || node.id === END_NODE_ID) {
    return <SentinelInspector node={node} className={className} />;
  }

  return (
    <NodeInspector
      node={node}
      graph={graph}
      descriptor={descriptor}
      onUpdateField={onUpdateField}
      onRenameNode={onRenameNode}
      onUpdateExport={onUpdateExport}
      onUpdateFlow={onUpdateFlow}
      onUpdateBranchRouting={onUpdateBranchRouting}
      onMigrateBranchHandle={onMigrateBranchHandle}
      onRemoveBranchEdges={onRemoveBranchEdges}
    />
  );
});

// ---------------------------------------------------------------------------
// NodeInspector
// ---------------------------------------------------------------------------

function NodeInspector({
  node,
  graph,
  descriptor,
  onUpdateField,
  onRenameNode,
  onUpdateExport,
  onUpdateFlow,
  onUpdateBranchRouting,
  onMigrateBranchHandle,
  onRemoveBranchEdges,
}: {
  node: WorkflowGraphNode;
  graph: WorkflowGraphModel;
  descriptor: TaskKindDescriptor | undefined;
  onUpdateField: (nodeId: string, fieldPath: string, value: unknown) => void;
  onRenameNode: (nodeId: string, newName: string) => void;
  onUpdateExport: (nodeId: string, exportAs: string | undefined) => void;
  onUpdateFlow: (nodeId: string, thenTarget: string | undefined) => void;
  onUpdateBranchRouting?: (nodeId: string, handleId: string, targetTask: string | undefined) => void;
  onMigrateBranchHandle?: (nodeId: string, oldHandleId: string, newHandleId: string) => void;
  onRemoveBranchEdges?: (nodeId: string, handleId: string) => void;
}) {
  const kindStr = taskKindToString(node.kind);
  const categoryColor = CATEGORY_COLORS[node.category];

  const handleFieldChange = useCallback(
    (fieldPath: string, value: unknown) => {
      onUpdateField(node.id, fieldPath, value);
    },
    [node.id, onUpdateField],
  );

  const otherTaskNames = graph.nodes
    .filter((n) => n.id !== node.id && n.id !== START_NODE_ID && n.id !== END_NODE_ID)
    .map((n) => n.taskName);

  const isSwitchCase = kindStr === "switch_case";
  const isHumanInput = kindStr === "human_input";
  const hasSpecializedEditor = isSwitchCase || isHumanInput;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <IdentitySection
        node={node}
        graph={graph}
        kindStr={kindStr}
        categoryColor={categoryColor}
        description={descriptor?.description}
        onRenameNode={onRenameNode}
      />

      {/* Configuration: specialized editors for switch_case and human_input */}
      <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
        <SectionHeader title="Configuration" />
        {isSwitchCase && onUpdateBranchRouting && onMigrateBranchHandle && onRemoveBranchEdges ? (
          <BranchConditionBuilder
            nodeId={node.id}
            config={node.config}
            edges={graph.edges}
            allTaskNames={otherTaskNames}
            onUpdateConfig={handleFieldChange}
            onUpdateBranchRouting={(handleId, target) =>
              onUpdateBranchRouting(node.id, handleId, target)
            }
            onMigrateBranchHandle={(oldId, newId) =>
              onMigrateBranchHandle(node.id, oldId, newId)
            }
            onRemoveBranchEdges={(handleId) =>
              onRemoveBranchEdges(node.id, handleId)
            }
          />
        ) : isHumanInput && onUpdateBranchRouting && onMigrateBranchHandle && onRemoveBranchEdges ? (
          <ApprovalFormBuilder
            nodeId={node.id}
            config={node.config}
            edges={graph.edges}
            allTaskNames={otherTaskNames}
            onUpdateConfig={handleFieldChange}
            onUpdateBranchRouting={(handleId, target) =>
              onUpdateBranchRouting(node.id, handleId, target)
            }
            onMigrateBranchHandle={(oldId, newId) =>
              onMigrateBranchHandle(node.id, oldId, newId)
            }
            onRemoveBranchEdges={(handleId) =>
              onRemoveBranchEdges(node.id, handleId)
            }
          />
        ) : descriptor && descriptor.fields.length > 0 ? (
          <TaskConfigForm
            fields={descriptor.fields}
            fieldGroups={descriptor.fieldGroups}
            config={node.config}
            onChange={handleFieldChange}
          />
        ) : (
          <div className="px-3 py-4 text-xs text-[var(--stgm-muted-foreground,#737373)]">
            No configurable fields for this task kind.
          </div>
        )}
      </div>

      <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
        <ExportSection node={node} onUpdateExport={onUpdateExport} />
      </div>

      {/* Flow section hidden for branching tasks (routing is managed by the builder) */}
      {!hasSpecializedEditor && (
        <div className="border-t border-[var(--stgm-border,#e5e5e5)]">
          <FlowSection node={node} otherTaskNames={otherTaskNames} onUpdateFlow={onUpdateFlow} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IdentitySection
// ---------------------------------------------------------------------------

function IdentitySection({
  node,
  graph,
  kindStr,
  categoryColor,
  description,
  onRenameNode,
}: {
  node: WorkflowGraphNode;
  graph: WorkflowGraphModel;
  kindStr: string;
  categoryColor: string;
  description?: string;
  onRenameNode: (nodeId: string, newName: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(node.taskName);
  const [nameError, setNameError] = useState<string | null>(null);

  const existingNames = new Set(
    graph.nodes.filter((n) => n.id !== node.id).map((n) => n.taskName),
  );

  const startEditing = useCallback(() => {
    setEditingName(true);
    setNameValue(node.taskName);
    setNameError(null);
  }, [node.taskName]);

  const commitName = useCallback(() => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      setNameError("Must start with a letter or underscore, alphanumeric/underscore only");
      return;
    }
    if (existingNames.has(trimmed)) {
      setNameError("A task with this name already exists");
      return;
    }
    setEditingName(false);
    setNameError(null);
    if (trimmed !== node.taskName) {
      onRenameNode(node.id, trimmed);
    }
  }, [nameValue, existingNames, node.id, node.taskName, onRenameNode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitName();
      if (e.key === "Escape") {
        setEditingName(false);
        setNameError(null);
      }
    },
    [commitName],
  );

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {/* Task name */}
      {editingName ? (
        <div className="flex flex-col gap-0.5">
          <input
            type="text"
            value={nameValue}
            onChange={(e) => { setNameValue(e.target.value); setNameError(null); }}
            onBlur={commitName}
            onKeyDown={handleKeyDown}
            autoFocus
            className="rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1 text-sm font-medium text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          />
          {nameError && (
            <span className="text-[10px] text-[var(--stgm-destructive,#ef4444)]">{nameError}</span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="w-fit text-left text-sm font-medium text-[var(--stgm-foreground,#1a1a2e)] hover:underline"
          title="Click to rename"
        >
          {node.taskName}
        </button>
      )}

      {/* Kind badge */}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
          style={{
            color: categoryColor,
            backgroundColor: `color-mix(in srgb, ${categoryColor} 12%, transparent)`,
          }}
        >
          {kindStr.replace(/_/g, " ")}
        </span>
        <span className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          {node.category}
        </span>
      </div>

      {/* Description */}
      {description && (
        <p className="text-[11px] leading-relaxed text-[var(--stgm-muted-foreground,#737373)]">
          {description}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExportSection
// ---------------------------------------------------------------------------

function ExportSection({
  node,
  onUpdateExport,
}: {
  node: WorkflowGraphNode;
  onUpdateExport: (nodeId: string, exportAs: string | undefined) => void;
}) {
  const [value, setValue] = useState(node.export?.as ?? "");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
    },
    [],
  );

  const handleBlur = useCallback(() => {
    const trimmed = value.trim();
    onUpdateExport(node.id, trimmed || undefined);
  }, [value, node.id, onUpdateExport]);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <SectionHeader title="Export" />
      <label className="text-[11px] text-[var(--stgm-muted-foreground,#737373)]">
        Export task output as a named variable
      </label>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="e.g., result, analysis_output"
        className="w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FlowSection
// ---------------------------------------------------------------------------

function FlowSection({
  node,
  otherTaskNames,
  onUpdateFlow,
}: {
  node: WorkflowGraphNode;
  otherTaskNames: string[];
  onUpdateFlow: (nodeId: string, thenTarget: string | undefined) => void;
}) {
  const currentFlow = node.flow?.then ?? "";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      onUpdateFlow(node.id, val || undefined);
    },
    [node.id, onUpdateFlow],
  );

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <SectionHeader title="Flow" />
      <label className="text-[11px] text-[var(--stgm-muted-foreground,#737373)]">
        Transition after this task completes
      </label>
      <select
        value={currentFlow}
        onChange={handleChange}
        className="w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
      >
        <option value="">Next (implicit sequential)</option>
        <option value="end">End workflow</option>
        {otherTaskNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EdgeInspector
// ---------------------------------------------------------------------------

function EdgeInspector({
  edge,
  graph,
  onDeleteEdge,
  className,
}: {
  edge: WorkflowGraphEdge;
  graph: WorkflowGraphModel;
  onDeleteEdge?: (edgeId: string) => void;
  className?: string;
}) {
  const sourceNode = graph.nodes.find((n) => n.id === edge.source);
  const targetNode = graph.nodes.find((n) => n.id === edge.target);

  return (
    <div className={cn("flex h-full flex-col gap-4 p-3", className)}>
      <SectionHeader title="Connection" />

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

// ---------------------------------------------------------------------------
// SentinelInspector
// ---------------------------------------------------------------------------

function SentinelInspector({
  node,
  className,
}: {
  node: WorkflowGraphNode;
  className?: string;
}) {
  const isStart = node.id === START_NODE_ID;

  return (
    <div className={cn("flex h-full flex-col gap-2 p-3", className)}>
      <SectionHeader title={isStart ? "Start" : "End"} />
      <p className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
        {isStart
          ? "Entry point of the workflow. The first task is connected automatically."
          : "Terminal point. Tasks routing here end the workflow execution."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
      {title}
    </h3>
  );
}
