"use client";

import { useCallback, useState } from "react";
import type { DeleteResourceInput } from "@stigmer/client";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useDeleteFederationIssuer}. */
export interface UseDeleteFederationIssuerReturn {
  /** Delete a federation issuer. Resolves with the deleted resource for confirmation display. */
  readonly deleteProvider: (input: DeleteResourceInput) => Promise<FederationIssuer>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `federationIssuer.delete()` with loading
 * and error state.
 *
 * Deletes a federation issuer by its resource ID. Returns the deleted
 * {@link FederationIssuer} on success so callers can confirm which
 * issuer was removed.
 *
 * @example
 * ```tsx
 * const { deleteProvider, isDeleting, error } = useDeleteFederationIssuer();
 *
 * await deleteProvider({ resourceId: "issuer-abc123" });
 * refetch(); // refresh the list after deletion
 * ```
 */
export function useDeleteFederationIssuer(): UseDeleteFederationIssuerReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteProvider = useCallback(
    async (input: DeleteResourceInput): Promise<FederationIssuer> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.federationIssuer.delete(input);
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
