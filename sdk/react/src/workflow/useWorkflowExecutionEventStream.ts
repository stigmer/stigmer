"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { create } from "@bufbuild/protobuf";
import {
  GetEventLogRequestSchema,
  SubscribeEventsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { isTransientStreamError } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import {
  computeBackoffDelay,
  sleep,
  DEFAULT_RECONNECT_MAX_ATTEMPTS,
  type BackoffOptions,
} from "../internal/backoff";
import {
  WorkflowExecutionEventStore,
  type WorkflowEventStreamState,
  type DerivedTaskState,
  type DerivedCostSummary,
} from "../internal/store";

/** Options for {@link useWorkflowExecutionEventStream}. */
export interface UseWorkflowExecutionEventStreamOptions {
  /** Filter to specific event types for the subscription. */
  readonly eventTypes?: readonly WorkflowEventType[];
  /**
   * External store instance. When provided, the hook writes to this
   * store instead of creating an internal one. Useful for sharing
   * event state across multiple components.
   */
  readonly store?: WorkflowExecutionEventStore;
  /**
   * The current execution phase. When provided, the hook uses this to
   * decide between live streaming (non-terminal) and batch loading
   * (terminal). When omitted, defaults to live streaming.
   */
  readonly executionPhase?: ExecutionPhase;
  /**
   * Automatically re-establish the live subscription with exponential
   * backoff when it drops with a transient transport error, resuming from
   * the last received `sequence_number` (no events lost). Defaults to `true`.
   */
  readonly autoReconnect?: boolean;
  /**
   * Tune the auto-reconnect backoff schedule and attempt cap. Omitted fields
   * fall back to SDK defaults (base 1s, ×2, max 30s, 10 attempts).
   */
  readonly reconnectOptions?: BackoffOptions & {
    /** Max attempts before surfacing a terminal `error`. */
    readonly maxAttempts?: number;
  };
}

/** Return value of {@link useWorkflowExecutionEventStream}. */
export interface UseWorkflowExecutionEventStreamReturn {
  /** All accumulated events, ordered by sequence_number ascending. */
  readonly events: readonly WorkflowExecutionEvent[];
  /** Derived task states from the event log. */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** Derived cost/budget summary from the latest checkpoint or aggregation. */
  readonly costSummary: DerivedCostSummary;
  /** Stream lifecycle state. */
  readonly streamState: WorkflowEventStreamState;
  /** Total tasks declared in the execution_started event. */
  readonly totalTasks: number;
  /** `true` while receiving live events. */
  readonly isStreaming: boolean;
  /** `true` while connecting to the event stream. */
  readonly isConnecting: boolean;
  /**
   * `true` while a transient drop is being retried automatically. Accumulated
   * events stay visible and `error` remains `null`; on success the
   * subscription resumes from the last sequence number with no events lost.
   */
  readonly isReconnecting: boolean;
  /** 1-based count of the in-flight reconnect attempt; `0` when not reconnecting. */
  readonly reconnectAttempt: number;
  /**
   * Error from the last failed stream attempt, or `null`. Set only once
   * auto-reconnect exhausts its attempts (or for a non-transient failure).
   */
  readonly error: Error | null;
  /** Re-establish the stream subscription (manual fallback). */
  readonly reconnect: () => void;
}

const TERMINAL_PHASES = new Set<ExecutionPhase>([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

/**
 * Pure function that detects a terminal-to-active phase transition —
 * the signal that a recovery has begun and the event store should be
 * reset to clear stale events from the previous run.
 *
 * Returns `false` when either phase is `undefined` (initial load or
 * unresolved execution), preventing false resets on first render.
 *
 * Extracted for testability (DD-003).
 */
export function isRecoveryTransition(
  prevPhase: ExecutionPhase | undefined,
  nextPhase: ExecutionPhase | undefined,
): boolean {
  if (prevPhase === undefined || nextPhase === undefined) return false;
  return TERMINAL_PHASES.has(prevPhase) && !TERMINAL_PHASES.has(nextPhase);
}

/**
 * Behavior hook that manages a live event stream subscription for a
 * workflow execution, or batch-loads events for completed executions.
 *
 * Internally maintains a {@link WorkflowExecutionEventStore} and
 * exposes its state via `useSyncExternalStore` for efficient React
 * integration.
 *
 * For running executions: subscribes via `subscribeEvents` with
 * replay+live-tail. A transient drop auto-reconnects with exponential
 * backoff, resuming from the last received sequence number so no events are
 * lost; `error` is surfaced only once retries are exhausted. A clean stream
 * end is the server's completion signal and is never retried.
 *
 * For terminal executions: loads the full event log via paginated
 * `getEventLog` calls.
 *
 * On recovery (terminal → active phase transition for the same
 * execution), the store is reset so stale events from the failed run
 * are cleared before the new subscription begins.
 *
 * When `executionId` changes to a different execution, the store is
 * reset before subscribing — mirroring `useFetch`'s identity-change
 * reset — so the previous run's append-only events neither render as
 * stale progress nor cause the live subscription to resume from the
 * wrong `afterSequence`.
 *
 * Pass `null` for `executionId` to skip (stable no-op).
 */
export function useWorkflowExecutionEventStream(
  executionId: string | null,
  options?: UseWorkflowExecutionEventStreamOptions,
): UseWorkflowExecutionEventStreamReturn {
  const stigmer = useStigmer();

  const internalStoreRef = useRef<WorkflowExecutionEventStore | null>(null);
  if (!options?.store && !internalStoreRef.current) {
    internalStoreRef.current = new WorkflowExecutionEventStore();
  }
  const store = options?.store ?? internalStoreRef.current!;

  const [connectKey, setConnectKey] = useState(0);
  const reconnect = useCallback(() => {
    setConnectKey((k) => k + 1);
  }, []);

  const eventTypes = options?.eventTypes;
  const executionPhase = options?.executionPhase;
  const autoReconnect = options?.autoReconnect ?? true;
  const reconnectOptions = options?.reconnectOptions;

  // Stable ref for values that should not trigger re-subscription
  const storeRef = useRef(store);
  storeRef.current = store;

  // Track previous phase to detect recovery (terminal → active).
  // useRef (not useState) because the transition drives an effect-time
  // side effect (store reset + gRPC subscription), not a rendered value.
  const prevPhaseRef = useRef<ExecutionPhase | undefined>(undefined);

  // Track the execution the store is currently populated for, so we can
  // detect a switch to a different execution (vs. a reconnect or phase
  // change for the same one). Same role as useFetch's prevIdentityDepsRef.
  const prevExecutionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!executionId) {
      store.reset();
      prevPhaseRef.current = undefined;
      prevExecutionIdRef.current = null;
      return;
    }

    const abortController = new AbortController();
    const currentStore = storeRef.current;
    const isTerminal = executionPhase !== undefined && TERMINAL_PHASES.has(executionPhase);

    // Execution switch (A → B): the store is append-only and holds the
    // previous run's events. Clear it before subscribing so we neither
    // render B with A's progress nor resume B's live stream from A's
    // afterSequence (which would silently drop B's earlier events).
    // This is distinct from reconnect (connectKey) and recovery (phase
    // transition), both of which must preserve/replay events for the
    // SAME execution. Resetting prevPhaseRef here prevents the A→B phase
    // delta from being misread as a recovery transition below.
    const isExecutionSwitch =
      prevExecutionIdRef.current !== null &&
      prevExecutionIdRef.current !== executionId;
    if (isExecutionSwitch) {
      currentStore.reset();
      prevPhaseRef.current = undefined;
    }
    prevExecutionIdRef.current = executionId;

    // When an execution transitions from a terminal phase back to an
    // active phase (recovery), clear the store so stale events from the
    // failed run don't produce contradictory UI (header says "running"
    // while task badges still show "failed"). After reset,
    // getLatestSequence() returns 0 and the subscription replays the
    // full event history — including task_skipped events from the
    // recovery engine that correctly represent the new run's state.
    //
    // Note: unlike useExecutionStream, this hook does NOT reset in the
    // cleanup function. connectKey (reconnect) is in the deps array —
    // resetting on cleanup would destroy events on reconnect. The store
    // is only reset here (recovery) and when executionId becomes null.
    if (isRecoveryTransition(prevPhaseRef.current, executionPhase)) {
      currentStore.reset();
    }
    prevPhaseRef.current = executionPhase;

    if (isTerminal) {
      // Batch-load all events for completed executions
      currentStore.setStreamState({ stage: "connecting", executionId });

      (async () => {
        try {
          let afterSequence = BigInt(0);
          let hasMore = true;

          while (hasMore && !abortController.signal.aborted) {
            const resp = await stigmer.workflowExecution.getEventLog(
              create(GetEventLogRequestSchema, {
                executionId,
                afterSequence,
                eventTypes: eventTypes ? [...eventTypes] : [],
                pageSize: 500,
              }),
            );

            if (abortController.signal.aborted) return;

            startTransition(() => {
              currentStore.appendEvents(resp.events);
            });

            hasMore = resp.hasMore;
            afterSequence = resp.latestSequence;
          }

          if (!abortController.signal.aborted) {
            currentStore.setStreamState({ stage: "complete", executionId });
          }
        } catch (err) {
          if (abortController.signal.aborted) return;
          currentStore.setStreamState({
            stage: "error",
            executionId,
            error: toError(err),
          });
        }
      })();
    } else {
      // Live-stream events for running executions, with auto-reconnect.
      currentStore.setStreamState({ stage: "connecting", executionId });

      (async () => {
        const signal = abortController.signal;
        const maxAttempts =
          reconnectOptions?.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;

        // 1-based count of consecutive failed attempts, reset by any event.
        let attempt = 0;

        while (!signal.aborted) {
          try {
            // Re-read each attempt: after a drop we resume from the last
            // sequence number, so the server replays only what we missed and
            // no events are lost or duplicated.
            const afterSequence = currentStore.getLatestSequence();

            for await (const event of stigmer.workflowExecution.subscribeEvents(
              create(SubscribeEventsRequestSchema, {
                executionId,
                afterSequence,
                eventTypes: eventTypes ? [...eventTypes] : [],
              }),
              signal,
            )) {
              if (signal.aborted) return;

              attempt = 0; // an event proves the connection is healthy
              startTransition(() => {
                currentStore.appendEvents([event]);
                const stage = currentStore.getStreamState().stage;
                if (stage === "connecting" || stage === "reconnecting") {
                  currentStore.setStreamState({ stage: "streaming", executionId });
                }
              });
            }

            // A clean end of the event stream is the server's completion
            // signal (the execution finished). Unlike the agent snapshot
            // stream, there is no separate terminal marker to re-check, so we
            // must NOT treat this as a premature drop — doing so would loop
            // forever re-subscribing past the final sequence. Transient drops
            // surface as thrown errors (handled below), not a clean end.
            if (!signal.aborted) {
              currentStore.setStreamState({ stage: "complete", executionId });
            }
            return;
          } catch (err) {
            if (signal.aborted) return;

            const error = toError(err);
            const isUnimplemented =
              error.message.includes("UNIMPLEMENTED") ||
              error.message.includes("unimplemented");

            // A server without event-stream support will never recover —
            // surface the unsupported state immediately, never retry.
            if (isUnimplemented) {
              currentStore.setStreamState({ stage: "unsupported", executionId });
              return;
            }

            if (
              !autoReconnect ||
              !isTransientStreamError(error) ||
              attempt >= maxAttempts
            ) {
              currentStore.setStreamState({ stage: "error", executionId, error });
              return;
            }

            attempt += 1;
            currentStore.setStreamState({
              stage: "reconnecting",
              executionId,
              attempt,
              error,
            });
            try {
              await sleep(computeBackoffDelay(attempt, reconnectOptions), signal);
            } catch {
              return; // aborted mid-backoff
            }
          }
        }
      })();
    }

    return () => {
      abortController.abort();
    };
  }, [executionId, stigmer, connectKey, executionPhase]);

  // Read from store via useSyncExternalStore
  const events = useSyncExternalStore(store.subscribe, store.getEvents);
  const taskStates = useSyncExternalStore(store.subscribe, store.getTaskStates);
  const costSummary = useSyncExternalStore(store.subscribe, store.getCostSummary);
  const streamState = useSyncExternalStore(store.subscribe, store.getStreamState);
  const totalTasks = useSyncExternalStore(store.subscribe, store.getTotalTasks);

  const isStreaming = streamState.stage === "streaming";
  const isConnecting = streamState.stage === "connecting";
  const isReconnecting = streamState.stage === "reconnecting";
  const reconnectAttempt =
    streamState.stage === "reconnecting" ? streamState.attempt : 0;
  const error = streamState.stage === "error" ? streamState.error : null;

  return {
    events,
    taskStates,
    costSummary,
    streamState,
    totalTasks,
    isStreaming,
    isConnecting,
    isReconnecting,
    reconnectAttempt,
    error,
    reconnect,
  };
}
