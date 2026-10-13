"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { IdentityProvider, IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateIdentityProvider}. */
export interface UseUpdateIdentityProviderReturn {
  /**
   * Update an identity provider: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: IdentityProvider | MessageInitShape<typeof IdentityProviderSchema>,
    paths: string[],
  ) => Promise<IdentityProvider>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `identityProvider.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the identity provider by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.display_name`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A identity provider read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the identity provider changed since it was read.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateIdentityProvider();
 *
 * await update(
 *   {
 *     metadata: { id: provider.metadata!.id, etag: provider.metadata!.etag },
 *     spec: { displayName: "Acme Corp SSO" },
 *   },
 *   ["spec.display_name"],
 * );
 * ```
 */
export function useUpdateIdentityProvider(): UseUpdateIdentityProviderReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: IdentityProvider | MessageInitShape<typeof IdentityProviderSchema>,
      paths: string[],
    ): Promise<IdentityProvider> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.identityProvider.update(resource, paths);
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
