"use client";

import { useCallback, useState } from "react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useDeleteRunner}. */
export interface UseDeleteRunnerReturn {
  /**
   * Delete a runner by its resource ID. Resolves with the deleted
   * {@link Runner} for confirmation display.
   *
   * The deletion is permanent — any sessions bound to this runner will
   * fall back to auto-provisioning on their next execution.
   */
  readonly deleteRunner: (id: string) => Promise<Runner>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `runner.delete()` with loading and error
 * state.
 *
 * Deletes a runner by its resource ID. Returns the deleted
 * {@link Runner} on success so callers can confirm which runner was
 * removed (e.g., in a toast or undo prompt).
 *
 * @example
 * ```tsx
 * const { deleteRunner, isDeleting, error } = useDeleteRunner();
 *
 * await deleteRunner("rnr_abc123");
 * refetch(); // refresh the runner list
 * ```
 */
export function useDeleteRunner(): UseDeleteRunnerReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteRunner = useCallback(
    async (id: string): Promise<Runner> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.runner.delete(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteRunner, isDeleting, error, clearError };
}
