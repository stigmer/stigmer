"use client";

import { memo, useMemo, useRef, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import dagre from "@dagrejs/dagre";
import type { TopologyNode, TopologyEdge, UseWorkflowTopologyReturn } from "./useWorkflowTopology";
import { CATEGORY_COLORS, DAGRE_CONFIG, GRAPH_PADDING } from "./canvas-constants";

/** Props for {@link WorkflowTopologyGraph}. */
export interface WorkflowTopologyGraphProps {
  /** Topology data from {@link useWorkflowTopology}. */
  readonly topology: UseWorkflowTopologyReturn;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Read-only SVG DAG renderer for workflow topology.
 *
 * Uses dagre for layered layout computation and renders nodes as
 * rounded rectangles with category-based coloring. Edges are drawn
 * as SVG paths with arrowhead markers.
 *
 * Supports mouse wheel zoom and drag-to-pan for large workflows.
 * All colors flow through `--stgm-*` tokens with sensible fallbacks.
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export const WorkflowTopologyGraph = memo(function WorkflowTopologyGraph({
  topology,
  className,
}: WorkflowTopologyGraphProps) {
  const { nodes, edges } = topology;
  const svgRef = useRef<SVGSVGElement>(null);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragState = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);

  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    return computeLayout(nodes, edges);
  }, [nodes, edges]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.2, Math.min(3, prev.scale * factor)),
    }));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
    };
  }, [transform.x, transform.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setTransform((prev) => ({
      ...prev,
      x: dragState.current!.startTx + dx,
      y: dragState.current!.startTy + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    dragState.current = null;
  }, []);

  if (!layout || nodes.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-sm text-muted-foreground", className)}>
        No tasks to visualize
      </div>
    );
  }

  const { layoutNodes, layoutEdges, width, height } = layout;

  return (
    <svg
      ref={svgRef}
      className={cn("h-full w-full cursor-grab select-none active:cursor-grabbing", className)}
      viewBox={`0 0 ${width + GRAPH_PADDING * 2} ${height + GRAPH_PADDING * 2}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      role="img"
      aria-label="Workflow topology graph"
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon
            points="0 0, 8 3, 0 6"
            fill="var(--stgm-border, #d4d4d8)"
          />
        </marker>
      </defs>

      <g transform={`translate(${GRAPH_PADDING + transform.x}, ${GRAPH_PADDING + transform.y}) scale(${transform.scale})`}>
        {layoutEdges.map((edge, i) => (
          <EdgePath key={i} edge={edge} />
        ))}

        {layoutNodes.map((node) => (
          <NodeRect key={node.id} node={node} />
        ))}
      </g>
    </svg>
  );
});

// ---------------------------------------------------------------------------
// Layout computation with dagre
// ---------------------------------------------------------------------------

interface LayoutResult {
  layoutNodes: TopologyNode[];
  layoutEdges: LayoutEdge[];
  width: number;
  height: number;
}

interface LayoutEdge {
  points: Array<{ x: number; y: number }>;
  label?: string;
}

function computeLayout(
  nodes: readonly TopologyNode[],
  edges: readonly TopologyEdge[],
): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: DAGRE_CONFIG.rankdir, ranksep: DAGRE_CONFIG.ranksep, nodesep: DAGRE_CONFIG.nodesep });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target, { label: edge.label });
  }

  dagre.layout(g);

  const layoutNodes: TopologyNode[] = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    return {
      ...node,
      x: dagreNode?.x ?? 0,
      y: dagreNode?.y ?? 0,
    };
  });

  const layoutEdges: LayoutEdge[] = edges.map((edge) => {
    const dagreEdge = g.edge(edge.source, edge.target);
    return {
      points: dagreEdge?.points ?? [],
      label: edge.label,
    };
  });

  const graphMeta = g.graph();
  const width = graphMeta?.width ?? 400;
  const height = graphMeta?.height ?? 300;

  return { layoutNodes, layoutEdges, width, height };
}

// ---------------------------------------------------------------------------
// SVG sub-components
// ---------------------------------------------------------------------------

function NodeRect({ node }: { readonly node: TopologyNode }) {
  const isTerminal = node.category === "start" || node.category === "end";
  const fill = isTerminal
    ? "var(--stgm-muted, #f5f5f5)"
    : "var(--stgm-background, #fff)";
  const stroke = CATEGORY_COLORS[node.category];
  const rx = isTerminal ? node.height / 2 : 6;

  return (
    <g>
      <rect
        x={node.x - node.width / 2}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx={rx}
        ry={rx}
        fill={fill}
        stroke={stroke}
        strokeWidth={isTerminal ? 1.5 : 2}
      />
      <text
        x={node.x}
        y={node.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={isTerminal ? 11 : 12}
        fontFamily="var(--stgm-font-sans, system-ui)"
        fontWeight={isTerminal ? 400 : 500}
        fill="var(--stgm-foreground, #1a1a2e)"
      >
        {truncateLabel(node.label, 20)}
      </text>
    </g>
  );
}

function EdgePath({ edge }: { readonly edge: LayoutEdge }) {
  if (edge.points.length < 2) return null;

  const d = edge.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  return (
    <path
      d={d}
      fill="none"
      stroke="var(--stgm-border, #d4d4d8)"
      strokeWidth={1.5}
      markerEnd="url(#arrowhead)"
    />
  );
}

function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + "\u2026";
}
