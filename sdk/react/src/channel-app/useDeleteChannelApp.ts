"use client";

import { useCallback, useState } from "react";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteChannelApp}. */
export interface UseDeleteChannelAppReturn {
  /** Delete a channel app by its resource ID. Resolves with the deleted resource for confirmation display. */
  readonly deleteApp: (id: string) => Promise<ChannelApp>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `channelapp.delete()` with loading and error
 * state.
 *
 * Deletes a channel app by its resource ID. The server refuses
 * (`FAILED_PRECONDITION`) while any agent channel still references the
 * app via `spec.app_ref` — the error message names the fix; surface it
 * to the user rather than retrying.
 *
 * @example
 * ```tsx
 * const { deleteApp, isDeleting, error } = useDeleteChannelApp();
 *
 * await deleteApp("chapp_abc123");
 * refetch(); // refresh the list after deletion
 * ```
 */
export function useDeleteChannelApp(): UseDeleteChannelAppReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteApp = useCallback(
    async (id: string): Promise<ChannelApp> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.channelapp.delete({ resourceId: id });
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteApp, isDeleting, error, clearError };
}
