"use client";

import { useMemo, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import { yamlToGraph, toReactFlowElements } from "./workflow-graph-conversions.js";
import type { CanvasTaskNodeData, CanvasTransitionEdgeData } from "./workflow-graph-conversions.js";
import { applyDagreLayout } from "./layout/index.js";
import { computeGraphDiff, buildDiffGraph } from "./diff/index.js";
import type { GraphDiff, NodeDiffEntry } from "./diff/index.js";

/** Options for {@link useWorkflowDiffGraph}. */
export interface UseWorkflowDiffGraphOptions {
  /** YAML content of the original (before) workflow. Empty string for generate scenarios. */
  readonly beforeYaml: string;
  /** YAML content of the updated (after) workflow. */
  readonly afterYaml: string;
}

/** Return value of {@link useWorkflowDiffGraph}. */
export interface UseWorkflowDiffGraphReturn {
  /** React Flow nodes with diff state merged into data. */
  readonly nodes: Node[];
  /** React Flow edges with diff state merged into data. */
  readonly edges: Edge[];
  /** Computed graph diff (null on error or empty input). */
  readonly diff: GraphDiff | null;
  /** Parse or build error message. */
  readonly error: string | null;
  /** Currently selected task name. */
  readonly selectedTaskName: string | null;
  /** Set the selected task. */
  readonly setSelectedTaskName: (name: string | null) => void;
}

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

/**
 * Behavior hook that builds a complete diff visualization from two YAML strings.
 *
 * Pipeline (all in useMemo for referential stability — DD-010):
 * 1. Parse beforeYaml → before graph model (empty string → empty model)
 * 2. Parse afterYaml → after graph model
 * 3. Compute diff between before and after
 * 4. Build merged graph containing all nodes/edges
 * 5. Apply dagre layout to merged graph
 * 6. Convert to React Flow elements
 * 7. Merge diff status into node/edge data
 *
 * @since T14 (AI-Assisted Workflow Creation)
 */
export function useWorkflowDiffGraph(
  options: UseWorkflowDiffGraphOptions,
): UseWorkflowDiffGraphReturn {
  const { beforeYaml, afterYaml } = options;
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  const result = useMemo(() => {
    // Both empty → no diff
    if (!afterYaml.trim()) {
      return { nodes: EMPTY_NODES, edges: EMPTY_EDGES, diff: null, error: null };
    }

    try {
      const afterGraph = yamlToGraph(afterYaml);

      // Empty before → generate scenario: all nodes are "added"
      if (!beforeYaml.trim()) {
        const emptyBefore = {
          document: afterGraph.document,
          nodes: [],
          edges: [],
        };
        const diff = computeGraphDiff(emptyBefore, afterGraph);
        const merged = buildDiffGraph(emptyBefore, afterGraph, diff);
        const laidOut = applyDagreLayout(merged);
        const elements = toReactFlowElements(laidOut);
        return {
          ...mergeOverlays(elements, diff),
          diff,
          error: null,
        };
      }

      const beforeGraph = yamlToGraph(beforeYaml);
      const diff = computeGraphDiff(beforeGraph, afterGraph);
      const merged = buildDiffGraph(beforeGraph, afterGraph, diff);
      const laidOut = applyDagreLayout(merged);
      const elements = toReactFlowElements(laidOut);

      return {
        ...mergeOverlays(elements, diff),
        diff,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to compute diff";
      return { nodes: EMPTY_NODES, edges: EMPTY_EDGES, diff: null, error: message };
    }
  }, [beforeYaml, afterYaml]);

  return {
    nodes: result.nodes,
    edges: result.edges,
    diff: result.diff,
    error: result.error,
    selectedTaskName,
    setSelectedTaskName,
  };
}

// ---------------------------------------------------------------------------
// Overlay merging
// ---------------------------------------------------------------------------

function mergeOverlays(
  elements: { nodes: Node[]; edges: Edge[] },
  diff: GraphDiff,
): { nodes: Node[]; edges: Edge[] } {
  const nodes = elements.nodes.map((node) => {
    const nodeData = node.data as CanvasTaskNodeData;
    const entry = diff.nodes.get(node.id);
    if (!entry) return node;

    return {
      ...node,
      data: {
        ...nodeData,
        diffState: {
          status: entry.status,
          changedFields: entry.changedFields,
        },
      },
      draggable: false,
      connectable: false,
      deletable: false,
    };
  });

  const edges = elements.edges.map((edge) => {
    const edgeData = (edge.data ?? {}) as CanvasTransitionEdgeData;
    const edgeKey = edge.data?.sourceHandle
      ? `${edge.source}|${edge.target}|${(edge as { sourceHandle?: string }).sourceHandle}`
      : `${edge.source}|${edge.target}`;

    const entry = diff.edges.get(edgeKey);
    if (!entry) return edge;

    return {
      ...edge,
      data: {
        ...edgeData,
        diffState: entry.status,
      },
    };
  });

  return { nodes, edges };
}

export type { GraphDiff, NodeDiffEntry };
