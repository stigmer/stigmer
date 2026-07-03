"use client";

import { useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { OrganizationSsoLookupSchema, type SsoProviderInfo } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useSsoProvider}. */
export interface UseSsoProviderReturn {
  /** SSO provider info for the organization, or `null` if not configured, loading, or on error. */
  readonly ssoProvider: SsoProviderInfo | null;
  /** `true` while the lookup is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. `null` when the org simply has no SSO configured (NOT_FOUND is treated as absent, not an error). */
  readonly error: Error | null;
}

/**
 * Data hook that looks up the SSO identity provider for an organization.
 *
 * Returns the minimal OIDC configuration needed to render an SSO login
 * button and initiate the Authorization Code flow: display name, OIDC
 * client ID, and issuer URL.
 *
 * This is the only identity-provider hook that works **unauthenticated**
 * — the backend skips authorization because it is called by the login
 * page before the user has signed in.
 *
 * When the organization has no SSO provider configured, `ssoProvider`
 * is `null` and `error` remains `null` — absence is not an error.
 *
 * Pass `null` to skip the lookup (stable no-op).
 *
 * @example
 * ```tsx
 * function LoginPage({ org }: { org: string }) {
 *   const { ssoProvider, isLoading } = useSsoProvider(org);
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <div>
 *       <EmailPasswordForm />
 *       {ssoProvider && (
 *         <SsoLoginButton
 *           label={`Sign in with ${ssoProvider.displayName}`}
 *           clientId={ssoProvider.oidcClientId}
 *           issuer={ssoProvider.issuer}
 *         />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSsoProvider(org: string | null): UseSsoProviderReturn {
  const stigmer = useStigmer();
  const [ssoProvider, setSsoProvider] = useState<SsoProviderInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!org) {
      setSsoProvider(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.identityProvider.getSsoProvider(create(OrganizationSsoLookupSchema, { org })).then(
      (result) => {
        if (cancelled.current) return;
        setSsoProvider(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        if (isNotFound(err)) {
          setSsoProvider(null);
        } else {
          setError(toError(err));
        }
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, stigmer]);

  return { ssoProvider, isLoading, error };
}
