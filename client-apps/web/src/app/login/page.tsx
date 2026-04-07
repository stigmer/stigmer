"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider, SsoLoginPrompt } from "@stigmer/react";
import type { SsoProviderInfo } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager } from "@/auth/oidc/oidc-manager";
import { saveSsoLoginState } from "@/auth/oidc/sso-session";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/**
 * SSO login page.
 *
 * Renders outside the authenticated provider chain (see `Providers.tsx`
 * PUBLIC_ROUTES). Creates its own unauthenticated {@link StigmerProvider}
 * so the SDK's `useSsoProvider` hook can call the unauthenticated
 * `getSsoProvider` RPC.
 *
 * Two entry points:
 * - `/login?org=acme` — auto-discovers the SSO provider for "acme"
 * - `/login` — shows an org input for the user to type their org slug
 *
 * After SSO discovery, the user can:
 * 1. Click "Sign in with [provider]" — initiates the OIDC redirect
 * 2. Click "Sign in with email" — falls back to the default Auth0 flow
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const orgParam = searchParams.get("org") ?? undefined;

  const client = useMemo(
    () => new Stigmer({ baseUrl: getApiBaseUrl(), getAccessToken: () => null }),
    [],
  );

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

  const handleEmailLogin = useCallback(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    sessionStorage.setItem(REDIRECT_PATH_KEY, "/");

    const manager = createUserManager(config.oidc);
    manager.signinRedirect();
  }, []);

  return (
    <StigmerProvider client={client}>
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <StigmerLogo />
            <h1 className="mt-4 text-lg font-semibold text-foreground">
              Sign in to Stigmer
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your organization to continue with SSO
            </p>
          </div>

          <SsoLoginPrompt
            initialOrg={orgParam}
            onSsoLogin={handleSsoLogin}
          />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">
                or
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleEmailLogin}
            className="block w-full rounded-md border border-input bg-background px-4 py-2.5 text-center text-sm font-medium text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in with email
          </button>
        </div>
      </div>
    </StigmerProvider>
  );
}

// ---------------------------------------------------------------------------
// Skeleton / loading fallback
// ---------------------------------------------------------------------------

function LoginSkeleton() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

function StigmerLogo() {
  return (
    <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary-foreground"
        aria-hidden="true"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  );
}
