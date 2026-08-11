"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
} from "@xyflow/react";
import type { Node, NodeChange } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowNode } from "./WorkflowNode.js";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge.js";
import { CANVAS_TASK_NODE_TYPE, CANVAS_TRANSITION_EDGE_TYPE } from "./workflow-graph-conversions.js";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";
import { WorkflowGraphModeProvider } from "./WorkflowGraphModeContext.js";
import { useWorkflowOverviewGraph } from "./useWorkflowOverviewGraph.js";
import { WorkflowNodePopover } from "./WorkflowNodePopover.js";
import { getVisualSpec } from "./task-type-visual-registry.js";

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
  /**
   * Whether nodes can be dragged to rearrange the layout.
   * Useful in fullscreen/presentation contexts where the user wants to
   * manually position nodes for discussion. Does not persist changes.
   * @default false
   */
  readonly nodesDraggable?: boolean;
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
      <WorkflowOverviewGraphInner
        workflow={props.workflow}
        onOpenInEditor={props.onOpenInEditor}
        nodesDraggable={props.nodesDraggable}
        className={props.className}
      />
    </ReactFlowProvider>
  );
});

function WorkflowOverviewGraphInner({
  workflow,
  onOpenInEditor,
  nodesDraggable: draggable = false,
  className,
}: WorkflowOverviewGraphProps) {
  const {
    nodes: baseNodes,
    nodesWithSelection,
    edges,
    selectedTaskName,
    setSelectedTaskName,
  } = useWorkflowOverviewGraph({ workflow });

  const { fitView } = useReactFlow();
  const didFitRef = useRef(false);

  // Track drag-repositioned nodes. Keyed by node ID → position.
  // Resets when the underlying graph structure changes (workflow edited).
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    setDragPositions({});
  }, [baseNodes]);

  const displayNodes = useMemo(() => {
    if (!draggable || Object.keys(dragPositions).length === 0) {
      return nodesWithSelection;
    }
    return nodesWithSelection.map((n) => {
      const pos = dragPositions[n.id];
      return pos ? { ...n, position: pos } : n;
    });
  }, [nodesWithSelection, draggable, dragPositions]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!draggable) return;
      const posChanges = changes.filter(
        (c): c is NodeChange & { type: "position"; position: { x: number; y: number } } =>
          c.type === "position" && "position" in c && c.position != null,
      );
      if (posChanges.length === 0) return;
      setDragPositions((prev) => {
        const next = { ...prev };
        for (const c of posChanges) {
          next[c.id] = c.position;
        }
        return next;
      });
    },
    [draggable],
  );

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
      <div className={cn("stg:flex stg:h-full stg:items-center stg:justify-center stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No tasks to visualize
      </div>
    );
  }

  if (nodesWithSelection.length === 0) {
    return (
      <div className={cn("stg:flex stg:h-full stg:items-center stg:justify-center", className)}>
        <GraphLoadingSkeleton />
      </div>
    );
  }

  return (
    <WorkflowGraphModeProvider mode="overview">
      <div ref={containerRef} className={cn("stg:relative stg:h-full stg:w-full", className)}>
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={draggable ? handleNodesChange : undefined}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodesDraggable={draggable}
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
    <div className="stg:flex stg:flex-col stg:items-center stg:gap-3">
      <div className="stg:h-8 stg:w-8 stg:animate-pulse stg:rounded-full stg:bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="stg:h-3 stg:w-24 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="stg:mt-2 stg:flex stg:gap-4">
        <div className="stg:h-10 stg:w-32 stg:animate-pulse stg:rounded-md stg:bg-[var(--stgm-muted,#e5e5e5)]" />
        <div className="stg:h-10 stg:w-32 stg:animate-pulse stg:rounded-md stg:bg-[var(--stgm-muted,#e5e5e5)]" />
      </div>
    </div>
  );
}
