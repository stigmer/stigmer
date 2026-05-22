"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider, InvitationRedemption } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager } from "@/auth/oidc/oidc-manager";
import { getSsoSession, isValidSsoState } from "@/auth/oidc/sso-session";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/**
 * Resolve the UserManager for the current session.
 *
 * Checks for an active SSO session first (same precedence as
 * OidcAuthProvider), falling back to the default Auth0 manager.
 */
function resolveActiveManager(auth0Config: {
  issuer: string;
  clientId: string;
  audience: string;
}) {
  const ssoSession = getSsoSession();
  if (ssoSession && isValidSsoState(ssoSession)) {
    return createUserManager({
      issuer: ssoSession.issuer,
      clientId: ssoSession.clientId,
      audience: ssoSession.audience,
    });
  }
  return createUserManager(auth0Config);
}

/**
 * Public invite redemption page.
 *
 * Renders outside the authenticated provider chain (see `Providers.tsx`
 * PUBLIC_ROUTES). Creates its own {@link StigmerProvider} so the SDK's
 * invitation hooks can call the unauthenticated `getByToken` RPC.
 *
 * **Auth lifecycle:**
 *
 * 1. First visit (unauthenticated) — creates a Stigmer client with no
 *    token. The `getByToken` RPC is public (`is_public` in proto), so
 *    the invite preview renders without authentication. The user sees
 *    "Sign in to accept".
 *
 * 2. After clicking "Sign in to accept" — the current path is saved in
 *    sessionStorage and the user is redirected to the OIDC provider.
 *
 * 3. Return visit (after OIDC callback) — the page detects the OIDC
 *    session in sessionStorage via `UserManager.getUser()`, extracts
 *    the access token, and creates an authenticated Stigmer client.
 *    The user sees "Accept Invitation".
 *
 * This follows the same self-contained pattern as `LoginPageView`.
 */
export default function InvitePageClient() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode =
    resolvedTheme === "dark" ? "dark" : "light";

  const { accessToken, isAuthenticated } = useInviteAuth();

  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: getApiBaseUrl(),
        getAccessToken: () => accessToken,
      }),
    [accessToken],
  );

  const handleAccepted = useCallback(
    (invitation: Invitation) => {
      const orgSlug = invitation.metadata?.org;
      router.push(orgSlug ? `/${orgSlug}` : "/");
    },
    [router],
  );

  const handleAuthRequired = useCallback(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;
    sessionStorage.setItem(REDIRECT_PATH_KEY, window.location.pathname);
    resolveActiveManager(config.oidc).signinRedirect();
  }, []);

  return (
    <StigmerProvider client={client} colorMode={colorMode} preset="monochrome">
      <div className="flex min-h-screen items-center justify-center p-4">
        <InvitationRedemption
          token={params.token}
          isAuthenticated={isAuthenticated}
          onAccepted={handleAccepted}
          onAuthRequired={handleAuthRequired}
        />
      </div>
    </StigmerProvider>
  );
}

// ---------------------------------------------------------------------------
// Auth detection
// ---------------------------------------------------------------------------

interface InviteAuthState {
  readonly accessToken: string | null;
  readonly isAuthenticated: boolean;
}

/**
 * Lightweight auth detection for the public invite page.
 *
 * Checks whether an OIDC session exists in sessionStorage (written by
 * `oidc-client-ts` after a successful login). If so, extracts the
 * access token so the invite page can make authenticated RPCs (redeem).
 *
 * In disabled-auth mode (OSS/self-hosted), the user is treated as
 * always authenticated with no token — matching `DisabledAuthProvider`.
 */
function useInviteAuth(): InviteAuthState {
  const [state, setState] = useState<InviteAuthState>(() => {
    const config = resolveAuthConfig();
    if (config.mode === "disabled") {
      return { accessToken: null, isAuthenticated: true };
    }
    return { accessToken: null, isAuthenticated: false };
  });

  useEffect(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    const manager = resolveActiveManager(config.oidc);
    manager.getUser().then((user) => {
      if (user && !user.expired) {
        setState({ accessToken: user.access_token, isAuthenticated: true });
      }
    });
  }, []);

  return state;
}
