"use client";

import { useCallback, useState } from "react";
import type { PlatformClientCreateResponse } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useRotatePlatformClientSecret}. */
export interface UseRotatePlatformClientSecretReturn {
  /**
   * Rotate the client secret for a platform client by its resource ID.
   * Resolves with a {@link PlatformClientCreateResponse} containing the
   * updated resource and the **one-time new raw client secret**.
   */
  readonly rotateSecret: (
    id: string,
  ) => Promise<PlatformClientCreateResponse>;
  /** `true` while the rotation request is in flight. */
  readonly isRotating: boolean;
  /** Error from the last failed rotation, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `platformclient.rotateSecret()` with
 * loading and error state.
 *
 * Generates a new client secret, invalidating the previous one.
 * The response includes a **one-time raw client secret** — it must
 * be shown to the user immediately as the server never returns it
 * again.
 *
 * @example
 * ```tsx
 * const { rotateSecret, isRotating, error } = useRotatePlatformClientSecret();
 *
 * const response = await rotateSecret("pc-abc123");
 * // response.clientSecret is the new one-time raw secret
 * ```
 */
export function useRotatePlatformClientSecret(): UseRotatePlatformClientSecretReturn {
  const stigmer = useStigmer();
  const [isRotating, setIsRotating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const rotateSecret = useCallback(
    async (id: string): Promise<PlatformClientCreateResponse> => {
      setIsRotating(true);
      setError(null);

      try {
        return await stigmer.platformclient.rotateSecret(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRotating(false);
      }
    },
    [stigmer],
  );

  return { rotateSecret, isRotating, error, clearError };
}
