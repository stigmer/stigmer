"use client";

import { useCallback, useMemo, useState } from "react";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { getErrorReason } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import {
  ratingCreateInput,
  ratingUpdateInput,
  type RunRating,
} from "./rating-input.js";
import { SCORE_EXISTS_REASON } from "./score-view.js";

/** Return value of {@link useRateRun}. */
export interface UseRateRunReturn {
  /**
   * Record the caller's rating of a completed run. When the caller already
   * rated it, the existing rating is changed instead. Resolves with the
   * stored score.
   */
  readonly rateRun: (rating: RunRating) => Promise<Score>;
  /** `true` while the rating write is in flight. */
  readonly isRating: boolean;
  /** Error from the last failed write, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `score.create()` for a person's thumbs on a
 * completed run. Each person rates a run once: the server answers a second
 * rating with ALREADY_EXISTS carrying the SCORE_EXISTS reason and the
 * existing score's id, and this hook then changes that score through
 * `score.update()`, so a click always records what the person meant.
 *
 * @example
 * ```tsx
 * const { rateRun, isRating } = useRateRun();
 * await rateRun({ org, runId, passed: false, comment: "picked the wrong label" });
 * ```
 */
export function useRateRun(): UseRateRunReturn {
  const stigmer = useStigmer();
  const [isRating, setIsRating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const rateRun = useCallback(
    async (rating: RunRating): Promise<Score> => {
      setIsRating(true);
      setError(null);
      try {
        try {
          return await stigmer.score.create(ratingCreateInput(rating));
        } catch (err) {
          const reason = getErrorReason(err);
          const existingId = reason?.metadata["score_id"] ?? "";
          if (reason?.reason !== SCORE_EXISTS_REASON || existingId === "") {
            throw err;
          }
          const existing = await stigmer.score.get(existingId);
          return await stigmer.score.update(
            ratingUpdateInput(existing, rating),
          );
        }
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRating(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ rateRun, isRating, error, clearError }),
    [rateRun, isRating, error, clearError],
  );
}
