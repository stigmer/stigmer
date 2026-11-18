"use client";

import { SignInReturnView } from "@stigmer/react-sdk/console";
import { StigmerLogo } from "@/auth/StigmerLogo";

/**
 * OIDC redirect callback page.
 *
 * Auth0 redirects here after the user authenticates. The actual code
 * exchange (PKCE verifier → access token) is handled by the
 * `OidcAuthProvider` at the provider level — it detects the `/auth/callback`
 * path on mount and calls `signinRedirectCallback()`.
 *
 * After a successful exchange the provider navigates to the pre-login
 * path with `window.location.replace()`. This page exists primarily as a
 * Next.js route so that `/auth/callback` resolves in dev mode and produces
 * an `auth/callback.html` in the static export.
 */
export default function OidcCallbackPage() {
  // The exchange's failure is drawn by `OidcAuthProvider` with the same view.
  return <SignInReturnView error={null} onSignInAgain={() => window.location.replace("/login")} mark={<StigmerLogo size={40} />} />;
}
