"use client";

import { useCallback, useState } from "react";
import type { IdentityAccountInput } from "@stigmer/sdk";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateIdentityAccount}. */
export interface UseUpdateIdentityAccountReturn {
  /** Submit an {@link IdentityAccountInput} to update an identity account. Resolves with the updated resource. */
  readonly update: (input: IdentityAccountInput) => Promise<IdentityAccount>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `identityAccount.update()` with loading and
 * error state.
 *
 * The update RPC is a full-spec replacement addressed by `org` + `slug`
 * (the generated input carries no id). Build the input from the loaded
 * resource with `toIdentityAccountUpdateInput` from `@stigmer/sdk` and
 * override only the fields being edited — sending a partial input wipes
 * the unsent spec fields. The same rule applies INSIDE nested messages:
 * override `preferences` by spreading the mapper's complete value first,
 * or the untouched preference fields wipe.
 *
 * Self-service: a user can always update their own account (`can_edit`
 * via the self-ownership relationship written at account creation).
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateIdentityAccount();
 *
 * const mapped = toIdentityAccountUpdateInput(account);
 * await update({
 *   ...mapped,
 *   preferences: { ...mapped.preferences, standingContext: "Keep answers terse." },
 * });
 * refetch(); // re-sync the editor
 * ```
 */
export function useUpdateIdentityAccount(): UseUpdateIdentityAccountReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: IdentityAccountInput): Promise<IdentityAccount> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.identityAccount.update(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
