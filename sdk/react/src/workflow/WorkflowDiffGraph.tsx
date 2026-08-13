"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import { WorkflowNode } from "./WorkflowNode.js";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge.js";
import { CANVAS_TASK_NODE_TYPE, CANVAS_TRANSITION_EDGE_TYPE } from "./workflow-graph-conversions.js";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";
import { WorkflowGraphModeProvider } from "./WorkflowGraphModeContext.js";
import { useWorkflowDiffGraph } from "./useWorkflowDiffGraph.js";
import type { NodeDiffEntry } from "./diff/index.js";
import { DiffSummaryBar } from "./diff/index.js";

/** Props for {@link WorkflowDiffGraph}. */
export interface WorkflowDiffGraphProps {
  /** YAML content of the original (before) workflow. Empty string for generate scenarios. */
  readonly beforeYaml: string;
  /** YAML content of the updated (after) workflow. */
  readonly afterYaml: string;
  /** Callback when a task node is clicked. */
  readonly onTaskClick?: (taskName: string, entry: NodeDiffEntry) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

const nodeTypes = {
  [CANVAS_TASK_NODE_TYPE]: WorkflowNode,
} as const;

const edgeTypes = {
  [CANVAS_TRANSITION_EDGE_TYPE]: CanvasTransitionEdge,
} as const;

const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
};

/**
 * Read-only visual diff graph canvas for comparing two workflow versions.
 *
 * Reuses the same `WorkflowNode` / `NodeShell` rendering system from the
 * visual editor, wrapped in diff mode context to show change badges and
 * status highlighting instead of editing affordances.
 *
 * Follows the `WorkflowExecutionGraph` outer/inner pattern with
 * `ReactFlowProvider`.
 *
 * @since T14 (AI-Assisted Workflow Creation)
 */
export const WorkflowDiffGraph = memo(function WorkflowDiffGraph(
  props: WorkflowDiffGraphProps,
) {
  return (
    <ReactFlowProvider>
      <WorkflowDiffGraphInner {...props} />
    </ReactFlowProvider>
  );
});

function WorkflowDiffGraphInner({
  beforeYaml,
  afterYaml,
  onTaskClick,
  className,
}: WorkflowDiffGraphProps) {
  // Instance-scoped React Flow id (oss#593): React Flow derives its internal
  // DOM ids (aria descriptions, SVG marker/pattern defs) from this id, so two
  // mounted graphs without explicit ids collide.
  const flowId = useId();

  const {
    nodes,
    edges,
    diff,
    error,
    selectedTaskName,
    setSelectedTaskName,
  } = useWorkflowDiffGraph({ beforeYaml, afterYaml });

  const { fitView } = useReactFlow();
  const didFitRef = useRef(false);

  useEffect(() => {
    if (nodes.length > 0 && !didFitRef.current) {
      didFitRef.current = true;
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    }
  }, [nodes.length, fitView]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as CanvasTaskNodeData;
      if (data.isSentinel) return;
      const name = data.taskName;
      const next = name === selectedTaskName ? null : name;
      setSelectedTaskName(next);

      if (next && onTaskClick && diff) {
        const entry = diff.nodes.get(node.id);
        if (entry) onTaskClick(next, entry);
      }
    },
    [selectedTaskName, setSelectedTaskName, onTaskClick, diff],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedTaskName(null);
  }, [setSelectedTaskName]);

  const nodesWithSelection = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: (n.data as CanvasTaskNodeData).taskName === selectedTaskName,
      })),
    [nodes, selectedTaskName],
  );

  if (error) {
    return (
      <div className={cn("stg:flex stg:h-full stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:px-6 stg:text-center", className)}>
        <p className="stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]">{error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className={cn("stg:flex stg:h-full stg:items-center stg:justify-center stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No changes to display
      </div>
    );
  }

  return (
    <WorkflowGraphModeProvider mode="diff">
      <div className={cn("stg:relative stg:h-full stg:w-full", className)}>
        {diff && (
          <div className="stg:absolute stg:left-3 stg:top-3 stg:z-50">
            <DiffSummaryBar diff={diff} />
          </div>
        )}
        <ReactFlow
          id={flowId}
          nodes={nodesWithSelection}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          panOnDrag={true}
          zoomOnScroll={true}
          fitView={false}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </WorkflowGraphModeProvider>
  );
}
