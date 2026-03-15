"use client";

import { useMemo, type ReactNode } from "react";
import type { StigmerRpcConfig } from "./types";
import { createStigmerTransport } from "./transport";
import { StigmerTransportContext } from "./context";

export interface StigmerTransportProviderProps extends StigmerRpcConfig {
  readonly children: ReactNode;
}

/**
 * React provider that creates a Stigmer RPC transport and distributes it
 * to descendant components via {@link StigmerTransportContext}.
 *
 * The transport is memoized on `(serverUrl, getAccessToken, interceptors)`.
 * To avoid unnecessary transport recreation on re-renders, stabilize the
 * callback and interceptor references in the parent component:
 *
 * ```tsx
 * const getToken = useCallback(() => auth.accessToken, [auth.accessToken]);
 *
 * <StigmerTransportProvider
 *   serverUrl="http://localhost:7234"
 *   getAccessToken={getToken}
 * >
 *   <App />
 * </StigmerTransportProvider>
 * ```
 *
 * When `getAccessToken` is omitted (disabled auth mode), the transport is
 * recreated only when `serverUrl` changes.
 */
export function StigmerTransportProvider({
  serverUrl,
  getAccessToken,
  interceptors,
  children,
}: StigmerTransportProviderProps) {
  const transport = useMemo(
    () =>
      createStigmerTransport({
        serverUrl,
        getAccessToken,
        interceptors,
      }),
    [serverUrl, getAccessToken, interceptors],
  );

  return (
    <StigmerTransportContext.Provider value={transport}>
      {children}
    </StigmerTransportContext.Provider>
  );
}
