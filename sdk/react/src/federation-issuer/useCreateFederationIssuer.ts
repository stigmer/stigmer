"use client";

import { useCallback, useState } from "react";
import type { FederationIssuerInput } from "@stigmer/client";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useCreateFederationIssuer}. */
export interface UseCreateFederationIssuerReturn {
  /** Submit an {@link FederationIssuerInput} to create a new federation issuer. Resolves with the server-created resource. */
  readonly create: (input: FederationIssuerInput) => Promise<FederationIssuer>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `federationIssuer.create()` with loading
 * and error state.
 *
 * Creates a federation issuer resource within an organization. The
 * caller provides an {@link FederationIssuerInput} with the required
 * metadata (name, org) and spec fields (JWKS URI, allowed issuers,
 * expected audience).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateFederationIssuer();
 *
 * const issuer = await create({
 *   name: "Acme Platform",
 *   org: "acme",
 *   jwksUri: "https://acme.us.auth0.com/.well-known/jwks.json",
 *   allowedIssuers: ["https://acme.us.auth0.com/"],
 *   expectedAudience: "https://api.acme.com/stigmer",
 * });
 * ```
 */
export function useCreateFederationIssuer(): UseCreateFederationIssuerReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: FederationIssuerInput): Promise<FederationIssuer> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.federationIssuer.create(input);
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
