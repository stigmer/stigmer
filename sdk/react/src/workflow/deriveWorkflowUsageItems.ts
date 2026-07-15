// Pure derivation of per-task usage rows from derived task states.
// Domain: workflow (the Usage-facet analog of deriveWorkflowArtifactItems).

import type { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store.js";
import { kindToDisplayName } from "./kind-metadata.js";
import { taskKindToString } from "./workflow-graph-conversions.js";

const BIGINT_ZERO = BigInt(0);

/** One per-task usage row rendered by the Usage facet's breakdown list. */
export interface WorkflowUsageItem {
  /** Task name — the row's identity and the selection-callback argument. */
  readonly taskName: string;
  /** Task kind enum (as reported by the event stream). */
  readonly taskKind: WorkflowTaskKind;
  /** Human-readable kind label (e.g. `"Agent Call"`), via kind metadata. */
  readonly kindLabel: string;
  /** Task lifecycle status at derivation time. */
  readonly status: DerivedTaskState["status"];
  /** Cost consumed by the task in micro-USD. */
  readonly costMicros: bigint;
  /** Tokens consumed by the task (live for running agent-call tasks). */
  readonly tokensUsed: bigint;
}

/**
 * Derives the Usage facet's per-task breakdown from an execution's derived
 * task states (as returned by `useWorkflowExecutionEventStream`).
 *
 * **Zero-usage rows are dropped** (zero cost AND zero tokens): they carry no
 * usage signal, and the viewer's snapshot-fallback task states (built when
 * event persistence failed) zero out cost/tokens — without the filter that
 * fallback would render as a table of fake `$0.00` rows instead of degrading
 * honestly to the facet's aggregate/empty state.
 *
 * **Sorting:** cost descending, then tokens descending, then name — the most
 * expensive task first, answering the facet's core question ("which task is
 * burning my budget?"). Comparisons stay in `bigint` (no `Number()` coercion,
 * which loses precision above 2^53).
 *
 * Pure function (not a hook): callers memoize on their task-states reference.
 */
export function deriveWorkflowUsageItems(
  taskStates: ReadonlyMap<string, DerivedTaskState>,
): readonly WorkflowUsageItem[] {
  const items: WorkflowUsageItem[] = [];
  for (const state of taskStates.values()) {
    if (state.costMicros === BIGINT_ZERO && state.tokensUsed === BIGINT_ZERO) {
      continue;
    }
    items.push({
      taskName: state.taskName,
      taskKind: state.taskKind,
      kindLabel: kindToDisplayName(taskKindToString(state.taskKind)),
      status: state.status,
      costMicros: state.costMicros,
      tokensUsed: state.tokensUsed,
    });
  }

  return items.sort((a, b) => {
    if (a.costMicros !== b.costMicros) {
      return a.costMicros > b.costMicros ? -1 : 1;
    }
    if (a.tokensUsed !== b.tokensUsed) {
      return a.tokensUsed > b.tokensUsed ? -1 : 1;
    }
    return a.taskName.localeCompare(b.taskName, undefined, {
      sensitivity: "base",
    });
  });
}
