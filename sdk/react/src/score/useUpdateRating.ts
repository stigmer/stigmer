"use client";

import { useCallback, useMemo, useState } from "react";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { ratingUpdateInput } from "./rating-input.js";

/** Return value of {@link useUpdateRating}. */
export interface UseUpdateRatingReturn {
  /** Change the thumbs and comment of the caller's own rating. Resolves with the stored score. */
  readonly updateRating: (
    rating: Score,
    change: { readonly passed: boolean; readonly comment?: string },
  ) => Promise<Score>;
  /** `true` while the update is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `score.update()` for a person's own rating:
 * only its thumbs and comment change. The server refuses any other score
 * (a check's verdict is final) and any other person's rating.
 *
 * @example
 * ```tsx
 * const { updateRating } = useUpdateRating();
 * await updateRating(myRating, { passed: true });
 * ```
 */
export function useUpdateRating(): UseUpdateRatingReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updateRating = useCallback(
    async (
      rating: Score,
      change: { readonly passed: boolean; readonly comment?: string },
    ): Promise<Score> => {
      setIsUpdating(true);
      setError(null);
      try {
        return await stigmer.score.update(ratingUpdateInput(rating, change));
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ updateRating, isUpdating, error, clearError }),
    [updateRating, isUpdating, error, clearError],
  );
}
