"use client";

import { useCallback, useState } from "react";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteOAuthApp}. */
export interface UseDeleteOAuthAppReturn {
  /** Delete an OAuth app by its resource ID. Resolves with the deleted resource for confirmation display. */
  readonly deleteApp: (id: string) => Promise<OAuthApp>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `oauthapp.delete()` with loading and error
 * state.
 *
 * Deletes an OAuth app by its resource ID. Returns the deleted
 * {@link OAuthApp} on success so callers can confirm which app was
 * removed. The deletion is permanent — any MCP server overrides
 * referencing this app will lose their binding.
 *
 * @example
 * ```tsx
 * const { deleteApp, isDeleting, error } = useDeleteOAuthApp();
 *
 * await deleteApp("oauth-app-id-abc123");
 * refetch(); // refresh the list after deletion
 * ```
 */
export function useDeleteOAuthApp(): UseDeleteOAuthAppReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteApp = useCallback(
    async (id: string): Promise<OAuthApp> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.oauthapp.delete({ resourceId: id });
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
