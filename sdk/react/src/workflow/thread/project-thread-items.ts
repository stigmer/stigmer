/**
 * Pure projection from the event store's derived task-state map to the
 * ordered card list the workflow task thread renders.
 *
 * Deliberately NOT a second event-log derivation (D-T02-4): the event log
 * already has its canonical walk (`deriveTaskStates` in the store). This
 * module only re-shapes the store's cached map. Thread order is the map's
 * insertion order, which
 * `deriveTaskStates` builds in first-event order (`Map.set` on an existing
 * key preserves position) — the flat start-order model of D-T02-1 with no
 * second ordering source to drift.
 *
 * No React dependency — independently importable and testable (DD-003).
 *
 * @since S8 (Workflow Task Thread)
 */

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { kindToDisplayName } from "../kind-metadata.js";
import { taskKindToString } from "../workflow-graph-conversions.js";
import {
  threadCardVariant,
  type WorkflowThreadCardVariant,
} from "./thread-presentation.js";
import {
  resolveTaskPreview,
  type WorkflowTaskDisclosure,
} from "./task-presentation.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One task card in the thread — a flat, display-ready projection of a
 * `DerivedTaskState`. Fields are copied (not referenced) so value equality
 * is a shallow field compare, which powers the structural sharing below.
 */
export interface WorkflowThreadItem {
  readonly taskName: string;
  readonly taskKind: WorkflowTaskKind;
  /**
   * Human label for the kind, from the canonical `kindToDisplayName`.
   * The empty string for `unspecified` kinds (the snapshot-derived fallback
   * map carries no kind) — consumers hide the kind chip rather than render
   * a meaningless "Unknown" label.
   */
  readonly kindLabel: string;
  readonly variant: WorkflowThreadCardVariant;
  readonly status: DerivedTaskState["status"];
  readonly durationMs: number;
  readonly costMicros: bigint;
  readonly tokensUsed: bigint;
  readonly attemptNumber: number;
  readonly error: string;
  readonly childExecutionId: string;
  readonly agentSlug: string;
  readonly currentToolName: string;
  readonly messagesCount: number;
  readonly toolCallsCount: number;
  /**
   * Kind-aware one-line preview from `resolveTaskPreview` (T04) — a
   * primitive computed HERE (not in a card hook) so the structural-sharing
   * compare below stays a cheap string check. The empty string when there
   * is nothing kind-specific to say.
   */
  readonly previewLine: string;
  /**
   * Card disclosure mode (T04). Pure function of `taskKind` (like
   * `variant`/`kindLabel`), so it is not part of the equality compare.
   */
  readonly disclosure: WorkflowTaskDisclosure;
  /**
   * Truncated event summaries carried for the card body's fallback ladder
   * (snapshot → event summary → none). Reference-stable: the store reads
   * them off the same immutable events on every re-derivation, so the
   * identity compare below holds across appends.
   */
  readonly inputSummary: JsonObject | null;
  readonly outputSummary: JsonObject | null;
}

/**
 * Progress line for the thread header. Pending tasks render no cards
 * (D-T02-5); this is where "what's coming" stays visible (Nielsen #1).
 */
export interface WorkflowThreadProgress {
  /** Tasks in a terminal state (completed, failed, or skipped). */
  readonly settledTasks: number;
  /** Tasks currently active (running, retrying, or waiting approval). */
  readonly activeTasks: number;
  /** Total planned tasks from `execution_started`; `0` when unknown. */
  readonly totalTasks: number;
}

/** Result of {@link projectThreadItems}. */
export interface WorkflowThreadProjection {
  readonly items: readonly WorkflowThreadItem[];
  readonly progress: WorkflowThreadProgress;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: ReadonlySet<DerivedTaskState["status"]> = new Set([
  "running",
  "retrying",
  "waiting_approval",
]);

const SETTLED_STATUSES: ReadonlySet<DerivedTaskState["status"]> = new Set([
  "completed",
  "failed",
  "skipped",
]);

/**
 * Projects the derived task-state map into ordered thread items plus a
 * progress summary.
 *
 * Structural sharing: pass the previous call's `items` and any task whose
 * fields are unchanged keeps its previous object identity. The store
 * rebuilds every `DerivedTaskState` on each event append, so without this,
 * every card would get a fresh item per event and `React.memo` rows could
 * never bail (DD-009/DD-010 — only the actively-changing card re-renders).
 */
export function projectThreadItems(
  taskStates: ReadonlyMap<string, DerivedTaskState>,
  totalTasks: number,
  previousItems?: readonly WorkflowThreadItem[],
): WorkflowThreadProjection {
  const previousByName = new Map<string, WorkflowThreadItem>();
  if (previousItems) {
    for (const item of previousItems) previousByName.set(item.taskName, item);
  }

  const items: WorkflowThreadItem[] = [];
  let settledTasks = 0;
  let activeTasks = 0;

  for (const state of taskStates.values()) {
    if (SETTLED_STATUSES.has(state.status)) settledTasks += 1;
    else if (ACTIVE_STATUSES.has(state.status)) activeTasks += 1;

    const preview = resolveTaskPreview(state);
    const fresh: WorkflowThreadItem = {
      taskName: state.taskName,
      taskKind: state.taskKind,
      kindLabel:
        state.taskKind === WorkflowTaskKind.workflow_task_kind_unspecified
          ? ""
          : kindToDisplayName(taskKindToString(state.taskKind)),
      variant: threadCardVariant(state.taskKind),
      status: state.status,
      durationMs: state.durationMs,
      costMicros: state.costMicros,
      tokensUsed: state.tokensUsed,
      attemptNumber: state.attemptNumber,
      error: state.error,
      childExecutionId: state.childExecutionId,
      agentSlug: state.agentSlug,
      currentToolName: state.currentToolName,
      messagesCount: state.messagesCount,
      toolCallsCount: state.toolCallsCount,
      previewLine: preview.previewLine,
      disclosure: preview.disclosure,
      inputSummary: state.inputSummary,
      outputSummary: state.outputSummary,
    };

    const previous = previousByName.get(state.taskName);
    items.push(previous && threadItemEqual(previous, fresh) ? previous : fresh);
  }

  return {
    items,
    progress: {
      settledTasks,
      activeTasks,
      // The snapshot fallback path reports totalTasks as the map size; a
      // stream that never saw execution_started reports 0 ("unknown").
      totalTasks: totalTasks > 0 ? totalTasks : 0,
    },
  };
}

/** Shallow value equality across all card-visible fields. */
function threadItemEqual(
  a: WorkflowThreadItem,
  b: WorkflowThreadItem,
): boolean {
  return (
    a.taskName === b.taskName &&
    a.taskKind === b.taskKind &&
    a.status === b.status &&
    a.durationMs === b.durationMs &&
    a.costMicros === b.costMicros &&
    a.tokensUsed === b.tokensUsed &&
    a.attemptNumber === b.attemptNumber &&
    a.error === b.error &&
    a.childExecutionId === b.childExecutionId &&
    a.agentSlug === b.agentSlug &&
    a.currentToolName === b.currentToolName &&
    a.messagesCount === b.messagesCount &&
    a.toolCallsCount === b.toolCallsCount &&
    a.previewLine === b.previewLine &&
    // The summaries are read off the same immutable stored events on every
    // re-derivation, so identity is the correct (and cheap) compare here.
    a.inputSummary === b.inputSummary &&
    a.outputSummary === b.outputSummary
    // kindLabel/variant/disclosure are pure functions of taskKind — no need
    // to compare.
  );
}
