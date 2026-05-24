import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

// ---------------------------------------------------------------------------
// Stream state (mirrors ConversationStore's StreamState shape)
// ---------------------------------------------------------------------------

export type WorkflowEventStreamState =
  | { readonly stage: "idle" }
  | { readonly stage: "connecting"; readonly executionId: string }
  | { readonly stage: "streaming"; readonly executionId: string }
  | { readonly stage: "complete"; readonly executionId: string }
  | {
      readonly stage: "error";
      readonly executionId: string;
      readonly error: Error;
    }
  | { readonly stage: "unsupported"; readonly executionId: string };

const IDLE_STATE: WorkflowEventStreamState = { stage: "idle" };

// ---------------------------------------------------------------------------
// Derived state types
// ---------------------------------------------------------------------------

export interface DerivedTaskState {
  readonly taskName: string;
  readonly taskKind: WorkflowTaskKind;
  readonly status: "pending" | "running" | "completed" | "failed" | "skipped" | "retrying" | "waiting_approval";
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
}

export interface DerivedCostSummary {
  readonly costConsumedMicros: bigint;
  readonly costRemainingMicros: bigint;
  readonly tokensConsumed: bigint;
  readonly tokensRemaining: bigint;
  readonly thresholdBreached: boolean;
}

const BIGINT_ZERO = BigInt(0);
const BIGINT_NEG_ONE = BigInt(-1);

const EMPTY_COST_SUMMARY: DerivedCostSummary = {
  costConsumedMicros: BIGINT_ZERO,
  costRemainingMicros: BIGINT_NEG_ONE,
  tokensConsumed: BIGINT_ZERO,
  tokensRemaining: BIGINT_NEG_ONE,
  thresholdBreached: false,
};

// ---------------------------------------------------------------------------
// WorkflowExecutionEventStore
// ---------------------------------------------------------------------------

type Listener = () => void;

/**
 * Framework-agnostic store that accumulates workflow execution events
 * in an append-only list and derives task states and cost summaries.
 *
 * Implements the contract required by React's `useSyncExternalStore`.
 *
 * Unlike `ConversationStore` (which stores mutable execution snapshots
 * and applies structural sharing), this store is append-only: events
 * are immutable once received. Derived state (task map, cost summary)
 * is lazily recomputed and cached.
 */
export class WorkflowExecutionEventStore {
  private _events: readonly WorkflowExecutionEvent[] = [];
  private _streamState: WorkflowEventStreamState = IDLE_STATE;
  private _listeners = new Set<Listener>();

  private _taskStatesCache: ReadonlyMap<string, DerivedTaskState> | null = null;
  private _costSummaryCache: DerivedCostSummary | null = null;
  private _totalTasks = 0;

  // -- Ingestion -----------------------------------------------------------

  /**
   * Append new events to the store. Deduplicates by sequence_number
   * and maintains ascending order. Notifies listeners only when new
   * events are actually added.
   */
  appendEvents(events: readonly WorkflowExecutionEvent[]): void {
    if (events.length === 0) return;

    const currentMax = this._events.length > 0
      ? this._events[this._events.length - 1].sequenceNumber
      : BIGINT_ZERO;

    const newEvents = events.filter((e) => e.sequenceNumber > currentMax);
    if (newEvents.length === 0) return;

    newEvents.sort((a, b) => {
      if (a.sequenceNumber < b.sequenceNumber) return -1;
      if (a.sequenceNumber > b.sequenceNumber) return 1;
      return 0;
    });

    this._events = [...this._events, ...newEvents];
    this._taskStatesCache = null;
    this._costSummaryCache = null;

    for (const evt of newEvents) {
      if (
        evt.eventType === WorkflowEventType.execution_started &&
        evt.payload.case === "executionStarted"
      ) {
        this._totalTasks = evt.payload.value.totalTasks;
      }
    }

    this._notify();
  }

  /**
   * Transition the stream lifecycle state.
   */
  setStreamState(state: WorkflowEventStreamState): void {
    if (streamStateEqual(this._streamState, state)) return;
    this._streamState = state;
    this._notify();
  }

  /**
   * Reset to initial state.
   */
  reset(): void {
    const wasEmpty =
      this._events.length === 0 && this._streamState.stage === "idle";
    this._events = [];
    this._streamState = IDLE_STATE;
    this._taskStatesCache = null;
    this._costSummaryCache = null;
    this._totalTasks = 0;
    if (!wasEmpty) this._notify();
  }

  // -- useSyncExternalStore selectors -------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getEvents = (): readonly WorkflowExecutionEvent[] => {
    return this._events;
  };

  getStreamState = (): WorkflowEventStreamState => {
    return this._streamState;
  };

  getLatestSequence = (): bigint => {
    if (this._events.length === 0) return BIGINT_ZERO;
    return this._events[this._events.length - 1].sequenceNumber;
  };

  getTotalTasks = (): number => {
    return this._totalTasks;
  };

  /**
   * Derived task state map, lazily computed and cached until new
   * events are appended. Walks the event list once per invalidation
   * to build a `Map<taskName, DerivedTaskState>`.
   */
  getTaskStates = (): ReadonlyMap<string, DerivedTaskState> => {
    if (this._taskStatesCache) return this._taskStatesCache;
    this._taskStatesCache = deriveTaskStates(this._events);
    return this._taskStatesCache;
  };

  /**
   * Derived cost summary from the latest budget_checkpoint event.
   * Falls back to aggregating task_completed events when no checkpoint exists.
   */
  getCostSummary = (): DerivedCostSummary => {
    if (this._costSummaryCache) return this._costSummaryCache;
    this._costSummaryCache = deriveCostSummary(this._events);
    return this._costSummaryCache;
  };

  // -- Internal ------------------------------------------------------------

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

function deriveTaskStates(
  events: readonly WorkflowExecutionEvent[],
): ReadonlyMap<string, DerivedTaskState> {
  const map = new Map<string, DerivedTaskState>();

  for (const evt of events) {
    const taskName = evt.taskName;
    if (!taskName) continue;

    const prev = map.get(taskName);
    const p = evt.payload;

    switch (p.case) {
      case "taskStarted":
        map.set(taskName, {
          taskName,
          taskKind: p.value.taskKind,
          status: "running",
          durationMs: 0,
          costMicros: prev?.costMicros ?? BIGINT_ZERO,
          tokensUsed: prev?.tokensUsed ?? BIGINT_ZERO,
          attemptNumber: p.value.attemptNumber,
          error: "",
          childExecutionId: prev?.childExecutionId ?? "",
          agentSlug: prev?.agentSlug ?? "",
          currentToolName: prev?.currentToolName ?? "",
          messagesCount: prev?.messagesCount ?? 0,
          toolCallsCount: prev?.toolCallsCount ?? 0,
        });
        break;

      case "taskCompleted":
        map.set(taskName, {
          taskName,
          taskKind: p.value.taskKind,
          status: "completed",
          durationMs: Number(p.value.durationMs),
          costMicros: p.value.costMicros,
          tokensUsed: p.value.tokensUsed,
          attemptNumber: prev?.attemptNumber ?? 1,
          error: "",
          childExecutionId: prev?.childExecutionId ?? "",
          agentSlug: prev?.agentSlug ?? "",
          currentToolName: "",
          messagesCount: prev?.messagesCount ?? 0,
          toolCallsCount: prev?.toolCallsCount ?? 0,
        });
        break;

      case "taskFailed":
        map.set(taskName, {
          taskName,
          taskKind: p.value.taskKind,
          status: p.value.willRetry ? "retrying" : "failed",
          durationMs: Number(p.value.durationMs),
          costMicros: prev?.costMicros ?? BIGINT_ZERO,
          tokensUsed: prev?.tokensUsed ?? BIGINT_ZERO,
          attemptNumber: p.value.attemptNumber,
          error: p.value.error,
          childExecutionId: prev?.childExecutionId ?? "",
          agentSlug: prev?.agentSlug ?? "",
          currentToolName: "",
          messagesCount: prev?.messagesCount ?? 0,
          toolCallsCount: prev?.toolCallsCount ?? 0,
        });
        break;

      case "taskSkipped":
        map.set(taskName, {
          taskName,
          taskKind: p.value.taskKind,
          status: "skipped",
          durationMs: 0,
          costMicros: BIGINT_ZERO,
          tokensUsed: BIGINT_ZERO,
          attemptNumber: 0,
          error: "",
          childExecutionId: prev?.childExecutionId ?? "",
          agentSlug: "",
          currentToolName: "",
          messagesCount: 0,
          toolCallsCount: 0,
        });
        break;

      case "taskRetrying":
        if (prev) {
          map.set(taskName, { ...prev, status: "retrying" });
        }
        break;

      case "agentCallStarted":
        if (prev) {
          map.set(taskName, {
            ...prev,
            childExecutionId: p.value.childExecutionId || prev.childExecutionId,
            agentSlug: p.value.agentSlug || prev.agentSlug,
          });
        }
        break;

      case "agentCallProgress":
        if (prev) {
          map.set(taskName, {
            ...prev,
            childExecutionId: p.value.childExecutionId || prev.childExecutionId,
            currentToolName: p.value.currentToolName || prev.currentToolName,
            messagesCount: p.value.messagesCount || prev.messagesCount,
            toolCallsCount: p.value.toolCallsCount || prev.toolCallsCount,
            tokensUsed: p.value.tokensConsumed > BIGINT_ZERO
              ? p.value.tokensConsumed
              : prev.tokensUsed,
          });
        }
        break;

      case "agentCallCompleted":
        if (prev) {
          map.set(taskName, {
            ...prev,
            costMicros: p.value.costMicros,
            tokensUsed: p.value.tokensConsumed,
            currentToolName: "",
          });
        }
        break;

      case "approvalRequested":
        if (prev) {
          map.set(taskName, { ...prev, status: "waiting_approval" });
        }
        break;

      case "approvalResolved":
        if (prev && prev.status === "waiting_approval") {
          map.set(taskName, { ...prev, status: "running" });
        }
        break;
    }
  }

  return map;
}

function deriveCostSummary(
  events: readonly WorkflowExecutionEvent[],
): DerivedCostSummary {
  // Prefer the latest budget_checkpoint event
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i].payload;
    if (p.case === "budgetCheckpoint") {
      return {
        costConsumedMicros: p.value.costConsumedMicros,
        costRemainingMicros: p.value.costRemainingMicros,
        tokensConsumed: p.value.tokensConsumed,
        tokensRemaining: p.value.tokensRemaining,
        thresholdBreached: p.value.thresholdBreached,
      };
    }
  }

  // Fall back to execution_completed summary
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i].payload;
    if (p.case === "executionCompleted") {
      return {
        costConsumedMicros: p.value.totalCostMicros,
        costRemainingMicros: BIGINT_NEG_ONE,
        tokensConsumed: p.value.totalTokens,
        tokensRemaining: BIGINT_NEG_ONE,
        thresholdBreached: false,
      };
    }
  }

  // Fall back to aggregating task_completed events
  let totalCost = BIGINT_ZERO;
  let totalTokens = BIGINT_ZERO;
  for (const evt of events) {
    if (evt.payload.case === "taskCompleted") {
      totalCost += evt.payload.value.costMicros;
      totalTokens += evt.payload.value.tokensUsed;
    }
  }

  if (totalCost > BIGINT_ZERO || totalTokens > BIGINT_ZERO) {
    return {
      costConsumedMicros: totalCost,
      costRemainingMicros: BIGINT_NEG_ONE,
      tokensConsumed: totalTokens,
      tokensRemaining: BIGINT_NEG_ONE,
      thresholdBreached: false,
    };
  }

  return EMPTY_COST_SUMMARY;
}

// ---------------------------------------------------------------------------
// Stream state equality
// ---------------------------------------------------------------------------

function streamStateEqual(
  a: WorkflowEventStreamState,
  b: WorkflowEventStreamState,
): boolean {
  if (a.stage !== b.stage) return false;
  if (a.stage === "idle") return true;
  if (
    a.stage === "error" &&
    b.stage === "error" &&
    a.executionId === b.executionId &&
    a.error === b.error
  )
    return true;
  if ("executionId" in a && "executionId" in b)
    return a.executionId === b.executionId;
  return false;
}
