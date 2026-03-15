"use client";

import { useCallback, type ReactNode } from "react";
import { StigmerTransportProvider } from "@stigmer/rpc-client";
import { useAuth } from "@/auth/use-auth";
import { getApiBaseUrl } from "@/config/env";

/**
 * Bridges the console's auth system to the library's transport provider.
 *
 * Reads the access token and logout action from {@link useAuth}, and the
 * server URL from environment config, then feeds them into
 * {@link StigmerTransportProvider} so that all `@stigmer/*` library hooks
 * receive a configured transport.
 *
 * Wires the auth redirect interceptor: when the server responds with
 * UNAUTHENTICATED (expired or invalid token), the user is logged out
 * automatically. In disabled auth mode, `logout` is a no-op.
 *
 * Must be rendered as a child of `AuthGuard` (auth must be resolved first).
 */
export function StigmerTransportBridge({ children }: { children: ReactNode }) {
  const { accessToken, logout } = useAuth();

  const getAccessToken = useCallback(() => accessToken, [accessToken]);
  const onUnauthenticated = useCallback(() => logout(), [logout]);

  return (
    <StigmerTransportProvider
      serverUrl={getApiBaseUrl()}
      getAccessToken={getAccessToken}
      onUnauthenticated={onUnauthenticated}
    >
      {children}
    </StigmerTransportProvider>
  );
}
