"use client";

import { useCallback, useEffect, useState } from "react";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useIdentityProvider}. */
export interface UseIdentityProviderReturn {
  /** The fetched IdentityProvider, or `null` while loading or on error. */
  readonly identityProvider: IdentityProvider | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single IdentityProvider by ID.
 *
 * Pass `null` to skip fetching (stable no-op). When the `id` changes,
 * the previous in-flight request is discarded and a fresh fetch begins.
 *
 * Returns the full proto {@link IdentityProvider} resource so consumers
 * have access to metadata, spec (JWKS URI, issuers, SSO config), and
 * status without additional calls.
 *
 * @example
 * ```tsx
 * function IdpDetail({ idpId }: { idpId: string }) {
 *   const { identityProvider, isLoading, error } = useIdentityProvider(idpId);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!identityProvider) return <NotFound />;
 *
 *   return <h1>{identityProvider.spec?.displayName}</h1>;
 * }
 * ```
 */
export function useIdentityProvider(
  id: string | null,
): UseIdentityProviderReturn {
  const stigmer = useStigmer();
  const [identityProvider, setIdentityProvider] =
    useState<IdentityProvider | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!id) {
      setIdentityProvider(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.identityProvider.get(id).then(
      (result) => {
        if (cancelled.current) return;
        setIdentityProvider(result);
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
  }, [id, stigmer, fetchKey]);

  return { identityProvider, isLoading, error, refetch };
}
