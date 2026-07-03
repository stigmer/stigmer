"use client";

import { useCallback, useState } from "react";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteApiKey}. */
export interface UseDeleteApiKeyReturn {
  /** Delete an API key by its resource ID. Resolves with the deleted resource for confirmation display. */
  readonly deleteKey: (id: string) => Promise<ApiKey>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `apiKey.delete()` with loading and error
 * state.
 *
 * Deletes an API key by its resource ID. Returns the deleted
 * {@link ApiKey} on success so callers can confirm which key was
 * removed. The deletion is permanent — the key can no longer be
 * used for authentication.
 *
 * @example
 * ```tsx
 * const { deleteKey, isDeleting, error } = useDeleteApiKey();
 *
 * await deleteKey("key-id-abc123");
 * refetch(); // refresh the list after deletion
 * ```
 */
export function useDeleteApiKey(): UseDeleteApiKeyReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteKey = useCallback(
    async (id: string): Promise<ApiKey> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.apiKey.delete(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteKey, isDeleting, error, clearError };
}
