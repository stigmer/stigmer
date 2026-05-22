"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider, InvitationRedemption } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager } from "@/auth/oidc/oidc-manager";
import { getSsoSession, isValidSsoState } from "@/auth/oidc/sso-session";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { StigmerLogo } from "@/auth/StigmerLogo";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";
const AUTO_ACCEPT_KEY = "stigmer:invite:auto_accept";

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
 *    "Accept Invitation".
 *
 * 2. After clicking "Accept Invitation" — the current path and an
 *    auto-accept flag are saved in sessionStorage and the user is
 *    redirected to the OIDC provider. If the user already has an
 *    active IdP session (e.g. logged in on another tab), the
 *    redirect round-trip is near-instant.
 *
 * 3. Return visit (after OIDC callback) — the page detects the OIDC
 *    session in sessionStorage via `UserManager.getUser()`, extracts
 *    the access token, and creates an authenticated Stigmer client.
 *    The auto-accept flag triggers automatic redemption so the user
 *    lands directly on the success state without a second click.
 *
 * This follows the same self-contained pattern as `LoginPageView`.
 */
export default function InvitePageClient() {
  const token = useStaticRouteParam("token");
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode =
    resolvedTheme === "dark" ? "dark" : "light";

  const { accessToken, isAuthenticated, autoAccept } = useInviteAuth();

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
    sessionStorage.setItem(AUTO_ACCEPT_KEY, "1");
    resolveActiveManager(config.oidc).signinRedirect();
  }, []);

  return (
    <StigmerProvider client={client} colorMode={colorMode} preset="monochrome">
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <StigmerLogo />
            <h1 className="mt-4 text-lg font-semibold text-foreground">
              You&rsquo;re invited
            </h1>
          </div>
          <InvitationRedemption
            token={token ?? ""}
            isAuthenticated={isAuthenticated}
            autoAccept={autoAccept}
            onAccepted={handleAccepted}
            onAuthRequired={handleAuthRequired}
          />
        </div>
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
  readonly autoAccept: boolean;
}

/**
 * Lightweight auth detection for the public invite page.
 *
 * Checks whether an OIDC session exists in sessionStorage (written by
 * `oidc-client-ts` after a successful login). If so, extracts the
 * access token so the invite page can make authenticated RPCs (redeem).
 *
 * Also checks for the auto-accept flag set before the OIDC redirect.
 * When present, the flag is consumed (cleared) and `autoAccept` is
 * set to `true`, signalling that the invitation should be redeemed
 * automatically without requiring a second click.
 *
 * In disabled-auth mode (OSS/self-hosted), the user is treated as
 * always authenticated with no token — matching `DisabledAuthProvider`.
 */
function useInviteAuth(): InviteAuthState {
  const [state, setState] = useState<InviteAuthState>(() => {
    const config = resolveAuthConfig();
    if (config.mode === "disabled") {
      return { accessToken: null, isAuthenticated: true, autoAccept: false };
    }
    return { accessToken: null, isAuthenticated: false, autoAccept: false };
  });

  useEffect(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    const manager = resolveActiveManager(config.oidc);
    manager.getUser().then((user) => {
      if (user && !user.expired) {
        const shouldAutoAccept =
          sessionStorage.getItem(AUTO_ACCEPT_KEY) === "1";
        if (shouldAutoAccept) {
          sessionStorage.removeItem(AUTO_ACCEPT_KEY);
        }
        setState({
          accessToken: user.access_token,
          isAuthenticated: true,
          autoAccept: shouldAutoAccept,
        });
      }
    });
  }, []);

  return state;
}
