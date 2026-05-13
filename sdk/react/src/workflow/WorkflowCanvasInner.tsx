"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import type { Node, Edge, OnNodesChange, OnEdgesChange } from "@xyflow/react";
import { CanvasTaskNode } from "./CanvasTaskNode";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge";
import { CATEGORY_COLORS } from "./canvas-constants";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { CANVAS_TASK_NODE_TYPE, CANVAS_TRANSITION_EDGE_TYPE } from "./workflow-graph-conversions";

interface WorkflowCanvasInnerProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void;
  onPaneClick: () => void;
}

const nodeTypes = {
  [CANVAS_TASK_NODE_TYPE]: CanvasTaskNode,
} as const;

const edgeTypes = {
  [CANVAS_TRANSITION_EDGE_TYPE]: CanvasTransitionEdge,
} as const;

const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
};

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
}: WorkflowCanvasInnerProps) {
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
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
      className="h-full w-full"
    >
      <Controls
        showInteractive={false}
        className="!border-[var(--stgm-border,#d4d4d8)] !bg-[var(--stgm-background,#fff)] !shadow-sm [&>button]:!border-[var(--stgm-border,#d4d4d8)] [&>button]:!bg-[var(--stgm-background,#fff)] [&>button:hover]:!bg-[var(--stgm-muted,#f5f5f5)]"
      />
      <MiniMap
        nodeColor={minimapNodeColor}
        maskColor="var(--stgm-muted, rgba(245, 245, 245, 0.7))"
        className="!border-[var(--stgm-border,#d4d4d8)] !bg-[var(--stgm-background,#fff)]"
      />
      <Background
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1}
        color="var(--stgm-border, #d4d4d8)"
      />
    </ReactFlow>
  );
}
