"use client";

import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ListAgentExecutionsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Options for {@link useSessionExecutions}. */
export interface UseSessionExecutionsOptions {
  /**
   * Poll interval in milliseconds for re-listing the session's executions.
   * Used by the conversation loop to re-discover a created-but-not-yet-listed
   * execution. Pass `false` (the default) to disable polling and rely on the
   * live stream plus imperative {@link UseSessionExecutionsReturn.refetch}.
   */
  readonly refetchInterval?: number | false;
  /**
   * Re-list when the window regains focus / the tab becomes visible — covers
   * the app-relaunch case where an execution may have appeared while
   * backgrounded. Defaults to `false`.
   */
  readonly refetchOnWindowFocus?: boolean;
}

/** Return value of {@link useSessionExecutions}. */
export interface UseSessionExecutionsReturn {
  /** All executions for the session, empty while loading or on error. */
  readonly executions: readonly AgentExecution[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the execution list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all {@link AgentExecution} entries for a session.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` to
 * re-query after a new execution is created within the same session
 * (needed by the follow-up conversation loop in SP2).
 *
 * Returns up to 100 executions per call. Sessions rarely exceed a
 * handful of executions; full cursor-based pagination can be added
 * later without breaking the return type.
 *
 * @example
 * ```tsx
 * function ConversationThread({ sessionId }: { sessionId: string }) {
 *   const { executions, isLoading } = useSessionExecutions(sessionId);
 *   const stream = useExecutionStream(activeExecutionId);
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <MessageThread
 *       executions={executions}
 *       activeStreamExecution={stream.execution}
 *     />
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until a session is selected
 * const { executions } = useSessionExecutions(sessionId ?? null);
 * ```
 */
export function useSessionExecutions(
  sessionId: string | null,
  options?: UseSessionExecutionsOptions,
): UseSessionExecutionsReturn {
  const stigmer = useStigmer();

  const { data: executions, isLoading, isRefetching, error, refetch } = useFetch(
    sessionId
      ? () =>
          stigmer.agentExecution
            .listBySession(
              create(ListAgentExecutionsBySessionRequestSchema, {
                sessionId,
                pageSize: 100,
              }),
            )
            .then((result) => result.entries)
      : null,
    [sessionId, stigmer],
    [] as AgentExecution[],
    {
      cacheKey: sessionId ? `session-executions:${sessionId}` : undefined,
      refetchInterval: options?.refetchInterval,
      refetchOnWindowFocus: options?.refetchOnWindowFocus,
    },
  );

  return { executions, isLoading, isRefetching, error, refetch };
}
