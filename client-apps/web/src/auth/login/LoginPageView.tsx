"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";
import { Stigmer } from "@stigmer/client";
import { Button, StigmerProvider } from "@stigmer/react-sdk";
import type { ResolvedColorMode } from "@stigmer/react-sdk";
import { HelpLink } from "@stigmer/react-sdk/console";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager, signupRedirectArgs } from "@/auth/oidc/oidc-manager";
import { StigmerLogo } from "@/auth/StigmerLogo";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";
const HOME = "/";

/**
 * Whether this arrival asked for sign-up (`/login?signup=1`). Read once, at
 * mount, from `window.location` rather than `useSearchParams()`: the value
 * is read once and the static-export prerender has no URL to read (the
 * `?tab=` deep-link idiom in `AgentDetailPage.tsx`).
 */
function signupRequested(): boolean {
  return new URLSearchParams(window.location.search).get("signup") === "1";
}

/**
 * Send a person who asked to sign up to the issuer's create-account screen.
 *
 * Someone already signed in, or a console with sign-in turned off, goes
 * home instead. The redirect replaces this history entry, so Back from the
 * issuer returns to where they clicked, not to a page that sends them
 * forward again.
 */
async function startSignup(): Promise<void> {
  const config = resolveAuthConfig();
  if (config.mode !== "oidc") {
    window.location.replace(HOME);
    return;
  }

  const manager = createUserManager(config.oidc);
  const existing = await manager.getUser();
  if (existing && !existing.expired) {
    window.location.replace(HOME);
    return;
  }

  sessionStorage.setItem(REDIRECT_PATH_KEY, HOME);
  const args = await signupRedirectArgs(config.oidc, manager);
  await manager.signinRedirect({ ...args, redirectMethod: "replace" });
}

/**
 * The sign-in page — and the signed-out landing.
 *
 * Renders outside the authenticated provider chain (see `Providers.tsx`
 * PUBLIC_ROUTES), with its own unauthenticated {@link StigmerProvider} for
 * the theme. Every edition signs in the same way: the logo and one "Sign
 * in" button that starts the deployment's own issuer flow — Stigmer
 * Cloud's tenant, or a self-hosted server's issuer from /config.json.
 *
 * Two arrivals. A plain `/login` renders the page. `/login?signup=1` (the
 * website's "Start free") goes straight on to the issuer's create-account
 * screen with a waiting line, as the guard names its own hand-off; if that
 * redirect fails, the page renders as for a plain arrival, so Sign in
 * still works.
 */
export function LoginPageView() {
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode =
    resolvedTheme === "dark" ? "dark" : "light";

  const client = useMemo(
    () => new Stigmer({ baseUrl: getApiBaseUrl(), getAccessToken: () => null }),
    [],
  );

  const [signingUp, setSigningUp] = useState(false);
  // React's StrictMode runs mount effects twice; one redirect is enough.
  const signupStarted = useRef(false);

  useEffect(() => {
    if (signupStarted.current || !signupRequested()) return;
    signupStarted.current = true;
    setSigningUp(true);
    startSignup().catch((err: unknown) => {
      console.error("[auth] sign-up redirect failed:", err);
      setSigningUp(false);
    });
  }, []);

  const handleIssuerLogin = useCallback(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    sessionStorage.setItem(REDIRECT_PATH_KEY, HOME);

    const manager = createUserManager(config.oidc);
    manager.signinRedirect();
  }, []);

  if (signingUp) {
    return (
      <StigmerProvider client={client} colorMode={colorMode}>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
          <p className="text-muted-foreground text-sm">
            Taking you to create your account{"\u2026"}
          </p>
        </div>
      </StigmerProvider>
    );
  }

  return (
    <StigmerProvider client={client} colorMode={colorMode}>
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

          <div className="space-y-4 text-center">
            <Button variant="outline" onClick={handleIssuerLogin} className="w-full">
              Sign in
            </Button>
            {/* Where to ask when sign-in goes wrong: the server's own link, or nothing. */}
            <HelpLink />
          </div>
        </div>
      </div>
    </StigmerProvider>
  );
}
