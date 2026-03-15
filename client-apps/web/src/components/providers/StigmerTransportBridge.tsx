"use client";

import { useCallback, type ReactNode } from "react";
import { StigmerTransportProvider } from "@stigmer/rpc-client";
import { useAuth } from "@/auth/use-auth";
import { getApiBaseUrl } from "@/config/env";

/**
 * Bridges the console's auth system to the library's transport provider.
 *
 * Reads the access token from {@link useAuth} and the server URL from
 * environment config, then feeds them into {@link StigmerTransportProvider}
 * so that all `@stigmer/*` library hooks receive a configured transport.
 *
 * Must be rendered as a child of `AuthGuard` (auth must be resolved first).
 */
export function StigmerTransportBridge({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth();

  const getAccessToken = useCallback(
    () => accessToken,
    [accessToken],
  );

  return (
    <StigmerTransportProvider
      serverUrl={getApiBaseUrl()}
      getAccessToken={getAccessToken}
    >
      {children}
    </StigmerTransportProvider>
  );
}
