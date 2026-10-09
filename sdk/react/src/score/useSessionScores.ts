"use client";

import { useEffect, useMemo, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ListScoresBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { isPendingJudgeScore } from "./score-view.js";

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
 * The poll while an AI judge's grade is in progress: the first wait, the
 * cap each wait doubles up to, and how long the view keeps asking before it
 * leaves the "grading" line for a reload to settle. A judge takes 20 to 90
 * seconds.
 */
export const PENDING_POLL_FIRST_MS = 2_000;
export const PENDING_POLL_CAP_MS = 15_000;
export const PENDING_POLL_LIMIT_MS = 3 * 60 * 1_000;

/**
 * Data hook that fetches every score of every run in a session through
 * `score.listBySession()`: a person's thumbs, the platform's run-health
 * checks and an AI judge's verdict. One read serves the whole conversation
 * view. While a judge's grade is in progress the hook asks again on a
 * capped backoff ({@link PENDING_POLL_FIRST_MS}), for at most
 * {@link PENDING_POLL_LIMIT_MS}, and stops as soon as no grade is pending.
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

  usePendingJudgePoll(data, refetch);

  return useMemo(
    () => ({ scores: data, isLoading, isRefetching, error, refetch }),
    [data, isLoading, isRefetching, error, refetch],
  );
}

/** Refetches on a capped backoff while any judge grade in `scores` is pending. */
function usePendingJudgePoll(
  scores: readonly Score[],
  refetch: () => void,
): void {
  const pending = scores.some(isPendingJudgeScore);
  const since = useRef<number | null>(null);
  const attempt = useRef(0);

  useEffect(() => {
    if (!pending) {
      since.current = null;
      attempt.current = 0;
      return undefined;
    }
    const now = Date.now();
    since.current ??= now;
    if (now - since.current > PENDING_POLL_LIMIT_MS) {
      return undefined;
    }
    const delay = Math.min(
      PENDING_POLL_FIRST_MS * 2 ** attempt.current,
      PENDING_POLL_CAP_MS,
    );
    attempt.current += 1;
    const timer = setTimeout(refetch, delay);
    return () => clearTimeout(timer);
  }, [scores, pending, refetch]);
}
