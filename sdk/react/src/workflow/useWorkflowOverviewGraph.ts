"use client";

import { useCallback, useMemo, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { serializeWorkflowYaml } from "./serialize-workflow-yaml.js";
import { yamlToGraph } from "./workflow-graph-conversions.js";
import { toReactFlowElements } from "./workflow-graph-conversions.js";
import { applyDagreLayout } from "./layout/index.js";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";

/** Options for {@link useWorkflowOverviewGraph}. */
export interface UseWorkflowOverviewGraphOptions {
  /**
   * The workflow blueprint to render. The hook serializes the spec to YAML,
   * converts it to a graph model, applies dagre layout, and produces
   * React Flow elements.
   *
   * When `null` or `undefined`, the hook returns empty arrays.
   */
  readonly workflow: Workflow | null | undefined;
}

/** Return value of {@link useWorkflowOverviewGraph}. */
export interface UseWorkflowOverviewGraphReturn {
  /** Positioned React Flow nodes, ready for rendering. */
  readonly nodes: Node[];
  /** React Flow edges connecting the nodes. */
  readonly edges: Edge[];
  /** Currently selected task name (null when nothing is selected). */
  readonly selectedTaskName: string | null;
  /** Update the selected task. Pass `null` to clear. */
  readonly setSelectedTaskName: (name: string | null) => void;
  /** React Flow nodes with `selected` property applied to match `selectedTaskName`. */
  readonly nodesWithSelection: Node[];
}

/**
 * Behavior hook that converts a `Workflow` blueprint into positioned
 * React Flow elements suitable for a read-only overview graph.
 *
 * Pipeline: `Workflow` → YAML → `yamlToGraph` → `applyDagreLayout` → `toReactFlowElements`
 *
 * Manages selected-node state for the click-to-inspect popover.
 *
 * @example
 * ```tsx
 * const { nodesWithSelection, edges, selectedTaskName, setSelectedTaskName } =
 *   useWorkflowOverviewGraph({ workflow });
 * ```
 */
export function useWorkflowOverviewGraph(
  options: UseWorkflowOverviewGraphOptions,
): UseWorkflowOverviewGraphReturn {
  const { workflow } = options;
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    if (!workflow?.spec?.tasks?.length) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }
    try {
      const yaml = serializeWorkflowYaml(workflow);
      const graph = yamlToGraph(yaml);
      const laid = applyDagreLayout(graph);
      return toReactFlowElements(laid);
    } catch {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }
  }, [workflow]);

  const nodesWithSelection = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: (n.data as CanvasTaskNodeData).taskName === selectedTaskName,
      })),
    [nodes, selectedTaskName],
  );

  const stableSetSelected = useCallback(
    (name: string | null) => setSelectedTaskName(name),
    [],
  );

  return {
    nodes,
    edges,
    selectedTaskName,
    setSelectedTaskName: stableSetSelected,
    nodesWithSelection,
  };
}
