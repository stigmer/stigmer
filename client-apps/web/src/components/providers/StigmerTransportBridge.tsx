"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";
import { useAuth } from "@/auth/use-auth";
import { getApiBaseUrl } from "@/config/env";

/**
 * Bridges the console's auth system to the Stigmer SDK provider.
 *
 * Creates a {@link Stigmer} client configured with the current user's
 * access token and an auth-redirect handler (auto-logout on
 * UNAUTHENTICATED responses). The client instance is memoized on the
 * token-provider callback to avoid unnecessary re-creation.
 *
 * Must be rendered as a child of `AuthGuard` (auth must be resolved first).
 */
export function StigmerTransportBridge({ children }: { children: ReactNode }) {
  const { accessToken, logout } = useAuth();

  const getAccessToken = useCallback(() => accessToken, [accessToken]);
  const onUnauthenticated = useCallback(() => logout(), [logout]);

  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: getApiBaseUrl(),
        getAccessToken,
        onUnauthenticated,
      }),
    [getAccessToken, onUnauthenticated],
  );

  return (
    <StigmerProvider client={client}>
      {children}
    </StigmerProvider>
  );
}
