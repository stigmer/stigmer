"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User, UserManager } from "oidc-client-ts";
import { AuthContext } from "../context";
import { setAuthToken } from "../token-store";
import type { AuthState, AuthUser } from "../types";
import type { OidcConfig } from "./types";
import { createUserManager } from "./oidc-manager";

const CALLBACK_PATH = "/auth/callback";
/** The signed-out landing — the console's own sign-in page. */
const LOGIN_PATH = "/login";
const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/** Drop the stored session; the entry may already be gone. */
async function removeUserBestEffort(manager: UserManager): Promise<void> {
  try {
    await manager.removeUser();
  } catch {
    // Nothing to remove is the state we wanted.
  }
}

/**
 * OIDC auth provider — manages the full OIDC lifecycle.
 *
 * Creates an oidc-client-ts `UserManager` and subscribes to its events to
 * track authentication state. Provides the standard {@link AuthState} via
 * {@link AuthContext}, keeping the public API identical to
 * `DisabledAuthProvider`.
 *
 * **Any standards-compliant issuer**: the provider is configured from the
 * runtime config the deployment publishes — Stigmer Cloud's Auth0 tenant,
 * or a self-hosted server's own issuer (Keycloak, Okta, Dex, …) through
 * `STIGMER_OIDC_CONSOLE_CLIENT_ID` (stigmer#924). Nothing in
 * here is vendor-shaped: discovery, PKCE, refresh and sign-out are the
 * OIDC standard's, so the same code signs in against every one of them.
 *
 * **Callback detection**: On mount, if the current path is `/auth/callback`,
 * the provider processes the Authorization Code exchange via
 * `signinRedirectCallback()` before allowing children to render. After a
 * successful exchange the browser navigates to the pre-login path (stored
 * in sessionStorage) with a full page load, which lets the provider
 * re-initialize cleanly from the persisted session.
 *
 * **Session restore**: On a normal page load, `getUser()` restores a valid
 * session from sessionStorage. If no session exists, `isAuthenticated`
 * remains `false` and `AuthGuard` triggers `login()`.
 *
 * **Silent renewal**: With `offline_access` scope, Auth0 issues refresh
 * tokens. The `UserManager` is configured with `automaticSilentRenew` to
 * transparently renew access tokens before they expire.
 */
export default function OidcAuthProvider({
  config,
  children,
}: {
  config: OidcConfig;
  children: React.ReactNode;
}) {
  // Lazy-init so the UserManager is constructed once per mount, not built
  // and discarded on every render (useRef arguments are evaluated
  // unconditionally). Populated during the first render, so it is always
  // non-null by the time effects and callbacks run.
  const managerRef = useRef<UserManager | null>(null);
  managerRef.current ??= createUserManager(config);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    const manager = managerRef.current!;
    const isCallback = window.location.pathname === CALLBACK_PATH;

    const init = async () => {
      try {
        if (isCallback) {
          // The callback processing is single-flighted at module scope, so
          // this effect body must stay idempotent: React StrictMode runs
          // mount effects twice, and both runs land here with identical
          // values. setUser/setAuthToken are naturally idempotent, and
          // replace() with the same URL is harmless.
          const { user: callbackUser, redirectPath } =
            await processCallback(manager);
          setUser(callbackUser);
          setAuthToken(callbackUser.access_token);

          window.location.replace(redirectPath);
          // Don't set isLoading=false — the full-page navigation will
          // unmount this tree. Keeping isLoading=true prevents AuthGuard
          // from flashing content at the callback URL.
          return;
        }

        const existing = await manager.getUser();
        if (existing && !existing.expired) {
          setUser(existing);
          setAuthToken(existing.access_token);
        }
      } catch (err) {
        if (isCallback) {
          const message =
            err instanceof Error ? err.message : "Authentication failed";
          console.error("[auth] callback exchange failed:", err);
          setCallbackError(message);
        } else {
          console.error("[auth] session restore failed:", err);
        }
      }
      setIsLoading(false);
    };

    init();

    const onUserLoaded = (loaded: User) => {
      setUser(loaded);
      setAuthToken(loaded.access_token);
    };

    const onUserUnloaded = () => {
      setUser(null);
      setAuthToken(null);
    };

    const onTokenExpired = () => {
      setUser(null);
      setAuthToken(null);
    };

    manager.events.addUserLoaded(onUserLoaded);
    manager.events.addUserUnloaded(onUserUnloaded);
    manager.events.addAccessTokenExpired(onTokenExpired);

    return () => {
      manager.events.removeUserLoaded(onUserLoaded);
      manager.events.removeUserUnloaded(onUserUnloaded);
      manager.events.removeAccessTokenExpired(onTokenExpired);
    };
  }, []);

  const login = useCallback(() => {
    const path = window.location.pathname + window.location.search;
    sessionStorage.setItem(REDIRECT_PATH_KEY, path);
    managerRef.current!.signinRedirect();
  }, []);

  // Sign-out speaks only the OIDC standard.
  // An issuer that publishes `end_session_endpoint` (Auth0, Keycloak,
  // Okta) gets RP-initiated logout and sends the browser back to
  // `post_logout_redirect_uri` — /login, the signed-out landing. An issuer
  // that publishes none (Dex, or any issuer with no logout endpoint) gets a
  // local sign-out that lands on the same page. Either way the person sees
  // that they are signed out; landing on "/" would let AuthGuard march them
  // straight back into the issuer. No vendor URL is ever built here.
  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    setAuthToken(null);
    const manager = managerRef.current!;

    const endSession = await manager.metadataService
      .getEndSessionEndpoint()
      .catch(() => undefined);
    if (endSession !== undefined) {
      try {
        await manager.signoutRedirect();
        return;
      } catch (err) {
        console.error(
          "[auth] signoutRedirect failed; signing out locally:",
          err,
        );
      }
    }
    await removeUserBestEffort(manager);
    window.location.replace(LOGIN_PATH);
  }, []);

  const authUser = useMemo<AuthUser | null>(() => {
    if (!user?.profile) return null;
    return {
      email: (user.profile.email as string) ?? "",
      name: (user.profile.name as string) ?? undefined,
      picture: (user.profile.picture as string) ?? undefined,
    };
  }, [user]);

  const state = useMemo<AuthState>(
    () => ({
      isAuthenticated: user !== null && !user.expired,
      isLoading: isLoading || isLoggingOut,
      user: authUser,
      accessToken: user?.access_token ?? null,
      login,
      logout,
    }),
    [user, isLoading, isLoggingOut, authUser, login, logout],
  );

  // If the callback exchange failed, show the error with a retry action
  // instead of allowing AuthGuard to loop back into login().
  if (callbackError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="text-destructive text-sm font-medium">Login Failed</p>
        <p className="text-muted-foreground max-w-md text-center text-sm">
          {callbackError}
        </p>
        <button
          onClick={login}
          className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-4 py-2 text-sm font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Callback processing — single-flight
// ---------------------------------------------------------------------------

/** Everything the mount effect needs after a successful code exchange. */
interface CallbackResult {
  /** The authenticated user returned by the token exchange. */
  readonly user: User;
  /** Pre-login path to navigate to (consumed from sessionStorage). */
  readonly redirectPath: string;
}

/**
 * In-flight (or settled) callback processing for this page load.
 *
 * Module scope is deliberate: the one-time authorization code in the URL
 * is page-load-scoped, so the memo's lifetime matches the resource it
 * protects. Both success and failure paths leave `/auth/callback` via a
 * full-page navigation, which resets this state naturally.
 */
let callbackResult: Promise<CallbackResult> | null = null;

/**
 * Process the `/auth/callback` of the deployment's own sign-in.
 *
 * Single-flighted: React StrictMode runs mount effects twice, and any
 * remount of the provider on the callback page would otherwise redeem the
 * one-time authorization code a second time — the identity provider
 * rejects that with `invalid_grant` ("Invalid authorization code").
 * Every non-idempotent step (token exchange, redirect-path consumption)
 * lives inside the memoized run so all
 * callers receive identical, safely reusable values.
 */
function processCallback(manager: UserManager): Promise<CallbackResult> {
  callbackResult ??= doCallbackExchange(manager);
  return callbackResult;
}

/**
 * Perform the authorization-code exchange with the deployment's issuer,
 * then consume (read + remove) the saved pre-login path.
 */
async function doCallbackExchange(
  manager: UserManager,
): Promise<CallbackResult> {
  const callbackUser = await manager.signinRedirectCallback();

  const redirectPath = sessionStorage.getItem(REDIRECT_PATH_KEY) ?? "/";
  sessionStorage.removeItem(REDIRECT_PATH_KEY);

  return { user: callbackUser, redirectPath };
}
