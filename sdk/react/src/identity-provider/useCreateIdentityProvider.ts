"use client";

import { useCallback, useState } from "react";
import type { IdentityProviderInput } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useCreateIdentityProvider}. */
export interface UseCreateIdentityProviderReturn {
  /** Submit an {@link IdentityProviderInput} to create a new identity provider. Resolves with the server-created resource. */
  readonly create: (input: IdentityProviderInput) => Promise<IdentityProvider>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `identityProvider.create()` with loading
 * and error state.
 *
 * Creates an identity provider resource within an organization. The
 * caller provides an {@link IdentityProviderInput} with the required
 * metadata (name, org) and spec fields (JWKS URI, allowed issuers,
 * expected audience).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateIdentityProvider();
 *
 * const idp = await create({
 *   name: "Planton Cloud",
 *   org: "planton",
 *   jwksUri: "https://api.planton.ai/.well-known/jwks.json",
 *   allowedIssuers: ["planton-cloud"],
 *   expectedAudience: "stigmer-api",
 * });
 * ```
 */
export function useCreateIdentityProvider(): UseCreateIdentityProviderReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: IdentityProviderInput): Promise<IdentityProvider> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.identityProvider.create(input);
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
