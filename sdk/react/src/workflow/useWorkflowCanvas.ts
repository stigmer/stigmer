"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNodesState, useEdgesState } from "@xyflow/react";
import type { Node, Edge, OnNodesChange, OnEdgesChange } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { WorkflowGraphModel, WorkflowGraphNode } from "./workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model";
import { yamlToGraph, toReactFlowElements } from "./workflow-graph-conversions";
import { DAGRE_CONFIG, CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT, SENTINEL_NODE_WIDTH, SENTINEL_NODE_HEIGHT } from "./canvas-constants";

/** Selection state for the canvas inspector. */
export interface CanvasSelection {
  readonly type: "node" | "edge";
  readonly id: string;
}

/** Return value of {@link useWorkflowCanvas}. */
export interface UseWorkflowCanvasReturn {
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly onNodesChange: OnNodesChange;
  readonly onEdgesChange: OnEdgesChange;
  readonly selection: CanvasSelection | null;
  readonly selectNode: (id: string) => void;
  readonly selectEdge: (id: string) => void;
  readonly clearSelection: () => void;
  readonly autoLayout: () => void;
  readonly isDirty: boolean;
  readonly graph: WorkflowGraphModel | null;
  readonly error: string | null;
}

/**
 * Orchestrator hook for the workflow canvas editor.
 *
 * Initializes a `WorkflowGraphModel` from YAML, converts it to React Flow
 * elements, manages node positions via React Flow's state, and tracks
 * dirty state by comparing current node positions against the initial layout.
 *
 * @param yaml - The workflow YAML to render. Changes trigger a full re-parse.
 *
 * @since T15 (Visual Canvas Editor)
 */
export function useWorkflowCanvas(yaml: string | null): UseWorkflowCanvasReturn {
  const [graph, setGraph] = useState<WorkflowGraphModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const initialGraphRef = useRef<WorkflowGraphModel | null>(null);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState([] as Edge[]);

  const positionsChangedRef = useRef(false);

  // Parse YAML → graph → React Flow elements on YAML changes
  useEffect(() => {
    if (!yaml?.trim()) {
      setGraph(null);
      setError(null);
      setNodes([]);
      setEdges([]);
      initialGraphRef.current = null;
      return;
    }

    try {
      const parsed = yamlToGraph(yaml);
      const laidOut = applyDagreLayout(parsed);
      setGraph(laidOut);
      initialGraphRef.current = laidOut;
      setError(null);

      const elements = toReactFlowElements(laidOut);
      setNodes(elements.nodes);
      setEdges(elements.edges);
      positionsChangedRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse workflow YAML.");
      setGraph(null);
      setNodes([]);
      setEdges([]);
    }
  }, [yaml, setNodes, setEdges]);

  // Wrap onNodesChange to track position-based dirty state
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChangeRaw(changes);
      const hasPositionChange = changes.some(
        (c) => c.type === "position" && "dragging" in c && c.dragging === false,
      );
      if (hasPositionChange) {
        positionsChangedRef.current = true;
      }
    },
    [onNodesChangeRaw],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeRaw(changes);
    },
    [onEdgesChangeRaw],
  );

  const selectNode = useCallback((id: string) => {
    setSelection({ type: "node", id });
  }, []);

  const selectEdge = useCallback((id: string) => {
    setSelection({ type: "edge", id });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const autoLayout = useCallback(() => {
    if (!graph) return;
    const laidOut = applyDagreLayout(graph);
    setGraph(laidOut);
    const elements = toReactFlowElements(laidOut);
    setNodes(elements.nodes);
    positionsChangedRef.current = false;
  }, [graph, setNodes]);

  const isDirty = positionsChangedRef.current;

  return useMemo(
    () => ({
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      selection,
      selectNode,
      selectEdge,
      clearSelection,
      autoLayout,
      isDirty,
      graph,
      error,
    }),
    [nodes, edges, onNodesChange, onEdgesChange, selection, selectNode, selectEdge, clearSelection, autoLayout, isDirty, graph, error],
  );
}

// ---------------------------------------------------------------------------
// Dagre layout
// ---------------------------------------------------------------------------

function applyDagreLayout(graph: WorkflowGraphModel): WorkflowGraphModel {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: DAGRE_CONFIG.rankdir,
    ranksep: DAGRE_CONFIG.ranksep,
    nodesep: DAGRE_CONFIG.nodesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
    g.setNode(node.id, {
      width: isSentinel ? SENTINEL_NODE_WIDTH : CANVAS_NODE_WIDTH,
      height: isSentinel ? SENTINEL_NODE_HEIGHT : CANVAS_NODE_HEIGHT,
    });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes: WorkflowGraphNode[] = graph.nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
    const w = isSentinel ? SENTINEL_NODE_WIDTH : CANVAS_NODE_WIDTH;
    const h = isSentinel ? SENTINEL_NODE_HEIGHT : CANVAS_NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: (dagreNode?.x ?? 0) - w / 2,
        y: (dagreNode?.y ?? 0) - h / 2,
      },
    };
  });

  return { ...graph, nodes: layoutNodes };
}
