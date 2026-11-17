"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Stigmer, ensureMyIdentityAccount } from "@stigmer/client";
import {
  StigmerProvider,
  InvitationRedemption,
  rememberActiveOrg,
} from "@stigmer/react-sdk";
import type { ResolvedColorMode } from "@stigmer/react-sdk";
import { HelpLink } from "@stigmer/react-sdk/console";
import type { Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import type { SigninRedirectArgs } from "oidc-client-ts";
import { getApiBaseUrl } from "@/config/env";
import { resolveAuthConfig } from "@/auth/config";
import { createUserManager, signupRedirectArgs } from "@/auth/oidc/oidc-manager";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { StigmerLogo } from "@/auth/StigmerLogo";
import { rememberJoinedOrg } from "@/domain/session/joined-org";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";
const AUTO_ACCEPT_KEY = "stigmer:invite:auto_accept";

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
 *    the invite preview renders without authentication. Someone arriving
 *    through an invite link is most often new (stigmer#3204), so when the
 *    issuer can be asked for its create-account screen (the console's
 *    sign-up arguments, `signupRedirectArgs`, the same `/login?signup=1`
 *    uses), the user sees "Create your account and join" first and "I
 *    already have an account" under it. Those arguments may need the
 *    issuer's discovery, so they are read on mount; until they answer,
 *    and on an issuer that offers no sign-up, the user sees one "Accept
 *    invitation" that signs in.
 *
 * 2. After either act — the current path and an auto-accept flag are
 *    saved in sessionStorage and the user is redirected to the OIDC
 *    provider, to sign up or to sign in; both come back here through
 *    the console's callback. If the user already has an active IdP
 *    session (e.g. logged in on another tab), the redirect round-trip
 *    is near-instant.
 *
 * 3. Return visit (after OIDC callback) — the page detects the OIDC
 *    session in sessionStorage via `UserManager.getUser()`, extracts
 *    the access token, and creates an authenticated Stigmer client.
 *    The auto-accept flag triggers automatic redemption so the user
 *    lands directly on the success state without a second click.
 *
 * 4. Accepted — the page makes the visitor's account if this was their
 *    first sign-in (the console's own first-sign-in flow,
 *    `ensureMyIdentityAccount`), remembers the organization they joined
 *    as the active one, and goes to the console's home. The order is
 *    redeem, then the account: a first-time visitor reaches this page
 *    before the console's gate has made their account, and the server
 *    grants the role to the account the visitor will have, so an
 *    edition that greets a new account (Cloud makes a first organization
 *    for one with no role anywhere) sees the role already in place. A
 *    failed account step still navigates: the console's gate retries it.
 *    The organization joined is also left for this tab's launcher, which
 *    welcomes the person to it with the team's agents (stigmer#3208,
 *    `domain/session/joined-org.ts`).
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
  const signupArgs = useSignupArgs();

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
      void ensureMyIdentityAccount(client)
        // The console's identity gate runs the same flow on arrival and
        // owns its failure words.
        .catch(() => undefined)
        .then(() => {
          const org = invitation.metadata?.org ?? "";
          rememberActiveOrg(org);
          rememberJoinedOrg(org);
          router.push("/");
        });
    },
    [client, router],
  );

  const handleAuthRequired = useCallback(() => {
    startRedirect();
  }, []);

  const handleSignUp = useCallback(() => {
    if (signupArgs !== null) startRedirect(signupArgs);
  }, [signupArgs]);

  return (
    <StigmerProvider client={client} colorMode={colorMode}>
      <div className="bg-background flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <StigmerLogo />
            <h1 className="text-foreground mt-4 text-lg font-semibold">
              You&rsquo;re invited
            </h1>
          </div>
          <InvitationRedemption
            token={token ?? ""}
            isAuthenticated={isAuthenticated}
            autoAccept={autoAccept}
            onAccepted={handleAccepted}
            onAuthRequired={handleAuthRequired}
            onSignUp={signupArgs !== null ? handleSignUp : undefined}
          />
          {/* Where to ask when the invitation doesn't work: the server's own link, or nothing. */}
          <HelpLink className="text-center" />
        </div>
      </div>
    </StigmerProvider>
  );
}

/**
 * Leave the way back to this invite page and the auto-accept flag, then
 * go to the issuer: to sign in, or, with the sign-up arguments, to its
 * create-account screen. Either way the person returns here, signed in,
 * and the invitation is redeemed without a second click.
 */
function startRedirect(args?: SigninRedirectArgs): void {
  const config = resolveAuthConfig();
  if (config.mode !== "oidc") return;
  sessionStorage.setItem(REDIRECT_PATH_KEY, window.location.pathname);
  sessionStorage.setItem(AUTO_ACCEPT_KEY, "1");
  void createUserManager(config.oidc).signinRedirect(args);
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

    const manager = createUserManager(config.oidc);
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

/**
 * The issuer's sign-up arguments (`signupRedirectArgs`), or `null` while
 * they are read, when sign-in is off, when the issuer offers no sign-up
 * (an empty answer is an ordinary sign-in), or when reading them failed.
 * Only a non-empty answer offers "Create your account and join".
 */
function useSignupArgs(): SigninRedirectArgs | null {
  const [args, setArgs] = useState<SigninRedirectArgs | null>(null);

  useEffect(() => {
    const config = resolveAuthConfig();
    if (config.mode !== "oidc") return;

    let current = true;
    signupRedirectArgs(config.oidc, createUserManager(config.oidc))
      .then((resolved) => {
        if (current && Object.keys(resolved).length > 0) setArgs(resolved);
      })
      .catch(() => {
        // No sign-up to offer: the one sign-in button stays.
      });
    return () => {
      current = false;
    };
  }, []);

  return args;
}
