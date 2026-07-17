/**
 * The canonical task-I/O model and its fallback ladder — shared by the
 * thread card body and the Inspect drill-down (T04).
 *
 * Extracted from `execution-inspector/derive-task-detail.ts`: this pair is
 * not inspector-specific, and the thread must not reach into an "inspector"
 * folder for shared infrastructure. Deliberately ONLY the I/O ladder lives
 * here — the full `deriveTaskDetail` join (retries, event log, agent and
 * approval sections) scans the whole event log and stays in
 * `execution-inspector/`, where exactly one task is derived at a time. The
 * card body pairs `buildIO` with an O(1) snapshot lookup instead; wiring the
 * full join into every always-visible card body would be O(cards × events)
 * per event append.
 *
 * No React dependencies — independently testable (DD-003).
 *
 * @since T04 (Session-Parity Task Cards)
 */

import type { JsonObject } from "@bufbuild/protobuf";

/**
 * One side (input or output) of a task's I/O, with provenance.
 *
 * `source` records which rung of the fallback ladder supplied `data`:
 * `"snapshot"` is the full value from `status.tasks[]`; `"event-summary"`
 * is the truncated Struct off the live event stream — consumers surface
 * the truncation honestly (a banner) rather than presenting it as complete.
 */
export interface TaskDetailIO {
  readonly data: JsonObject;
  readonly summary: JsonObject | null;
  readonly artifactIds: readonly string[];
  readonly source: "snapshot" | "event-summary";
}

/**
 * The I/O fallback ladder: the full snapshot value when present, else the
 * truncated event summary, else `null` (nothing to show).
 */
export function buildIO(
  snapshotData: JsonObject | undefined,
  eventSummary: JsonObject | null,
  artifactIds: readonly string[],
): TaskDetailIO | null {
  if (snapshotData && Object.keys(snapshotData).length > 0) {
    return {
      data: snapshotData,
      summary: eventSummary,
      artifactIds,
      source: "snapshot",
    };
  }

  if (eventSummary && Object.keys(eventSummary).length > 0) {
    return {
      data: eventSummary,
      summary: eventSummary,
      artifactIds,
      source: "event-summary",
    };
  }

  return null;
}
