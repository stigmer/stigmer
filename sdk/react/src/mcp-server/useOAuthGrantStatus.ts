"use client";

import { create } from "@bufbuild/protobuf";
import {
  OAuthConnectionHealth,
  GetOAuthGrantStatusInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useOAuthGrantStatus}. */
export interface UseOAuthGrantStatusReturn {
  /** Whether the user has an active OAuth grant for this resource + org. */
  readonly connected: boolean;
  /**
   * When the access token expires (Unix timestamp seconds).
   * `BigInt(0)` when no grant exists or the token does not expire.
   */
  readonly accessTokenExpiresAt: bigint;
  /** The env var name managed by OAuth, or empty string when no grant exists. */
  readonly targetEnvVar: string;
  /** Auth method used (`"mcp_oauth"` or `"vendor_oauth"`), or empty string. */
  readonly authMethod: string;
  /**
   * Health of the OAuth connection, as evaluated by the backend.
   *
   * Gives the frontend an actionable signal beyond the binary `connected`
   * boolean: healthy, expired-but-refreshable, expired (re-auth needed),
   * or no grant at all. `UNSPECIFIED` when the status has not been fetched.
   */
  readonly connectionHealth: OAuthConnectionHealth;
  /** `true` while the grant status is being fetched. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the grant status. */
  readonly refetch: () => void;
}

const BIGINT_ZERO = BigInt(0);

interface OAuthGrantData {
  connected: boolean;
  accessTokenExpiresAt: bigint;
  targetEnvVar: string;
  authMethod: string;
  connectionHealth: OAuthConnectionHealth;
}

const IDLE_DATA: OAuthGrantData = {
  connected: false,
  accessTokenExpiresAt: BIGINT_ZERO,
  targetEnvVar: "",
  authMethod: "",
  connectionHealth: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_UNSPECIFIED,
};

/**
 * Data hook that fetches the OAuth grant status for a single MCP server.
 *
 * Wraps `stigmer.mcpServer.getOAuthGrantStatus()` with loading, error,
 * and idle state management. When `resourceId` or `org` changes, the
 * previous in-flight request is discarded and a fresh fetch begins.
 *
 * Pass `null` for either parameter to skip fetching (stable no-op).
 * This is useful when the MCP server resource has not loaded yet.
 *
 * @example
 * ```tsx
 * const grantStatus = useOAuthGrantStatus(mcpServer?.metadata?.id ?? null, org);
 *
 * if (grantStatus.isLoading) return <Spinner />;
 * if (grantStatus.connected) return <span>Connected via OAuth</span>;
 * return <button onClick={startOAuth}>Sign in</button>;
 * ```
 */
export function useOAuthGrantStatus(
  resourceId: string | null,
  org: string | null,
): UseOAuthGrantStatusReturn {
  const stigmer = useStigmer();

  const { data, isLoading, isRefetching, error, refetch } = useFetch<OAuthGrantData>(
    resourceId && org
      ? async () => {
          const result = await stigmer.mcpServer.getOAuthGrantStatus(
            create(GetOAuthGrantStatusInputSchema, { resourceId, org }),
          );
          return {
            connected: result.connected,
            accessTokenExpiresAt: result.accessTokenExpiresAt,
            targetEnvVar: result.targetEnvVar,
            authMethod: result.authMethod,
            connectionHealth: result.connectionHealth,
          };
        }
      : null,
    [resourceId, org, stigmer],
    IDLE_DATA,
  );

  return { ...data, isLoading, isRefetching, error, refetch };
}
