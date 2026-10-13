"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { PlatformClient, PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdatePlatformClient}. */
export interface UseUpdatePlatformClientReturn {
  /**
   * Update a platform client: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: PlatformClient | MessageInitShape<typeof PlatformClientSchema>,
    paths: string[],
  ) => Promise<PlatformClient>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `platformclient.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the platform client by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.create_accounts_on_sign_in`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A platform client read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the platform client changed since it was read.
 *
 * The credentials (`spec.client_id`, `spec.client_secret_hash`,
 * `spec.secret_fingerprint`) are the server's and `rotateSecret`'s: an
 * update that names them is refused.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdatePlatformClient();
 *
 * await update(
 *   {
 *     metadata: { id: client.metadata!.id, etag: client.metadata!.etag },
 *     spec: { createAccountsOnSignIn: true },
 *   },
 *   ["spec.create_accounts_on_sign_in"],
 * );
 * ```
 */
export function useUpdatePlatformClient(): UseUpdatePlatformClientReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: PlatformClient | MessageInitShape<typeof PlatformClientSchema>,
      paths: string[],
    ): Promise<PlatformClient> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.platformclient.update(resource, paths);
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
