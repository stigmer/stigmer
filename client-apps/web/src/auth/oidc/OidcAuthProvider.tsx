"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "oidc-client-ts";
import { AuthContext } from "../context";
import { setAuthToken } from "../token-store";
import type { AuthState, AuthUser } from "../types";
import type { OidcConfig } from "./types";
import { createUserManager } from "./oidc-manager";

const CALLBACK_PATH = "/auth/callback";
const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/**
 * OIDC auth provider — manages the full OIDC lifecycle.
 *
 * Creates an oidc-client-ts `UserManager` and subscribes to its events to
 * track authentication state. Provides the standard {@link AuthState} via
 * {@link AuthContext}, keeping the public API identical to
 * `DisabledAuthProvider`.
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
  const managerRef = useRef(createUserManager(config));
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    const manager = managerRef.current;
    const isCallback = window.location.pathname === CALLBACK_PATH;

    const init = async () => {
      try {
        if (isCallback) {
          const callbackUser = await manager.signinRedirectCallback();
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

  const logout = useCallback(() => {
    setAuthToken(null);
    managerRef.current.signoutRedirect();
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
      isLoading,
      user: authUser,
      accessToken: user?.access_token ?? null,
      login,
      logout,
    }),
    [user, isLoading, authUser, login, logout],
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
