"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Stigmer, isResourceAvailable } from "@stigmer/sdk";
import { StigmerProvider, SsoLoginPrompt } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SsoProviderInfo } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager } from "@/auth/oidc/oidc-manager";
import { saveSsoLoginState } from "@/auth/oidc/sso-session";
import { StigmerLogo } from "@/auth/StigmerLogo";
import { useDeploymentMode } from "@/domain/_shared/hooks/useDeploymentMode";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/**
 * The sign-in page — and the signed-out landing (20260913.02 Q-CL-9).
 *
 * Renders outside the authenticated provider chain (see `Providers.tsx`
 * PUBLIC_ROUTES). Creates its own unauthenticated {@link StigmerProvider}
 * so the SDK's `useSsoProvider` hook can call the unauthenticated
 * `getSsoProvider` RPC.
 *
 * Its shape follows the edition's tiers, the one mechanism the console has
 * for "what does this server serve" (Q-CL-4): the SSO organization prompt
 * renders only where `identity_provider` is available (Enterprise and
 * Cloud); an open-source server has one issuer by configuration and no IdP
 * resources, so its page is the logo and one "Sign in" button — the same
 * configured-issuer flow the SSO editions label "Sign in with email" beside
 * the prompt. Until `getServerInfo` has answered the page shows its
 * skeleton rather than the hostname guess (a self-host guesses "cloud").
 *
 * Two entry points on the SSO editions:
 * - `/login?org=acme` — auto-discovers the SSO provider for "acme"
 * - `/login` — shows an org input for the user to type their org slug
 */
export function LoginPageView() {
  const searchParams = useSearchParams();
  const orgParam = searchParams.get("org") ?? undefined;
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode =
    resolvedTheme === "dark" ? "dark" : "light";

  const client = useMemo(
    () => new Stigmer({ baseUrl: getApiBaseUrl(), getAccessToken: () => null }),
    [],
  );
  const deployment = useDeploymentMode(client);
  const offersSso =
    deployment.resolved &&
    isResourceAvailable(ApiResourceKind.identity_provider, deployment.mode);

  const handleSsoLogin = useCallback(
    (provider: SsoProviderInfo, org: string) => {
      saveSsoLoginState({
        issuer: provider.issuer,
        clientId: provider.oidcClientId,
        audience: provider.expectedAudience,
        org,
      });

      sessionStorage.setItem(REDIRECT_PATH_KEY, "/");

      const extraQueryParams: Record<string, string> = {};
      if (provider.expectedAudience) {
        extraQueryParams.audience = provider.expectedAudience;
      }

      const ssoManager = createUserManager({
        issuer: provider.issuer,
        clientId: provider.oidcClientId,
        audience: provider.expectedAudience,
      });

      ssoManager.signinRedirect({ extraQueryParams });
    },
    [],
  );

  // The configured issuer's own flow: Cloud's Auth0 tenant, or the
  // self-host's issuer from /config.json. One code path, two labels.
  const handleIssuerLogin = useCallback(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    sessionStorage.setItem(REDIRECT_PATH_KEY, "/");

    const manager = createUserManager(config.oidc);
    manager.signinRedirect();
  }, []);

  if (!deployment.resolved) {
    return (
      <StigmerProvider
        client={client}
        colorMode={colorMode}
        preset="monochrome"
      >
        <LoginSkeleton />
      </StigmerProvider>
    );
  }

  return (
    <StigmerProvider client={client} colorMode={colorMode} preset="monochrome">
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <StigmerLogo />
            <h1 className="text-foreground mt-4 text-lg font-semibold">
              Sign in to Stigmer
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {offersSso
                ? "Enter your organization to continue with SSO"
                : "Continue with your identity provider"}
            </p>
          </div>

          {offersSso && (
            <>
              <SsoLoginPrompt
                initialOrg={orgParam}
                onSsoLogin={handleSsoLogin}
              />

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="border-border w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background text-muted-foreground px-2">
                    or
                  </span>
                </div>
              </div>
            </>
          )}

          <button
            type="button"
            onClick={handleIssuerLogin}
            className="border-input bg-background text-foreground hover:bg-accent focus-visible:ring-ring block w-full rounded-md border px-4 py-2.5 text-center text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {offersSso ? "Sign in with email" : "Sign in"}
          </button>
        </div>
      </div>
    </StigmerProvider>
  );
}

export function LoginSkeleton() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <div className="bg-muted h-10 w-10 animate-pulse rounded-lg" />
          <div className="bg-muted h-5 w-40 animate-pulse rounded" />
          <div className="bg-muted h-4 w-56 animate-pulse rounded" />
        </div>
        <div className="space-y-3">
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          <div className="bg-muted h-10 animate-pulse rounded-md" />
          <div className="bg-muted h-10 animate-pulse rounded-md" />
        </div>
      </div>
    </div>
  );
}
