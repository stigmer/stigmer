"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User, UserManager } from "oidc-client-ts";
import { AuthContext } from "../context";
import { setAuthToken } from "../token-store";
import type { AuthState, AuthUser } from "../types";
import type { OidcConfig } from "./types";
import { createUserManager } from "./oidc-manager";
import {
  getSsoLoginState,
  clearSsoLoginState,
  saveSsoSession,
  getSsoSession,
  clearSsoSession,
  isValidSsoState,
} from "./sso-session";

const CALLBACK_PATH = "/auth/callback";
const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/**
 * Resolve the UserManager for the current session.
 *
 * If an SSO session exists in sessionStorage (written after a successful
 * SSO callback), create a UserManager configured for the SSO IdP so that
 * `getUser()` restores the SSO session and `automaticSilentRenew` renews
 * against the correct token endpoint.
 *
 * Otherwise, fall back to the Auth0 manager from runtime config.
 */
function resolveActiveManager(auth0Config: OidcConfig) {
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
 * OIDC auth provider — manages the full OIDC lifecycle.
 *
 * Creates an oidc-client-ts `UserManager` and subscribes to its events to
 * track authentication state. Provides the standard {@link AuthState} via
 * {@link AuthContext}, keeping the public API identical to
 * `DisabledAuthProvider`.
 *
 * **SSO support**: Detects SSO callbacks via `stigmer:sso:login` in
 * sessionStorage. When present, creates a temporary SSO `UserManager` for
 * the code exchange, then persists the SSO config as `stigmer:sso:session`
 * so future page loads restore the session with the correct IdP. On
 * logout, SSO sessions are cleared locally and the user is redirected to
 * `/login?org=...` (no RP-initiated logout with the SSO IdP).
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
  const managerRef = useRef(resolveActiveManager(config));
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    const manager = managerRef.current;
    const isCallback = window.location.pathname === CALLBACK_PATH;

    const init = async () => {
      try {
        if (isCallback) {
          const callbackUser = await processSsoOrAuth0Callback(manager);
          setUser(callbackUser);
          setAuthToken(callbackUser.access_token);

          const savedPath =
            sessionStorage.getItem(REDIRECT_PATH_KEY) ?? "/";
          sessionStorage.removeItem(REDIRECT_PATH_KEY);
          window.location.replace(savedPath);
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
    managerRef.current.signinRedirect();
  }, []);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    setAuthToken(null);

    const ssoSession = getSsoSession();
    if (ssoSession) {
      clearSsoSession();
      try {
        await managerRef.current.removeUser();
      } catch {
        // Best-effort — the session storage entry may already be gone.
      }
      const orgParam = ssoSession.org ? `?org=${encodeURIComponent(ssoSession.org)}` : "";
      window.location.replace(`/login${orgParam}`);
      return;
    }

    try {
      await managerRef.current.signoutRedirect();
    } catch (err) {
      console.error("[auth] signoutRedirect failed, falling back:", err);
      const issuer = config.issuer.replace(/\/+$/, "");
      const params = new URLSearchParams({
        client_id: config.clientId,
        post_logout_redirect_uri: window.location.origin,
        returnTo: window.location.origin,
      });
      window.location.replace(`${issuer}/v2/logout?${params}`);
    }
  }, [config.issuer, config.clientId]);

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
// SSO callback detection
// ---------------------------------------------------------------------------

/**
 * Process the `/auth/callback` for either an SSO or Auth0 login.
 *
 * Checks sessionStorage for SSO login state (written by the login page
 * before the SSO redirect). If present, creates an SSO-specific
 * UserManager to exchange the authorization code, persists the SSO
 * session config for future page loads, and cleans up the ephemeral
 * login state. If absent, delegates to the default Auth0 manager.
 */
async function processSsoOrAuth0Callback(
  auth0Manager: UserManager,
): Promise<User> {
  const ssoLogin = getSsoLoginState();

  if (ssoLogin && isValidSsoState(ssoLogin)) {
    const ssoManager = createUserManager({
      issuer: ssoLogin.issuer,
      clientId: ssoLogin.clientId,
      audience: ssoLogin.audience,
    });

    const callbackUser = await ssoManager.signinRedirectCallback();

    saveSsoSession(ssoLogin);
    clearSsoLoginState();

    return callbackUser;
  }

  return auth0Manager.signinRedirectCallback();
}
