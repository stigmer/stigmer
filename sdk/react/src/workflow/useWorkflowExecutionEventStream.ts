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
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
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
  /** Error from the last failed stream attempt, or `null`. */
  readonly error: Error | null;
  /** Re-establish the stream subscription. */
  readonly reconnect: () => void;
}

const TERMINAL_PHASES = new Set<ExecutionPhase>([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

/**
 * Behavior hook that manages a live event stream subscription for a
 * workflow execution, or batch-loads events for completed executions.
 *
 * Internally maintains a {@link WorkflowExecutionEventStore} and
 * exposes its state via `useSyncExternalStore` for efficient React
 * integration.
 *
 * For running executions: subscribes via `subscribeEvents` with
 * replay+live-tail. On disconnect, reconnects from the last received
 * sequence number.
 *
 * For terminal executions: loads the full event log via paginated
 * `getEventLog` calls.
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

  // Stable ref for values that should not trigger re-subscription
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    if (!executionId) {
      store.reset();
      return;
    }

    const abortController = new AbortController();
    const currentStore = storeRef.current;
    const isTerminal = executionPhase !== undefined && TERMINAL_PHASES.has(executionPhase);

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
      // Live-stream events for running executions
      currentStore.setStreamState({ stage: "connecting", executionId });

      (async () => {
        try {
          const afterSequence = currentStore.getLatestSequence();

          for await (const event of stigmer.workflowExecution.subscribeEvents(
            create(SubscribeEventsRequestSchema, {
              executionId,
              afterSequence,
              eventTypes: eventTypes ? [...eventTypes] : [],
            }),
            abortController.signal,
          )) {
            if (abortController.signal.aborted) return;

            startTransition(() => {
              currentStore.appendEvents([event]);
              if (currentStore.getStreamState().stage === "connecting") {
                currentStore.setStreamState({ stage: "streaming", executionId });
              }
            });
          }

          if (!abortController.signal.aborted) {
            currentStore.setStreamState({ stage: "complete", executionId });
          }
        } catch (err) {
          if (abortController.signal.aborted) return;

          const error = toError(err);
          const isUnimplemented =
            error.message.includes("UNIMPLEMENTED") ||
            error.message.includes("unimplemented");

          if (isUnimplemented) {
            currentStore.setStreamState({ stage: "unsupported", executionId });
          } else {
            currentStore.setStreamState({
              stage: "error",
              executionId,
              error,
            });
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
  const error = streamState.stage === "error" ? streamState.error : null;

  return {
    events,
    taskStates,
    costSummary,
    streamState,
    totalTasks,
    isStreaming,
    isConnecting,
    error,
    reconnect,
  };
}
