"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  OAuthConnectionHealth,
  GetOAuthGrantStatusInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

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
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the grant status. */
  readonly refetch: () => void;
}

const BIGINT_ZERO = BigInt(0);

const IDLE: UseOAuthGrantStatusReturn = {
  connected: false,
  accessTokenExpiresAt: BIGINT_ZERO,
  targetEnvVar: "",
  authMethod: "",
  connectionHealth: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_UNSPECIFIED,
  isLoading: false,
  error: null,
  refetch: () => {},
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
  const [connected, setConnected] = useState(false);
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState(BIGINT_ZERO);
  const [targetEnvVar, setTargetEnvVar] = useState("");
  const [authMethod, setAuthMethod] = useState("");
  const [connectionHealth, setConnectionHealth] = useState(
    OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_UNSPECIFIED,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!resourceId || !org) {
      setConnected(false);
      setAccessTokenExpiresAt(BIGINT_ZERO);
      setTargetEnvVar("");
      setAuthMethod("");
      setConnectionHealth(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_UNSPECIFIED);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.mcpServer
      .getOAuthGrantStatus(create(GetOAuthGrantStatusInputSchema, { resourceId, org }))
      .then(
        (result) => {
          if (cancelled.current) return;
          setConnected(result.connected);
          setAccessTokenExpiresAt(result.accessTokenExpiresAt);
          setTargetEnvVar(result.targetEnvVar);
          setAuthMethod(result.authMethod);
          setConnectionHealth(result.connectionHealth);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [resourceId, org, stigmer, fetchKey]);

  if (!resourceId || !org) return { ...IDLE, refetch };

  return {
    connected,
    accessTokenExpiresAt,
    targetEnvVar,
    authMethod,
    connectionHealth,
    isLoading,
    error,
    refetch,
  };
}
