"use client";

import { memo, useEffect, useMemo, useRef } from "react";
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
import type { Node, Edge } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import { WorkflowNode } from "./WorkflowNode.js";
import { CanvasTransitionEdge } from "./CanvasTransitionEdge.js";
import {
  CANVAS_TASK_NODE_TYPE,
  CANVAS_TRANSITION_EDGE_TYPE,
  yamlToGraph,
  toReactFlowElements,
} from "./workflow-graph-conversions.js";
import { applyDagreLayout } from "./layout/index.js";
import { WorkflowGraphModeProvider } from "./WorkflowGraphModeContext.js";

/** Props for {@link WorkflowCodePreviewGraph}. */
export interface WorkflowCodePreviewGraphProps {
  /** Workflow YAML to visualize. */
  readonly yaml: string | null;
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
 * Read-only React Flow graph preview for the code-mode editor side panel.
 *
 * Accepts YAML directly (unlike `WorkflowOverviewGraph` which requires
 * a `Workflow` proto). Uses the unified `WorkflowNode` / `CanvasTransitionEdge`
 * rendering system in `"overview"` mode for DD-001 consistency.
 */
export const WorkflowCodePreviewGraph = memo(function WorkflowCodePreviewGraph(
  props: WorkflowCodePreviewGraphProps,
) {
  return (
    <ReactFlowProvider>
      <WorkflowCodePreviewGraphInner {...props} />
    </ReactFlowProvider>
  );
});

function WorkflowCodePreviewGraphInner({
  yaml,
  className,
}: WorkflowCodePreviewGraphProps) {
  const { nodes, edges } = useYamlToReactFlow(yaml);
  const { fitView } = useReactFlow();
  const didFitRef = useRef(false);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (nodes.length > 0 && nodes.length !== prevCountRef.current) {
      prevCountRef.current = nodes.length;
      setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 50);
    } else if (nodes.length > 0 && !didFitRef.current) {
      didFitRef.current = true;
      setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 50);
    }
  }, [nodes.length, fitView]);

  if (!yaml?.trim() || nodes.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center text-sm text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No tasks to visualize
      </div>
    );
  }

  return (
    <WorkflowGraphModeProvider mode="overview">
      <div className={cn("h-full w-full", className)}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
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
      </div>
    </WorkflowGraphModeProvider>
  );
}

function useYamlToReactFlow(yaml: string | null): { nodes: Node[]; edges: Edge[] } {
  return useMemo(() => {
    if (!yaml?.trim()) return { nodes: [], edges: [] };
    try {
      const graph = yamlToGraph(yaml);
      const laid = applyDagreLayout(graph);
      return toReactFlowElements(laid);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [yaml]);
}
