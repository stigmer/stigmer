"use client";

import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ListRunsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { sortChronologically } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

// The ordering rule lives in @stigmer/sdk with the other shared
// conversation-assembly rules; re-exported here for existing consumers.
export { sortChronologically };

/** Options for {@link useSessionRuns}. */
export interface UseSessionRunsOptions {
  /**
   * Poll interval in milliseconds for re-listing the session's runs.
   * Used by the conversation loop to re-discover a created-but-not-yet-listed
   * run. Pass `false` (the default) to disable polling and rely on the
   * live stream plus imperative {@link UseSessionRunsReturn.refetch}.
   */
  readonly refetchInterval?: number | false;
  /**
   * Re-list when the window regains focus / the tab becomes visible — covers
   * the app-relaunch case where a run may have appeared while
   * backgrounded. Defaults to `false`.
   */
  readonly refetchOnWindowFocus?: boolean;
}

/** Return value of {@link useSessionRuns}. */
export interface UseSessionRunsReturn {
  /** All runs for the session, empty while loading or on error. */
  readonly runs: readonly Run[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the run list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all {@link Run} entries for a session.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` to
 * re-query after a new run is created within the same session
 * (needed by the follow-up conversation loop).
 *
 * Returns up to 100 runs per call. Sessions rarely exceed a
 * handful of runs; full cursor-based pagination can be added
 * later without breaking the return type.
 *
 * @example
 * ```tsx
 * function ConversationThread({ sessionId }: { sessionId: string }) {
 *   const { runs, isLoading } = useSessionRuns(sessionId);
 *   const stream = useRunStream(activeRunId);
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <MessageThread
 *       runs={runs}
 *       activeStreamRun={stream.run}
 *     />
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until a session is selected
 * const { runs } = useSessionRuns(sessionId ?? null);
 * ```
 */
export function useSessionRuns(
  sessionId: string | null,
  options?: UseSessionRunsOptions,
): UseSessionRunsReturn {
  const stigmer = useStigmer();

  const { data: executions, isLoading, isRefetching, error, refetch } = useFetch(
    sessionId
      ? () =>
          stigmer.run
            .listBySession(
              create(ListRunsBySessionRequestSchema, { sessionId }),
            )
            .then((result) => sortChronologically(result.entries))
      : null,
    [sessionId, stigmer],
    [] as Run[],
    {
      cacheKey: sessionId ? `session-executions:${sessionId}` : undefined,
      refetchInterval: options?.refetchInterval,
      refetchOnWindowFocus: options?.refetchOnWindowFocus,
    },
  );

  return { runs: executions, isLoading, isRefetching, error, refetch };
}
