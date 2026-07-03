"use client";

import { useCallback, useState } from "react";
import type { PlatformClientInput } from "@stigmer/sdk";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdatePlatformClient}. */
export interface UseUpdatePlatformClientReturn {
  /** Submit a {@link PlatformClientInput} to update an existing platform client. Resolves with the updated resource. */
  readonly update: (input: PlatformClientInput) => Promise<PlatformClient>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `platformclient.update()` with loading
 * and error state.
 *
 * Updates an existing platform client. The input must include the
 * `slug` field to identify the target resource, along with the
 * updated spec fields. Credential fields (`clientId`,
 * `clientSecretHash`, `secretFingerprint`) are computed and
 * preserved by the backend — do not set them in the input.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdatePlatformClient();
 *
 * await update({
 *   name: "my-saas-backend",
 *   slug: "my-saas-backend",
 *   org: "acme",
 *   autoProvisionAccounts: true,
 *   autoGrantOnOrg: true,
 * });
 * refetch(); // refresh detail view
 * ```
 */
export function useUpdatePlatformClient(): UseUpdatePlatformClientReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: PlatformClientInput): Promise<PlatformClient> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.platformclient.update(input);
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
