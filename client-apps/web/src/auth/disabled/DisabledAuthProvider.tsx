"use client";

import { useMemo } from "react";
import { AuthContext } from "../context";
import type { AuthState } from "../types";

const noop = () => {};

/**
 * Auth provider for disabled mode (local OSS use).
 *
 * Always reports `isAuthenticated: true` with no user identity and no
 * access token. Login and logout are no-ops. The transport layer will
 * not send an `Authorization` header since `accessToken` is `null`.
 *
 * This provider does NOT call `setAuthToken()` — there is no token to
 * store in disabled mode. The token store remains `null`, which the
 * transport interceptor already handles (it only adds the header when
 * a token is present).
 */
export function DisabledAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = useMemo<AuthState>(
    () => ({
      isAuthenticated: true,
      isLoading: false,
      user: null,
      accessToken: null,
      login: noop,
      logout: noop,
    }),
    [],
  );

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
