import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model";

// ---------------------------------------------------------------------------
// Layout Engine
// ---------------------------------------------------------------------------

/**
 * A layout algorithm that computes node positions for a workflow graph.
 *
 * Implementations must be deterministic — the same input always produces
 * the same output. This invariant is enforced in tests.
 *
 * The interface is pure TypeScript with no React dependency so it can be
 * used in server-side rendering, CLI tooling, or non-React frameworks.
 */
export interface LayoutEngine {
  readonly name: string;
  layout(input: LayoutInput): Promise<LayoutResult>;
  /**
   * Release any held resources (e.g. a Web Worker).
   * Called on unmount by the React hook layer.
   */
  terminate?(): void;
}

// ---------------------------------------------------------------------------
// Layout Input
// ---------------------------------------------------------------------------

export interface LayoutInput {
  readonly graph: WorkflowGraphModel;
  readonly scope: LayoutScope;
  /**
   * Node IDs whose positions should not change.
   * The engine computes layout for the full graph but the postprocessor
   * excludes pinned nodes from the result (AD-T03-005).
   */
  readonly pinnedNodeIds?: ReadonlySet<string>;
  /**
   * Provides per-node dimensions for the layout algorithm.
   * Defaults to fixed constants (CANVAS_NODE_WIDTH/HEIGHT) if not provided.
   * After T01 completes, this will be wired to the TaskTypeRegistry.
   */
  readonly getNodeDimensions?: (node: WorkflowGraphNode) => NodeDimensions;
}

export interface NodeDimensions {
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Layout Scope
// ---------------------------------------------------------------------------

/**
 * Determines which subset of nodes receive new positions.
 *
 * The engine always lays out the whole graph (ELK needs global context for
 * optimal crossing minimization). Scope filtering is applied in post-processing.
 */
export type LayoutScope =
  | { readonly type: "whole-graph" }
  | { readonly type: "selected"; readonly nodeIds: ReadonlySet<string> }
  | { readonly type: "downstream"; readonly fromNodeId: string };

// ---------------------------------------------------------------------------
// Layout Options
// ---------------------------------------------------------------------------

/**
 * User-configurable layout parameters.
 * Engines may ignore options they don't support.
 */
export interface LayoutOptions {
  readonly direction?: "TB" | "LR";
  readonly nodeSpacing?: number;
  readonly layerSpacing?: number;
}

// ---------------------------------------------------------------------------
// Layout Result
// ---------------------------------------------------------------------------

export interface LayoutResult {
  /** Map of node ID → computed top-left position. */
  readonly positions: ReadonlyMap<string, Readonly<Position2D>>;
  /** Optional edge bend-point paths (for orthogonal routing). */
  readonly edgePaths?: ReadonlyMap<string, ReadonlyArray<Position2D>>;
  /** Wall-clock time for the layout computation in milliseconds. */
  readonly durationMs: number;
  /** Name of the engine that produced this result. */
  readonly engine: string;
}

export interface Position2D {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Port Assignment
// ---------------------------------------------------------------------------

/** Complete port assignment for a single workflow node. */
export interface NodePortAssignment {
  readonly nodeId: string;
  readonly inputPorts: readonly PortDefinition[];
  readonly outputPorts: readonly PortDefinition[];
}

export interface PortDefinition {
  /** Deterministic port ID (e.g. `myNode__case_approved`). */
  readonly id: string;
  /** Which side of the node this port is placed on. */
  readonly side: PortSide;
  /** Human-readable label (shown on branch edges). */
  readonly label?: string;
  /** Order index for left-to-right (or top-to-bottom) ordering within a side. */
  readonly index: number;
}

export type PortSide = "NORTH" | "SOUTH" | "EAST" | "WEST";

// ---------------------------------------------------------------------------
// ELK Graph Types (subset used by the preprocessor)
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the ELK JSON graph format consumed by elkjs.
 * Kept here so the preprocessor and engine share a single type definition
 * without importing elkjs at the type level.
 */
export interface ElkGraph {
  readonly id: string;
  readonly layoutOptions?: Readonly<Record<string, string>>;
  readonly children: readonly ElkNode[];
  readonly edges: readonly ElkEdge[];
}

export interface ElkNode {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly layoutOptions?: Readonly<Record<string, string>>;
  readonly ports?: readonly ElkPort[];
  readonly labels?: readonly ElkLabel[];
}

export interface ElkPort {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly layoutOptions?: Readonly<Record<string, string>>;
}

export interface ElkEdge {
  readonly id: string;
  readonly sources: readonly string[];
  readonly targets: readonly string[];
}

export interface ElkLabel {
  readonly text: string;
  readonly width?: number;
  readonly height?: number;
}

/** ELK layout result — positions are set on children/ports after layout. */
export interface ElkLayoutResult {
  readonly id: string;
  readonly children?: readonly ElkLayoutNode[];
  readonly edges?: readonly ElkLayoutEdge[];
}

export interface ElkLayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ports?: readonly ElkLayoutPort[];
}

export interface ElkLayoutPort {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ElkLayoutEdge {
  readonly id: string;
  readonly sections?: readonly ElkEdgeSection[];
}

export interface ElkEdgeSection {
  readonly startPoint: Position2D;
  readonly endPoint: Position2D;
  readonly bendPoints?: readonly Position2D[];
}
