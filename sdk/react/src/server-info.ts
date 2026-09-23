"use client";

import type { ServerInfo } from "@stigmer/sdk";
import { useStigmer } from "./hooks.js";
import { useFetch } from "./internal/useFetch.js";

/** Return value of {@link useServerInfo}. */
export interface UseServerInfoReturn {
  /** The connected server's edition, version and posture, or `null` while loading / on error. */
  readonly serverInfo: ServerInfo | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Data hook for the connected server's identity: its edition, its version
 * and whether it authenticates its callers (`platform.getServerInfo()`, a
 * public RPC every edition answers).
 *
 * Read it where a surface depends on a fact the host app does not pass
 * down — the PlatformClients section asks whether the server can mint
 * user tokens at all, which only a server that authenticates its callers
 * does. The deployment mode stays a provider prop (`StigmerProvider`'s
 * `deploymentMode`), because every tier gate reads it on first render.
 *
 * Cached across mounts under a {@link FetchCacheProvider}: the answer is a
 * property of the server, so a revisit renders it immediately.
 *
 * @example
 * ```tsx
 * const { serverInfo } = useServerInfo();
 * const canMint = serverInfo?.authenticationRequired === true;
 * ```
 */
export function useServerInfo(): UseServerInfoReturn {
  const stigmer = useStigmer();
  const {
    data: serverInfo,
    isLoading,
    error,
  } = useFetch<ServerInfo | null>(
    () => stigmer.platform.getServerInfo(),
    [stigmer],
    null,
    { cacheKey: "server-info" },
  );
  return { serverInfo, isLoading, error };
}
