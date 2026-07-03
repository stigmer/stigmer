"use client";

import { useCallback, useState } from "react";
import type { IdentityProviderInput } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateIdentityProvider}. */
export interface UseUpdateIdentityProviderReturn {
  /** Submit an {@link IdentityProviderInput} to update an existing identity provider. Resolves with the updated resource. */
  readonly update: (input: IdentityProviderInput) => Promise<IdentityProvider>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `identityProvider.update()` with loading
 * and error state.
 *
 * Updates an existing identity provider. The input must include the
 * `slug` field to identify the target resource, along with the updated
 * spec fields.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateIdentityProvider();
 *
 * await update({
 *   name: "Acme Corp SSO",
 *   slug: "acme-sso",
 *   org: "acme",
 *   displayName: "Acme Corp SSO",
 *   isSsoProvider: true,
 *   oidcClientId: "abc123",
 * });
 * refetch(); // refresh detail view
 * ```
 */
export function useUpdateIdentityProvider(): UseUpdateIdentityProviderReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: IdentityProviderInput): Promise<IdentityProvider> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.identityProvider.update(input);
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
