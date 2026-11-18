"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "@stigmer/react-sdk";
import type { ResolvedColorMode } from "@stigmer/react-sdk";
import { SignInView, type SignInState } from "@stigmer/react-sdk/console";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager, signupRedirectArgs } from "@/auth/oidc/oidc-manager";
import { StigmerLogo } from "@/auth/StigmerLogo";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";
const HOME = "/";

/** Whatever was thrown, as an Error the failure note can classify. */
function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

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

  const [state, setState] = useState<SignInState>({ status: "ready" });

  // React's StrictMode runs mount effects twice; one redirect is enough.
  const signupStarted = useRef(false);
  useEffect(() => {
    if (signupStarted.current || !signupRequested()) return;
    signupStarted.current = true;
    setState({ status: "handing-off" });
    startSignup().catch((err: unknown) => {
      console.error("[auth] sign-up redirect failed:", err);
      setState({ status: "failed", error: toError(err) });
    });
  }, []);

  const handleIssuerLogin = useCallback(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    sessionStorage.setItem(REDIRECT_PATH_KEY, HOME);

    const manager = createUserManager(config.oidc);
    setState({ status: "ready" });
    manager.signinRedirect().catch((err: unknown) => {
      console.error("[auth] sign-in redirect failed:", err);
      setState({ status: "failed", error: toError(err) });
    });
  }, []);

  return (
    <StigmerProvider client={client} colorMode={colorMode}>
      {/* The help line says where to ask when sign-in goes wrong: the server's own link, or nothing. */}
      <SignInView state={state} serverName="Stigmer" onSignIn={handleIssuerLogin} mark={<StigmerLogo size={40} />} />
    </StigmerProvider>
  );
}
