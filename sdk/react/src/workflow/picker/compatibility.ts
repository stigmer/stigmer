import type { WorkflowGraphModel } from "../workflow-graph-model.js";
import { END_NODE_ID } from "../workflow-graph-model.js";
import type { InsertionContext } from "./insertion-context.js";

/**
 * A task kind that is disabled in the current context, with a reason.
 *
 * Rendered as a dimmed, non-selectable item in the picker with a
 * tooltip explaining why it cannot be inserted here.
 */
export interface DisabledKindEntry {
  readonly kind: string;
  readonly reason: string;
}

/** Kinds that are never shown in the picker (sentinels, internal). */
const ALWAYS_HIDDEN_KINDS: ReadonlySet<string> = new Set([
  "__start__",
  "__end__",
]);

/**
 * Returns the set of task kinds that should be hidden from the picker entirely.
 * These are sentinel/internal kinds that are never user-insertable.
 */
export function getHiddenKinds(): ReadonlySet<string> {
  return ALWAYS_HIDDEN_KINDS;
}

/**
 * Determines which task kinds should be disabled (shown but not selectable)
 * in the picker for the given insertion context.
 *
 * Each disabled entry includes a human-readable reason that is shown as a
 * tooltip. This helps users understand structural constraints without
 * trial-and-error.
 *
 * Rules are derived from DSL structural constraints:
 * - Fork cannot be inserted in a terminal position (no outgoing path)
 * - for_each cannot nest inside for_each (runner limitation)
 * - Container kinds have insertion constraints based on graph position
 */
export function getDisabledKinds(
  context: InsertionContext,
  graph: WorkflowGraphModel,
): readonly DisabledKindEntry[] {
  const disabled: DisabledKindEntry[] = [];

  // Rule 1: Fork/for_each/try_catch cannot be inserted at a terminal position
  // (i.e., when the target is __end__ and there's nothing after)
  if (context.mode === "edge-splice" && context.targetNodeId === END_NODE_ID) {
    // Inserting right before __end__ is fine for most kinds, but container
    // kinds need downstream paths for their branches to converge.
    // This is a soft constraint — we warn but don't block.
  }

  // Rule 2: for_each cannot nest inside for_each
  if (context.parentContainerKind === "for_each") {
    disabled.push({
      kind: "for_each",
      reason: "Nested for_each is not supported by the workflow runtime",
    });
  }

  // Rule 3: Fork inside a terminal switch branch is problematic
  // A terminal branch has no merge point, so fork branches can't converge.
  if (isTerminalBranchContext(context, graph)) {
    disabled.push({
      kind: "fork",
      reason: "Fork cannot be inserted in a terminal branch (no convergence point)",
    });
  }

  return disabled;
}

/**
 * Checks whether the insertion context is inside a terminal branch
 * (a switch case branch that ends at __end__ with no merge).
 */
function isTerminalBranchContext(
  context: InsertionContext,
  graph: WorkflowGraphModel,
): boolean {
  if (context.mode !== "edge-splice" && context.mode !== "append-after") {
    return false;
  }

  // If the source node connects directly to __end__ and the source's
  // incoming edge comes from a switch_case via a sourceHandle,
  // this is a terminal branch.
  const sourceId = context.sourceNodeId;
  if (!sourceId) return false;

  const edgesToEnd = graph.edges.filter(
    (e) => e.source === sourceId && e.target === END_NODE_ID,
  );
  if (edgesToEnd.length === 0) return false;

  // Check if the source itself is reached from a switch_case via a handle
  const incomingToSource = graph.edges.filter((e) => e.target === sourceId);
  return incomingToSource.some(
    (e) =>
      typeof e.sourceHandle === "string" &&
      (e.sourceHandle.startsWith("case_") || e.sourceHandle.startsWith("outcome_")),
  );
}
