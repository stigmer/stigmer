"use client";

import type { EnvironmentAvailability, ServerInfo } from "@stigmer/client";
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
 * down — embedding settings ask whether the server can mint user tokens
 * at all, which only a server that authenticates its callers
 * does. The deployment mode stays a provider prop (`StigmerProvider`'s
 * `deploymentMode`), because every tier gate reads it on first render.
 *
 * A console ships on its own schedule, so it can meet a server older than
 * itself: `authenticationRequired` is `undefined` there, and only an
 * explicit `false` means the server trusts every request.
 *
 * Cached across mounts under a {@link FetchCacheProvider}: the answer is a
 * property of the server, so a revisit renders it immediately.
 *
 * @example
 * ```tsx
 * const { serverInfo } = useServerInfo();
 * const trustsEveryRequest = serverInfo?.authenticationRequired === false;
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

/**
 * Whether the connected server holds one organization and fills it into
 * every call that names none (`serverInfo.singleOrg`, the open-source
 * edition). A surface that names organizations — the switcher, the
 * "Organization" settings group, the workbench's organization column —
 * hides on `true`. The create-an-organization onboarding does not read it:
 * on such a server every person who signs in holds a role on its
 * organization, so the onboarding shows only to someone whose role was
 * removed, or on a server whose organization could not be made.
 *
 * `undefined` while the answer is loading, so a surface waits rather than
 * flashing an organization it will hide; `false` once the server answered
 * otherwise, failed to answer, or predates the field, so organizations
 * show as they always have.
 *
 * @example
 * ```tsx
 * const singleOrg = useSingleOrg();
 * return singleOrg === false ? <OrgSwitcher /> : null;
 * ```
 */
export function useSingleOrg(): boolean | undefined {
  const { serverInfo, isLoading } = useServerInfo();
  if (isLoading) {
    return undefined;
  }
  return serverInfo?.singleOrg === true;
}

/**
 * What an Environment does on the connected server
 * (`serverInfo.environments`): whether one governs the conversations a
 * console, the CLI, a routine, a channel or a chat link starts, and what
 * the server's sandboxes can do with one. Each answer is the one the
 * server's own refusals give, so a surface that says "this server's
 * sandboxes can't limit networking" before anyone tries says what saving
 * would have said.
 *
 * `undefined` while the answer is loading, when it failed, and on a server
 * that predates the field: a surface then offers Environments and lets the
 * server's refusals speak, as it always did.
 *
 * @example
 * ```tsx
 * const environments = useEnvironmentAvailability();
 * const limitedDisabled = environments?.limitedNetworking === false;
 * ```
 */
export function useEnvironmentAvailability(): EnvironmentAvailability | undefined {
  const { serverInfo } = useServerInfo();
  return serverInfo?.environments;
}
