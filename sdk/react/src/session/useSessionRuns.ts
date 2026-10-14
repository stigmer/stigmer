"use client";

import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ListRunsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { sortChronologically } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readWholeList } from "../internal/everyPage.js";
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
 * A conversation renders all of its turns, so the hook walks every page
 * of the session's runs, with no cap: a long-lived session's runs grow
 * without bound, and the view needs them whole.
 *
 * @example
 * ```tsx
 * function ConversationThread({ sessionId }: { sessionId: string }) {
 *   const { runs, isLoading } = useSessionRuns(sessionId);
 *   const { fold } = useSessionEvents(sessionId);
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return <MessageThread turns={fold?.turns ?? []} runs={runs} />;
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
          readWholeList((pageToken) =>
            stigmer.run.listBySession(
              create(ListRunsBySessionRequestSchema, {
                sessionId,
                pageSize: LIST_PAGE_MAX,
                pageToken,
              }),
            ),
          ).then(sortChronologically)
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
