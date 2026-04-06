"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { ListIdentityProvidersByOrgInputSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useIdentityProviderList}. */
export interface UseIdentityProviderListReturn {
  /** All identity providers for the organization. Empty while loading or on error. */
  readonly identityProviders: readonly IdentityProvider[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all identity providers for an organization.
 *
 * Identity providers are admin-level resources with small cardinality
 * (typically 1–3 per org), so results are returned as a flat list
 * without pagination.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` to
 * re-query after mutations (create / update / delete).
 *
 * @example
 * ```tsx
 * function IdpSettings({ orgId }: { orgId: string }) {
 *   const { identityProviders, isLoading, error } = useIdentityProviderList(orgId);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *
 *   return (
 *     <ul>
 *       {identityProviders.map((idp) => (
 *         <li key={idp.metadata?.id}>{idp.metadata?.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until org is known
 * const { identityProviders } = useIdentityProviderList(org ?? null);
 * ```
 */
export function useIdentityProviderList(
  org: string | null,
): UseIdentityProviderListReturn {
  const stigmer = useStigmer();
  const [identityProviders, setIdentityProviders] = useState<
    IdentityProvider[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setIdentityProviders([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.identityProvider.listByOrg(create(ListIdentityProvidersByOrgInputSchema, { org })).then(
      (result) => {
        if (cancelled.current) return;
        setIdentityProviders([...result.entries]);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(toError(err));
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, stigmer, fetchKey]);

  return { identityProviders, isLoading, error, refetch };
}
