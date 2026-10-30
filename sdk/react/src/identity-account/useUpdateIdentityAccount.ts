"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { IdentityAccount, IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useUpdateIdentityAccount}. */
export interface UseUpdateIdentityAccountReturn {
  /**
   * Update an account: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: IdentityAccount | MessageInitShape<typeof IdentityAccountSchema>,
    paths: string[],
  ) => Promise<IdentityAccount>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `identityAccount.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the account by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.preferences`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A account read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the account changed since it was read.
 *
 * Self-service: a person can always update their own account (`can_edit`
 * through the self-ownership written when the account was created).
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateIdentityAccount();
 *
 * await update(
 *   {
 *     metadata: { id: account.metadata!.id, etag: account.metadata!.etag },
 *     spec: { preferences: { ...account.spec?.preferences, standingContext: "Keep answers terse." } },
 *   },
 *   ["spec.preferences"],
 * );
 * ```
 */
export function useUpdateIdentityAccount(): UseUpdateIdentityAccountReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: IdentityAccount | MessageInitShape<typeof IdentityAccountSchema>,
      paths: string[],
    ): Promise<IdentityAccount> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.identityAccount.update(resource, paths);
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
