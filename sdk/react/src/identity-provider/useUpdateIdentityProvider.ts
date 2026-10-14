"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { FederationIssuer, FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateFederationIssuer}. */
export interface UseUpdateFederationIssuerReturn {
  /**
   * Update an identity provider: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: FederationIssuer | MessageInitShape<typeof FederationIssuerSchema>,
    paths: string[],
  ) => Promise<FederationIssuer>;
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
 *     spec: { displayName: "Acme Platform" },
 *   },
 *   ["spec.display_name"],
 * );
 * ```
 */
export function useUpdateFederationIssuer(): UseUpdateFederationIssuerReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: FederationIssuer | MessageInitShape<typeof FederationIssuerSchema>,
      paths: string[],
    ): Promise<FederationIssuer> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.federationIssuer.update(resource, paths);
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
