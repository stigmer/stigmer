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
} from "./types.js";

// ---------------------------------------------------------------------------
// Engine factories
// ---------------------------------------------------------------------------

export { createDagreLayoutEngine } from "./dagre-layout-engine.js";
export { createElkLayoutEngine } from "./elk-layout-engine.js";
export type { ElkLayoutEngineOptions } from "./elk-layout-engine.js";

// ---------------------------------------------------------------------------
// React behavior hooks
// ---------------------------------------------------------------------------

export { useWorkflowLayout } from "./use-workflow-layout.js";
export type { UseWorkflowLayoutOptions, UseWorkflowLayoutReturn } from "./use-workflow-layout.js";

export { useElkLayoutEngine } from "./useElkLayoutEngine.js";
export type { UseElkLayoutEngineOptions } from "./useElkLayoutEngine.js";

// ---------------------------------------------------------------------------
// Synchronous layout utility (shared by editor and execution graph)
// ---------------------------------------------------------------------------

export { applyDagreLayout } from "./apply-dagre-layout.js";
export type { DagreLayoutConfig } from "../canvas-constants.js";

// ---------------------------------------------------------------------------
// Registry-aware node dimensions (canonical adapter from visual registry)
// ---------------------------------------------------------------------------

export { registryNodeDimensions } from "./registry-dimensions.js";

// ---------------------------------------------------------------------------
// Preprocessor (exported for advanced use cases and testing)
// ---------------------------------------------------------------------------

export { preprocessForElk, ELK_WORKFLOW_DEFAULTS } from "./workflow-preprocessor.js";
export { computePortAssignments, computeNodePorts } from "./port-assignment.js";
export { postprocessElkResult } from "./layout-postprocessor.js";
