"use client";

import { Loader2 } from "lucide-react";

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
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
      <p className="text-muted-foreground text-sm">Completing sign-in...</p>
    </div>
  );
}
