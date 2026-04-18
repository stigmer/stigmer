"use client";

import { useCallback, useState } from "react";
import type { PlatformClientInput } from "@stigmer/sdk";
import type { PlatformClientCreateResponse } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useCreatePlatformClient}. */
export interface UseCreatePlatformClientReturn {
  /**
   * Submit a {@link PlatformClientInput} to create a new platform client.
   * Resolves with a {@link PlatformClientCreateResponse} containing the
   * resource and the **one-time raw client secret**.
   */
  readonly create: (
    input: PlatformClientInput,
  ) => Promise<PlatformClientCreateResponse>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `platformclient.create()` with loading
 * and error state.
 *
 * Creates a platform client resource within an organization. The
 * response includes a **one-time raw client secret** that must be
 * shown to the user immediately — the server never returns it again.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreatePlatformClient();
 *
 * const response = await create({
 *   name: "my-saas-backend",
 *   org: "acme",
 *   autoProvisionAccounts: true,
 *   autoGrantOnOrg: true,
 * });
 *
 * // response.clientSecret is the one-time raw secret
 * // response.platformClient is the created resource
 * ```
 */
export function useCreatePlatformClient(): UseCreatePlatformClientReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (
      input: PlatformClientInput,
    ): Promise<PlatformClientCreateResponse> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.platformclient.create(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
