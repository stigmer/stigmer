"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  SelectionMode,
} from "@xyflow/react";
import type {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  IsValidConnection,
} from "@xyflow/react";
import { WorkflowNode } from "./WorkflowNode.js";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge.js";
import { CATEGORY_COLORS } from "./canvas-constants.js";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";
import { CANVAS_TASK_NODE_TYPE, CANVAS_TRANSITION_EDGE_TYPE } from "./workflow-graph-conversions.js";

interface WorkflowCanvasInnerProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void;
  onPaneClick: () => void;
  onConnect: OnConnect;
  isValidConnection: IsValidConnection;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onNodesDelete: (nodes: Node[]) => void;
  onEdgesDelete: (edges: Edge[]) => void;
  onNodeContextMenu?: (event: React.MouseEvent, node: Node) => void;
  onEdgeContextMenu?: (event: React.MouseEvent, edge: Edge) => void;
  onPaneContextMenu?: (event: React.MouseEvent | MouseEvent) => void;
  onSelectionContextMenu?: (event: React.MouseEvent, nodes: Node[]) => void;
  nodeErrors?: ReadonlyMap<string, readonly string[]>;
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

const DELETE_KEY_CODES = ["Backspace", "Delete"];

/**
 * Inner React Flow canvas, loaded via React.lazy from WorkflowCanvasEditor.
 *
 * Isolated into its own file so that `@xyflow/react` (and its CSS) are only
 * included in the bundle when the canvas editor is actually rendered.
 *
 * @internal
 */
export function WorkflowCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onConnect,
  isValidConnection,
  onDrop,
  onDragOver,
  onNodesDelete,
  onEdgesDelete,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onSelectionContextMenu,
  nodeErrors,
}: WorkflowCanvasInnerProps) {
  const enrichedNodes = useMemo(() => {
    if (!nodeErrors || nodeErrors.size === 0) return nodes;
    return nodes.map((node) => {
      const data = node.data as CanvasTaskNodeData | undefined;
      const errors = data?.taskName ? nodeErrors.get(data.taskName) : undefined;
      if (!errors || errors.length === 0) return node;
      return { ...node, data: { ...node.data, errorCount: errors.length } };
    });
  }, [nodes, nodeErrors]);

  const minimapNodeColor = useMemo(
    () => (node: Node) => {
      const data = node.data as CanvasTaskNodeData | undefined;
      const category = data?.category;
      if (!category) return "var(--stgm-muted-foreground, #737373)";
      return CATEGORY_COLORS[category] ?? "var(--stgm-muted-foreground, #737373)";
    },
    [],
  );

  return (
    <ReactFlow
      nodes={enrichedNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onNodesDelete={onNodesDelete}
      onEdgesDelete={onEdgesDelete}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
      onSelectionContextMenu={onSelectionContextMenu}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      deleteKeyCode={DELETE_KEY_CODES}
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode="Shift"
      panOnDrag={[1, 2]}
      selectionOnDrag
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
      className="stg:h-full stg:w-full"
    >
      <Controls
        showInteractive={false}
        className="stg:!border-[var(--stgm-border-prominent,#d4d4d8)] stg:!bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:!shadow-sm stg:[&>button]:!border-[var(--stgm-border-prominent,#d4d4d8)] stg:[&>button]:!bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:[&>button]:!fill-[var(--stgm-foreground,#1a1a2e)] stg:[&>button:hover]:!bg-[var(--stgm-muted,#f5f5f5)]"
      />
      <MiniMap
        nodeColor={minimapNodeColor}
        maskColor="var(--stgm-muted, rgba(245, 245, 245, 0.7))"
        className="stg:!border-[var(--stgm-border-prominent,#d4d4d8)] stg:!bg-[var(--stgm-card,var(--stgm-background,#fff))]"
      />
      <Background
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1}
        color="var(--stgm-muted-foreground, #737373)"
      />
    </ReactFlow>
  );
}
