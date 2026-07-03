"use client";

import { useCallback, useState } from "react";
import type { DeleteResourceInput } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteIdentityProvider}. */
export interface UseDeleteIdentityProviderReturn {
  /** Delete an identity provider. Resolves with the deleted resource for confirmation display. */
  readonly deleteProvider: (input: DeleteResourceInput) => Promise<IdentityProvider>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `identityProvider.delete()` with loading
 * and error state.
 *
 * Deletes an identity provider by its resource ID. Returns the deleted
 * {@link IdentityProvider} on success so callers can confirm which
 * provider was removed.
 *
 * Deletion is blocked by the backend if any platform-managed
 * organizations still reference this identity provider.
 *
 * @example
 * ```tsx
 * const { deleteProvider, isDeleting, error } = useDeleteIdentityProvider();
 *
 * await deleteProvider({ resourceId: "idp-abc123" });
 * refetch(); // refresh the list after deletion
 * ```
 */
export function useDeleteIdentityProvider(): UseDeleteIdentityProviderReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteProvider = useCallback(
    async (input: DeleteResourceInput): Promise<IdentityProvider> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.identityProvider.delete(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteProvider, isDeleting, error, clearError };
}
