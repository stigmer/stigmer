/**
 * Pure derivation functions for the execution waterfall timeline.
 *
 * Converts an append-only event list into positioned waterfall entries
 * (horizontal bars on a time axis) and a scale specification for the
 * time axis labels/ticks.
 *
 * No React dependency — independently importable and testable (DD-003).
 *
 * @since T07 (Execution Waterfall Timeline)
 */

import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowTaskKind as WTK } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single task row in the waterfall timeline. */
export interface WaterfallEntry {
  readonly taskName: string;
  readonly taskKind: WorkflowTaskKind;
  readonly status: DerivedTaskState["status"] | "not_reached";
  /** Milliseconds offset from execution start. */
  readonly startMs: number;
  /** Milliseconds offset from execution start. `null` when task is still running. */
  readonly endMs: number | null;
  /** Duration from event payload, or computed from start/end. */
  readonly durationMs: number;
  readonly costMicros: bigint;
  readonly tokensUsed: bigint;
  /** Individual retry attempt segments (first attempt is always present). */
  readonly attempts: readonly WaterfallAttempt[];
  /** Nested spans (agent calls, tool calls). Populated when events exist. */
  readonly children: readonly WaterfallSpan[];
  /** Approval wait duration in ms, for compound bar segment. `null` if no approval. */
  readonly approvalWaitMs: number | null;
}

/** One attempt within a retried task. */
export interface WaterfallAttempt {
  readonly attemptNumber: number;
  /** Milliseconds offset from execution start. */
  readonly startMs: number;
  /** `null` when the attempt is still running. */
  readonly endMs: number | null;
  readonly status: "completed" | "failed" | "running";
  /** Backoff delay in ms before this attempt (0 for the first attempt). */
  readonly backoffMs: number;
}

/** A nested span within a task bar (e.g., agent call). */
export interface WaterfallSpan {
  readonly label: string;
  /** Milliseconds offset from execution start. */
  readonly startMs: number;
  /** `null` when span is still active. */
  readonly endMs: number | null;
  readonly spanType: "agent_call" | "tool_call";
}

/** Time axis specification for the waterfall. */
export interface WaterfallScale {
  /** Total visible range in milliseconds. */
  readonly totalMs: number;
  /** Tick positions as ms offsets from execution start. */
  readonly ticks: readonly number[];
  /** Label interval — every Nth tick gets a label. */
  readonly labelEveryN: number;
}

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

interface TaskAccumulator {
  taskName: string;
  taskKind: WorkflowTaskKind;
  status: DerivedTaskState["status"] | "not_reached";
  startMs: number;
  endMs: number | null;
  durationMs: number;
  costMicros: bigint;
  tokensUsed: bigint;
  attempts: WaterfallAttempt[];
  children: WaterfallSpan[];
  approvalWaitMs: number | null;
  currentAttemptStart: number;
  currentAttemptNumber: number;
}

const BIGINT_ZERO = BigInt(0);

// ---------------------------------------------------------------------------
// deriveWaterfallEntries
// ---------------------------------------------------------------------------

/**
 * Derives positioned waterfall entries from an ordered event list.
 *
 * Walks the event list once (O(n)) to build entries with absolute
 * time positions relative to execution start. Handles retries as
 * stacked attempt segments and agent calls as nested child spans.
 *
 * @param events - Events ordered by sequence_number ascending.
 * @param executionStartIso - ISO 8601 timestamp of execution start
 *   (from `execution_started.occurred_at`). When empty/absent, falls
 *   back to the first event's `occurred_at`.
 */
export function deriveWaterfallEntries(
  events: readonly WorkflowExecutionEvent[],
  executionStartIso: string,
): readonly WaterfallEntry[] {
  if (events.length === 0) return [];

  const execStartEpoch = parseIsoMs(executionStartIso || events[0].occurredAt);
  const tasks = new Map<string, TaskAccumulator>();

  for (const evt of events) {
    const taskName = evt.taskName;
    const evtMs = parseIsoMs(evt.occurredAt) - execStartEpoch;
    const p = evt.payload;

    switch (p.case) {
      case "taskStarted": {
        const existing = tasks.get(taskName);
        if (existing) {
          // Retry: a new attempt on an existing task
          existing.status = "running";
          existing.currentAttemptStart = evtMs;
          existing.currentAttemptNumber = p.value.attemptNumber;
          existing.endMs = null;
          existing.taskKind = p.value.taskKind;
        } else {
          tasks.set(taskName, {
            taskName,
            taskKind: p.value.taskKind,
            status: "running",
            startMs: evtMs,
            endMs: null,
            durationMs: 0,
            costMicros: BIGINT_ZERO,
            tokensUsed: BIGINT_ZERO,
            attempts: [],
            children: [],
            approvalWaitMs: null,
            currentAttemptStart: evtMs,
            currentAttemptNumber: p.value.attemptNumber,
          });
        }
        break;
      }

      case "taskCompleted": {
        const acc = tasks.get(taskName);
        if (acc) {
          acc.status = "completed";
          acc.endMs = evtMs;
          acc.durationMs = Number(p.value.durationMs);
          acc.costMicros = p.value.costMicros;
          acc.tokensUsed = p.value.tokensUsed;
          acc.attempts.push({
            attemptNumber: acc.currentAttemptNumber,
            startMs: acc.currentAttemptStart,
            endMs: evtMs,
            status: "completed",
            backoffMs: acc.currentAttemptStart > acc.startMs && acc.attempts.length > 0
              ? acc.currentAttemptStart - (acc.attempts[acc.attempts.length - 1].endMs ?? acc.currentAttemptStart)
              : 0,
          });
        }
        break;
      }

      case "taskFailed": {
        const acc = tasks.get(taskName);
        if (acc) {
          const failStatus = p.value.willRetry ? "retrying" : "failed";
          acc.status = failStatus;
          acc.endMs = p.value.willRetry ? null : evtMs;
          acc.durationMs = Number(p.value.durationMs);
          acc.attempts.push({
            attemptNumber: p.value.attemptNumber,
            startMs: acc.currentAttemptStart,
            endMs: evtMs,
            status: "failed",
            backoffMs: acc.currentAttemptStart > acc.startMs && acc.attempts.length > 0
              ? acc.currentAttemptStart - (acc.attempts[acc.attempts.length - 1].endMs ?? acc.currentAttemptStart)
              : 0,
          });
          if (!p.value.willRetry) {
            acc.costMicros = BIGINT_ZERO;
            acc.tokensUsed = BIGINT_ZERO;
          }
        }
        break;
      }

      case "taskSkipped": {
        const acc = tasks.get(taskName);
        if (acc) {
          acc.status = "skipped";
          acc.endMs = evtMs;
        } else {
          tasks.set(taskName, {
            taskName,
            taskKind: p.value.taskKind,
            status: "skipped",
            startMs: evtMs,
            endMs: evtMs,
            durationMs: 0,
            costMicros: BIGINT_ZERO,
            tokensUsed: BIGINT_ZERO,
            attempts: [],
            children: [],
            approvalWaitMs: null,
            currentAttemptStart: evtMs,
            currentAttemptNumber: 0,
          });
        }
        break;
      }

      case "taskRetrying": {
        const acc = tasks.get(taskName);
        if (acc) {
          acc.status = "retrying";
        }
        break;
      }

      case "approvalRequested": {
        const acc = tasks.get(taskName);
        if (acc) {
          acc.status = "waiting_approval";
        }
        break;
      }

      case "approvalResolved": {
        const acc = tasks.get(taskName);
        if (acc) {
          acc.status = "running";
          acc.approvalWaitMs = Number(p.value.waitDurationMs);
        }
        break;
      }

      case "agentCallStarted": {
        const acc = tasks.get(taskName);
        if (acc) {
          acc.children.push({
            label: p.value.agentSlug || "agent",
            startMs: evtMs,
            endMs: null,
            spanType: "agent_call",
          });
        }
        break;
      }

      case "agentCallCompleted": {
        const acc = tasks.get(taskName);
        if (acc) {
          const lastChild = acc.children[acc.children.length - 1];
          if (lastChild && lastChild.spanType === "agent_call" && lastChild.endMs === null) {
            // Mutate the last child span to close it
            (acc.children as WaterfallSpan[])[acc.children.length - 1] = {
              ...lastChild,
              endMs: evtMs,
            };
          }
          acc.costMicros = p.value.costMicros;
          acc.tokensUsed = p.value.tokensConsumed;
        }
        break;
      }
    }
  }

  // Convert accumulators to immutable entries, ordered by startMs
  const entries: WaterfallEntry[] = [];
  for (const acc of tasks.values()) {
    entries.push({
      taskName: acc.taskName,
      taskKind: acc.taskKind,
      status: acc.status,
      startMs: acc.startMs,
      endMs: acc.endMs,
      durationMs: acc.durationMs,
      costMicros: acc.costMicros,
      tokensUsed: acc.tokensUsed,
      attempts: acc.attempts,
      children: acc.children,
      approvalWaitMs: acc.approvalWaitMs,
    });
  }

  entries.sort((a, b) => a.startMs - b.startMs);
  return entries;
}

// ---------------------------------------------------------------------------
// deriveWaterfallScale
// ---------------------------------------------------------------------------

/**
 * Nice tick intervals for the time axis. Each value is a duration in ms.
 * The algorithm picks the smallest interval that produces <= MAX_TICKS ticks.
 */
const NICE_INTERVALS = [
  10, 20, 50, 100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 14_400_000, 28_800_000, 86_400_000,
];

const MAX_TICKS = 12;

/**
 * Computes a time axis scale for the waterfall.
 *
 * @param entries - Waterfall entries (used to find the max extent).
 * @param executionDurationMs - Total execution duration. When the execution
 *   is still running, pass `Date.now() - executionStartEpoch`.
 */
export function deriveWaterfallScale(
  entries: readonly WaterfallEntry[],
  executionDurationMs: number,
): WaterfallScale {
  // Find the maximum time extent across all entries
  let maxMs = executionDurationMs;
  for (const entry of entries) {
    const entryEnd = entry.endMs ?? executionDurationMs;
    if (entryEnd > maxMs) maxMs = entryEnd;
  }

  if (maxMs <= 0) maxMs = 1000; // minimum 1 second range

  // Pick the smallest nice interval that yields <= MAX_TICKS ticks
  let interval = NICE_INTERVALS[NICE_INTERVALS.length - 1];
  for (const candidate of NICE_INTERVALS) {
    if (Math.ceil(maxMs / candidate) <= MAX_TICKS) {
      interval = candidate;
      break;
    }
  }

  const ticks: number[] = [];
  for (let t = 0; t <= maxMs; t += interval) {
    ticks.push(t);
  }
  // Ensure we don't exceed the total range by more than one tick
  if (ticks.length > 0 && ticks[ticks.length - 1] < maxMs) {
    ticks.push(ticks[ticks.length - 1] + interval);
  }

  // For very dense ticks, label every other one
  const labelEveryN = ticks.length > 8 ? 2 : 1;

  const totalMs = ticks.length > 0 ? ticks[ticks.length - 1] : maxMs;

  return { totalMs, ticks, labelEveryN };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIsoMs(iso: string): number {
  if (!iso) return 0;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
