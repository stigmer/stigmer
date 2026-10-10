"use client";

/**
 * Behaviour hook for deleting a service account, with loading and error
 * state. A service account is an identity account, so this is the ordinary
 * `identityAccount.delete()`: the server removes every key that speaks for
 * the account and every grant naming it before the account goes, so its keys
 * stop working at once.
 */
import { useCallback, useState } from "react";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteServiceAccount}. */
export interface UseDeleteServiceAccountReturn {
  /** Delete the service account by its id. Resolves with the deleted account. */
  readonly deleteServiceAccount: (id: string) => Promise<IdentityAccount>;
  /** `true` while the request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that wraps `identityAccount.delete()` for a service account.
 *
 * @example
 * ```tsx
 * const { deleteServiceAccount, isDeleting } = useDeleteServiceAccount();
 * await deleteServiceAccount(account.metadata!.id);
 * ```
 */
export function useDeleteServiceAccount(): UseDeleteServiceAccountReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteServiceAccount = useCallback(
    async (id: string): Promise<IdentityAccount> => {
      setIsDeleting(true);
      setError(null);
      try {
        return await stigmer.identityAccount.delete(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteServiceAccount, isDeleting, error, clearError };
}
