"use client";

import { useCallback, useState } from "react";
import type { ApiKeyInput } from "@stigmer/sdk";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateApiKey}. */
export interface UseCreateApiKeyReturn {
  /** Submit an {@link ApiKeyInput} to create a new API key. Resolves with the server-created resource including the raw key value. */
  readonly create: (input: ApiKeyInput) => Promise<ApiKey>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `apiKey.create()` with loading and error
 * state.
 *
 * Creates an API key resource. The caller provides an
 * {@link ApiKeyInput} with `name`, `org`, and optionally `expiresAt`
 * or `neverExpires`.
 *
 * **Critical**: The returned {@link ApiKey} is the *only* time the
 * raw key value is available — it is returned in `spec.keyHash` of
 * the create response. After creation the server stores only the
 * hash; subsequent queries return an empty `keyHash` and only the
 * `fingerprint` (last 6 characters) for display.
 *
 * Callers must capture the raw key from the resolved promise and
 * present it to the user immediately (e.g. via
 * {@link ApiKeyCreatedAlert}).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateApiKey();
 *
 * const apiKey = await create({
 *   name: "ci-deploy-key",
 *   org: "acme",
 *   neverExpires: true,
 * });
 * // apiKey.spec?.keyHash contains the raw key — show it once
 * ```
 */
export function useCreateApiKey(): UseCreateApiKeyReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: ApiKeyInput): Promise<ApiKey> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.apiKey.create(input);
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
