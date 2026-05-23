"use client";

import "@xyflow/react/dist/style.css";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowNode } from "./WorkflowNode";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge";
import { CANVAS_TASK_NODE_TYPE, CANVAS_TRANSITION_EDGE_TYPE } from "./workflow-graph-conversions";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { WorkflowGraphModeProvider } from "./WorkflowGraphModeContext";
import { useWorkflowOverviewGraph } from "./useWorkflowOverviewGraph";
import { WorkflowNodePopover } from "./WorkflowNodePopover";
import { getVisualSpec } from "./task-type-visual-registry";

/** Props for {@link WorkflowOverviewGraph}. */
export interface WorkflowOverviewGraphProps {
  /** The workflow blueprint to visualize. */
  readonly workflow: Workflow | null | undefined;
  /**
   * Called when the user clicks "Open in editor" in the node popover.
   * Receives the task name so the caller can activate the editor tab
   * and select the corresponding node.
   */
  readonly onOpenInEditor?: (taskName: string) => void;
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
 * Read-only interactive workflow graph for the overview context.
 *
 * Renders the workflow blueprint in a React Flow canvas using the unified
 * `WorkflowNode` / `CanvasTransitionEdge` rendering system in `"overview"` mode.
 * Supports pan, zoom, minimap, and a click-to-inspect popover on task nodes.
 *
 * Designed for embedding in both the Stigmer Console and third-party
 * dashboards — no routing, auth, or app-shell dependencies (DD-004).
 *
 * @example
 * ```tsx
 * <WorkflowOverviewGraph
 *   workflow={workflow}
 *   onOpenInEditor={(taskName) => switchToEditorTab(taskName)}
 * />
 * ```
 */
export const WorkflowOverviewGraph = memo(function WorkflowOverviewGraph(
  props: WorkflowOverviewGraphProps,
) {
  return (
    <ReactFlowProvider>
      <WorkflowOverviewGraphInner {...props} />
    </ReactFlowProvider>
  );
});

function WorkflowOverviewGraphInner({
  workflow,
  onOpenInEditor,
  className,
}: WorkflowOverviewGraphProps) {
  const {
    nodesWithSelection,
    edges,
    selectedTaskName,
    setSelectedTaskName,
  } = useWorkflowOverviewGraph({ workflow });

  const { fitView } = useReactFlow();
  const didFitRef = useRef(false);

  const [popoverAnchor, setPopoverAnchor] = useState<{
    x: number;
    y: number;
    data: CanvasTaskNodeData;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (nodesWithSelection.length > 0 && !didFitRef.current) {
      didFitRef.current = true;
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    }
  }, [nodesWithSelection.length, fitView]);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const data = node.data as CanvasTaskNodeData;
      if (data.isSentinel) return;

      const name = data.taskName;
      const isDeselect = name === selectedTaskName;

      if (isDeselect) {
        setSelectedTaskName(null);
        setPopoverAnchor(null);
        return;
      }

      setSelectedTaskName(name);

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setPopoverAnchor({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          data,
        });
      }
    },
    [selectedTaskName, setSelectedTaskName],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedTaskName(null);
    setPopoverAnchor(null);
  }, [setSelectedTaskName]);

  const handlePopoverClose = useCallback(() => {
    setSelectedTaskName(null);
    setPopoverAnchor(null);
  }, [setSelectedTaskName]);

  if (!workflow?.spec?.tasks?.length) {
    return (
      <div className={cn("flex h-full items-center justify-center text-sm text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No tasks to visualize
      </div>
    );
  }

  if (nodesWithSelection.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center", className)}>
        <GraphLoadingSkeleton />
      </div>
    );
  }

  return (
    <WorkflowGraphModeProvider mode="overview">
      <div ref={containerRef} className={cn("relative h-full w-full", className)}>
        <ReactFlow
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
          <MiniMap pannable zoomable />
        </ReactFlow>

        {popoverAnchor && (
          <WorkflowNodePopover
            data={popoverAnchor.data}
            x={popoverAnchor.x}
            y={popoverAnchor.y}
            onClose={handlePopoverClose}
            onOpenInEditor={onOpenInEditor}
          />
        )}
      </div>
    </WorkflowGraphModeProvider>
  );
}

function GraphLoadingSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="h-3 w-24 animate-pulse rounded bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="mt-2 flex gap-4">
        <div className="h-10 w-32 animate-pulse rounded-md bg-[var(--stgm-muted,#e5e5e5)]" />
        <div className="h-10 w-32 animate-pulse rounded-md bg-[var(--stgm-muted,#e5e5e5)]" />
      </div>
    </div>
  );
}
