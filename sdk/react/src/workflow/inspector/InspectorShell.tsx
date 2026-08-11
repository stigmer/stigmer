"use client";

import { memo, useMemo, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphModel, WorkflowGraphNode, WorkflowGraphEdge } from "../workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model.js";
import type { CanvasSelection } from "../useWorkflowCanvas.js";
import type { TaskKindDescriptor } from "../types.js";
import { Tabs } from "../../tabs/Tabs.js";
import { CATEGORY_COLORS } from "../canvas-constants.js";
import { taskKindToString } from "../workflow-graph-conversions.js";
import { InspectorHeader } from "./InspectorHeader.js";
import { useInspectorTabs } from "./useInspectorTabs.js";
import { ConfigureTab } from "./tabs/ConfigureTab.js";
import { BranchesTab } from "./tabs/BranchesTab.js";
import { CatchTab } from "./tabs/CatchTab.js";
import { IterationTab } from "./tabs/IterationTab.js";
import { DataTab } from "./tabs/DataTab.js";
import { RuntimeTab } from "./tabs/RuntimeTab.js";
import { AdvancedTab } from "./tabs/AdvancedTab.js";
import { DocsTab } from "./tabs/DocsTab.js";
import { EdgeInspector } from "./EdgeInspector.js";
import { SentinelInspector } from "./SentinelInspector.js";
import type { InspectorMutations, InspectorNodeIdentity, DesignTabId } from "./types.js";

/** Props for {@link InspectorShell}. */
export interface InspectorShellProps {
  /** Currently selected element on the canvas. */
  readonly selection: CanvasSelection | null;
  /** The current graph model for node/edge lookups. */
  readonly graph: WorkflowGraphModel | null;
  /** Descriptor for the selected node's task kind. */
  readonly descriptor: TaskKindDescriptor | undefined;
  /** Mutation callbacks for design-mode editing. */
  readonly mutations: InspectorMutations;
  /** Validation errors keyed by node ID. */
  readonly validationErrors?: ReadonlyMap<string, readonly string[]>;
  /** Content to render when nothing is selected. */
  readonly emptyState?: React.ReactNode;
  /** Called to open the View YAML dialog for a node. */
  readonly onViewYaml?: (nodeId: string) => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Shared inspector shell that renders a consistent header, tab bar, and
 * scrollable content area. Routes to the appropriate sub-inspector based
 * on the current selection.
 *
 * In design mode, renders tabbed configuration forms. Sentinel and edge
 * selections render dedicated lightweight inspectors.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const InspectorShell = memo(function InspectorShell({
  selection,
  graph,
  descriptor,
  mutations,
  validationErrors,
  emptyState,
  onViewYaml,
  className,
}: InspectorShellProps) {
  if (!selection || !graph) {
    return (
      <div className={cn("stg:flex stg:h-full stg:flex-col", className)}>
        {emptyState ?? (
          <div className="stg:flex stg:flex-1 stg:items-center stg:justify-center stg:p-4">
            <span className="stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
              Select a task or connection to inspect
            </span>
          </div>
        )}
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
        onDeleteEdge={mutations.onDeleteEdge}
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
    <NodeInspectorShell
      node={node}
      graph={graph}
      descriptor={descriptor}
      mutations={mutations}
      validationErrors={validationErrors}
      onViewYaml={onViewYaml}
      className={className}
    />
  );
});

// ---------------------------------------------------------------------------
// NodeInspectorShell — tabbed design-mode inspector
// ---------------------------------------------------------------------------

function NodeInspectorShell({
  node,
  graph,
  descriptor,
  mutations,
  validationErrors,
  onViewYaml,
  className,
}: {
  node: WorkflowGraphNode;
  graph: WorkflowGraphModel;
  descriptor: TaskKindDescriptor | undefined;
  mutations: InspectorMutations;
  validationErrors?: ReadonlyMap<string, readonly string[]>;
  onViewYaml?: (nodeId: string) => void;
  className?: string;
}) {
  const kindStr = taskKindToString(node.kind);

  const identity = useMemo((): InspectorNodeIdentity => ({
    nodeId: node.id,
    taskName: node.taskName,
    kindString: kindStr,
    category: node.category,
    categoryColor: CATEGORY_COLORS[node.category],
    displayName: descriptor?.displayName ?? kindStr.replace(/_/g, " "),
    description: descriptor?.description,
    icon: descriptor?.icon,
  }), [node.id, node.taskName, node.category, kindStr, descriptor]);

  const { tabs, activeTab, setActiveTab } = useInspectorTabs({
    kindString: kindStr,
    descriptor,
    mode: "design",
    nodeId: node.id,
  });

  const handleTabChange = useCallback(
    (tabId: string) => setActiveTab(tabId as DesignTabId),
    [setActiveTab],
  );

  const handleFieldChange = useCallback(
    (fieldPath: string, value: unknown) => {
      mutations.onUpdateField(node.id, fieldPath, value);
    },
    [node.id, mutations.onUpdateField],
  );

  const otherTaskNames = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.id !== node.id && n.id !== START_NODE_ID && n.id !== END_NODE_ID)
        .map((n) => n.taskName),
    [graph.nodes, node.id],
  );

  const nodeErrors = validationErrors?.get(node.id);

  return (
    <div className={cn("stg:flex stg:h-full stg:flex-col", className)}>
      <InspectorHeader
        identity={identity}
        graph={graph}
        mutations={mutations}
        onViewYaml={onViewYaml}
      />

      <Tabs
        tabs={tabs.map((t) => ({ id: t.id, label: t.label, badge: t.badge, icon: t.icon }))}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        aria-label="Task configuration"
        className="stg:min-h-0 stg:flex-1"
      >
        <div className="stg:overflow-y-auto">
          {activeTab === "configure" && (
            <ConfigureTab
              node={node}
              graph={graph}
              descriptor={descriptor}
              kindString={kindStr}
              otherTaskNames={otherTaskNames}
              onFieldChange={handleFieldChange}
              mutations={mutations}
            />
          )}
          {activeTab === "branches" && (
            <BranchesTab
              node={node}
              graph={graph}
              mutations={mutations}
              kindString={kindStr}
            />
          )}
          {activeTab === "catch" && (
            <CatchTab node={node} mutations={mutations} />
          )}
          {activeTab === "iteration" && (
            <IterationTab node={node} mutations={mutations} />
          )}
          {activeTab === "data" && (
            <DataTab
              node={node}
              onUpdateExport={mutations.onUpdateExport}
            />
          )}
          {activeTab === "runtime" && (
            <RuntimeTab
              node={node}
              kindString={kindStr}
              descriptor={descriptor}
              onFieldChange={handleFieldChange}
            />
          )}
          {activeTab === "advanced" && (
            <AdvancedTab
              node={node}
              otherTaskNames={otherTaskNames}
              kindString={kindStr}
              onUpdateFlow={mutations.onUpdateFlow}
            />
          )}
          {activeTab === "docs" && descriptor && (
            <DocsTab descriptor={descriptor} />
          )}
        </div>
      </Tabs>
    </div>
  );
}
