// ---------------------------------------------------------------------------
// Types (public API for platform builders implementing custom engines)
// ---------------------------------------------------------------------------

export type {
  LayoutEngine,
  LayoutInput,
  LayoutResult,
  LayoutScope,
  LayoutOptions,
  NodeDimensions,
  Position2D,
  NodePortAssignment,
  PortDefinition,
  PortSide,
} from "./types";

// ---------------------------------------------------------------------------
// Engine factories
// ---------------------------------------------------------------------------

export { createDagreLayoutEngine } from "./dagre-layout-engine";
export { createElkLayoutEngine } from "./elk-layout-engine";
export type { ElkLayoutEngineOptions } from "./elk-layout-engine";

// ---------------------------------------------------------------------------
// React behavior hooks
// ---------------------------------------------------------------------------

export { useWorkflowLayout } from "./use-workflow-layout";
export type { UseWorkflowLayoutOptions, UseWorkflowLayoutReturn } from "./use-workflow-layout";

export { useElkLayoutEngine } from "./useElkLayoutEngine";
export type { UseElkLayoutEngineOptions } from "./useElkLayoutEngine";

// ---------------------------------------------------------------------------
// Synchronous layout utility (shared by editor and execution graph)
// ---------------------------------------------------------------------------

export { applyDagreLayout } from "./apply-dagre-layout";

// ---------------------------------------------------------------------------
// Registry-aware node dimensions (canonical adapter from visual registry)
// ---------------------------------------------------------------------------

export { registryNodeDimensions } from "./registry-dimensions";

// ---------------------------------------------------------------------------
// Preprocessor (exported for advanced use cases and testing)
// ---------------------------------------------------------------------------

export { preprocessForElk, ELK_WORKFLOW_DEFAULTS } from "./workflow-preprocessor";
export { computePortAssignments, computeNodePorts } from "./port-assignment";
export { postprocessElkResult } from "./layout-postprocessor";
