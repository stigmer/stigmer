"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ListScoresBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useSessionScores}. */
export interface UseSessionScoresReturn {
  /** Every score of every run in the session, newest first. */
  readonly scores: readonly Score[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the session's scores (after a rating, or once a run completes). */
  readonly refetch: () => void;
}

const NO_SCORES: readonly Score[] = [];

/**
 * Data hook that fetches every score of every run in a session through
 * `score.listBySession()`: a person's thumbs and the platform's run-health
 * checks. One read serves the whole conversation view.
 *
 * Pass `null` to stay idle (no request): the audiences that never show
 * scores, a guest or an embedded end user, keep the hook mounted and silent.
 *
 * @example
 * ```tsx
 * const { scores, refetch } = useSessionScores(sessionId);
 * ```
 */
export function useSessionScores(
  sessionId: string | null,
): UseSessionScoresReturn {
  const stigmer = useStigmer();

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    sessionId
      ? () =>
          stigmer.score
            .listBySession(
              create(ListScoresBySessionRequestSchema, { sessionId }),
            )
            .then((list): readonly Score[] => list.items)
      : null,
    [sessionId, stigmer],
    NO_SCORES,
  );

  return useMemo(
    () => ({ scores: data, isLoading, isRefetching, error, refetch }),
    [data, isLoading, isRefetching, error, refetch],
  );
}
