"use client";

import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { create } from "@bufbuild/protobuf";
import { GetEventLogRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Options for {@link useWorkflowExecutionEventLog}. */
export interface UseWorkflowExecutionEventLogOptions {
  /** Maximum events per page. @default 100 */
  readonly pageSize?: number;
  /** Cursor: return events with sequence_number > this value. @default 0 */
  readonly afterSequence?: bigint;
  /** Filter to specific event types. When empty, all types are returned. */
  readonly eventTypes?: readonly WorkflowEventType[];
  /** Filter to events for a specific task name. */
  readonly taskName?: string;
}

/** Return value of {@link useWorkflowExecutionEventLog}. */
export interface UseWorkflowExecutionEventLogReturn {
  /** Events in the current page, ordered by sequence_number ascending. */
  readonly events: readonly WorkflowExecutionEvent[];
  /** Whether more events exist after the last event in this response. */
  readonly hasMore: boolean;
  /** Highest sequence_number returned, for cursor-based pagination. */
  readonly latestSequence: bigint;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

interface EventLogData {
  events: readonly WorkflowExecutionEvent[];
  hasMore: boolean;
  latestSequence: bigint;
}

const INITIAL_DATA: EventLogData = {
  events: [],
  hasMore: false,
  latestSequence: BigInt(0),
};

/**
 * Data hook that fetches the paginated event log for a workflow execution.
 *
 * Pass `null` for `executionId` to skip fetching. Supports cursor-based
 * pagination via `afterSequence` and optional filters by event type or
 * task name.
 *
 * @example
 * ```tsx
 * const { events, hasMore, latestSequence } = useWorkflowExecutionEventLog(
 *   executionId,
 *   { pageSize: 50 },
 * );
 * ```
 */
export function useWorkflowExecutionEventLog(
  executionId: string | null,
  options?: UseWorkflowExecutionEventLogOptions,
): UseWorkflowExecutionEventLogReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize ?? 100;
  const afterSequence = options?.afterSequence ?? BigInt(0);
  const eventTypes = options?.eventTypes ?? [];
  const taskName = options?.taskName ?? "";

  const fetchFn = executionId
    ? async () => {
        const resp = await stigmer.workflowExecution.getEventLog(
          create(GetEventLogRequestSchema, {
            executionId,
            afterSequence,
            eventTypes: [...eventTypes],
            taskName,
            pageSize,
          }),
        );
        return {
          events: [...resp.events],
          hasMore: resp.hasMore,
          latestSequence: resp.latestSequence,
        };
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } = useFetch<EventLogData>(
    fetchFn,
    [executionId, stigmer, pageSize, afterSequence, taskName, ...eventTypes],
    INITIAL_DATA,
  );

  return {
    events: data.events,
    hasMore: data.hasMore,
    latestSequence: data.latestSequence,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
