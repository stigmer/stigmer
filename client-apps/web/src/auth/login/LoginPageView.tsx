"use client";

import { useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "@stigmer/react-sdk";
import type { ResolvedColorMode } from "@stigmer/react-sdk";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager } from "@/auth/oidc/oidc-manager";
import { StigmerLogo } from "@/auth/StigmerLogo";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/**
 * The sign-in page — and the signed-out landing.
 *
 * Renders outside the authenticated provider chain (see `Providers.tsx`
 * PUBLIC_ROUTES), with its own unauthenticated {@link StigmerProvider} for
 * the theme. Every edition signs in the same way: the logo and one "Sign
 * in" button that starts the deployment's own issuer flow — Stigmer
 * Cloud's tenant, or a self-hosted server's issuer from /config.json.
 */
export function LoginPageView() {
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode =
    resolvedTheme === "dark" ? "dark" : "light";

  const client = useMemo(
    () => new Stigmer({ baseUrl: getApiBaseUrl(), getAccessToken: () => null }),
    [],
  );

  const handleIssuerLogin = useCallback(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    sessionStorage.setItem(REDIRECT_PATH_KEY, "/");

    const manager = createUserManager(config.oidc);
    manager.signinRedirect();
  }, []);

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
              Continue with your identity provider
            </p>
          </div>

          <button
            type="button"
            onClick={handleIssuerLogin}
            className="border-input bg-background text-foreground hover:bg-accent focus-visible:ring-ring block w-full rounded-md border px-4 py-2.5 text-center text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            Sign in
          </button>
        </div>
      </div>
    </StigmerProvider>
  );
}
