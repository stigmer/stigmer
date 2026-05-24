import { getVisualSpec } from "../task-type-visual-registry";
import { taskKindToString } from "../workflow-graph-conversions";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type { WorkflowGraphNode } from "../workflow-graph-model";
import type { NodeDimensions } from "./types";

/**
 * Resolves per-node dimensions from the visual registry (T01).
 *
 * This is the canonical adapter that bridges `WorkflowGraphNode` to the
 * `NodeDimensions` contract expected by layout engines. It handles both
 * sentinel nodes (`__start__`, `__end__`) and task nodes by delegating
 * to `getVisualSpec`, which returns shape-appropriate dimensions
 * (diamonds, bars, circles, octagons, containers, and cards).
 *
 * The returned height includes `captionHeight` — the space reserved for
 * the task name caption below non-rectangular shapes. This ensures the
 * layout engine allocates sufficient vertical spacing to prevent overlap
 * between caption text and subsequent nodes/edges.
 *
 * Defined at module scope — referentially stable with no closure over
 * React state. Safe to pass directly as `getNodeDimensions` without
 * wrapping in `useCallback` (DD-010).
 */
export function registryNodeDimensions(node: WorkflowGraphNode): NodeDimensions {
  const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
  const kindKey = isSentinel ? node.id : taskKindToString(node.kind);
  const spec = getVisualSpec(kindKey);
  return { width: spec.defaultWidth, height: spec.defaultHeight + spec.captionHeight };
}
