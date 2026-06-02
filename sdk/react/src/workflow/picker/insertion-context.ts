/**
 * Describes the semantic context of a task insertion operation.
 *
 * Every `+` interaction on the canvas produces an `InsertionContext` that
 * tells the picker what kind of insertion is intended, what the surrounding
 * graph topology looks like, and which node triggered it. The picker uses
 * this to generate contextual suggestions, filter incompatible kinds, and
 * render an appropriate header.
 */

/** The semantic meaning of the `+` that was clicked. */
export type InsertionMode =
  | "edge-splice"
  | "append-after"
  | "add-at-position"
  | "add-switch-case"
  | "add-fork-branch"
  | "add-catch-handler";

/**
 * Full context for a task insertion operation.
 *
 * Produced by the canvas interaction layer and consumed by the picker
 * intelligence (suggestions, compatibility, header text).
 */
export interface InsertionContext {
  /** Which insertion mode the user triggered. */
  readonly mode: InsertionMode;
  /** The node upstream of the insertion point (source of the edge, or the node with `+`). */
  readonly sourceNodeId?: string;
  /** The task kind of the source node (for suggestion lookup). */
  readonly sourceKind?: string;
  /** The display name of the source node (for contextual header). */
  readonly sourceDisplayName?: string;
  /** The node downstream of the insertion point (target of the edge being spliced). */
  readonly targetNodeId?: string;
  /** The display name of the target node (for contextual header). */
  readonly targetDisplayName?: string;
  /** The edge being spliced (for edge-splice mode). */
  readonly edgeId?: string;
  /** If inserting inside a container (for_each, try_catch), the container's kind. */
  readonly parentContainerKind?: string;
}

/**
 * Builds a human-readable header string describing the insertion action.
 *
 * Examples:
 * - "Insert between classify_ticket and route_by_severity"
 * - "Add after run_analyst"
 * - "Add case to classify_user"
 * - "Add parallel branch"
 */
export function buildInsertionHeader(context: InsertionContext): string {
  switch (context.mode) {
    case "edge-splice": {
      const src = context.sourceDisplayName ?? context.sourceNodeId ?? "…";
      const tgt = context.targetDisplayName ?? context.targetNodeId ?? "…";
      return `Insert between ${src} and ${tgt}`;
    }
    case "append-after": {
      const src = context.sourceDisplayName ?? context.sourceNodeId ?? "…";
      return `Add after ${src}`;
    }
    case "add-at-position":
      return "Add task";
    case "add-switch-case": {
      const src = context.sourceDisplayName ?? context.sourceNodeId ?? "switch";
      return `Add case to ${src}`;
    }
    case "add-fork-branch": {
      const src = context.sourceDisplayName ?? context.sourceNodeId ?? "fork";
      return `Add branch to ${src}`;
    }
    case "add-catch-handler": {
      const src = context.sourceDisplayName ?? context.sourceNodeId ?? "try/catch";
      return `Add catch handler to ${src}`;
    }
  }
}
