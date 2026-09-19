"use client";

/**
 * What stands between an installed MCP server and its first tool call,
 * as one state a row can render: signed in, sign-in needed (with the act
 * that does it), an API key to give, or nothing at all.
 *
 * The decision is the connect dialog's and the server page's, reduced to
 * a line: `useMcpServerCredentials` says whether the server authenticates
 * by OAuth (`spec.auth`) and whether a grant already stands; a server with
 * declared variables and no `auth` wants a key; a server with neither is
 * open. The sign-in itself is `useMcpServerOAuthConnect`, one instance per
 * server (a plugin holds one to three; the picker's shared instance and
 * per-server keying serve a long list). When the sign-in lands, the
 * credentials refetch so the row turns to "Signed in" without a reload.
 *
 * Trade-off: the plugin's member list carries ids and slugs only, so each
 * row reads its server and its grant, one fetch each; a batch read would
 * be a proto change for a list of three.
 */

import { useCallback, useMemo } from "react";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { useMcpServer } from "../mcp-server/useMcpServer.js";
import { useMcpServerCredentials } from "../mcp-server/useMcpServerCredentials.js";
import { type OAuthConnectPhase, getOAuthConnectErrorMessage, useMcpServerOAuthConnect } from "../mcp-server/useMcpServerOAuthConnect.js";

/** One of the four things a server can want before its first tool call. */
export type McpServerReadinessKind =
  /** The server is being read. */
  | "loading"
  /** The server could not be read; `error` says why. */
  | "unreadable"
  /** OAuth, and a healthy grant stands for this organization. */
  | "signed-in"
  /** OAuth, and no grant stands (or the grant needs re-authentication); `signIn` starts one. */
  | "sign-in-needed"
  /** OAuth, but the vendor has not approved the platform's app yet; nothing to do here. */
  | "approval-pending"
  /** A static credential: the declared variables are given when the server is connected or when an agent that uses it starts. */
  | "api-key"
  /** Neither OAuth nor variables: nothing stands between the server and a tool call. */
  | "open";

/** Return value of {@link useMcpServerReadiness}. */
export interface UseMcpServerReadinessReturn {
  readonly kind: McpServerReadinessKind;
  /** The server, once read. */
  readonly mcpServer: McpServer | null;
  /** The grant's health as the backend grades it; `UNSPECIFIED` until read. */
  readonly connectionHealth: OAuthConnectionHealth;
  /** The variables an `api-key` server declares, in declaration order. */
  readonly declaredVariables: readonly string[];
  /** The read error, or the last sign-in error, or `null`. */
  readonly error: Error | null;
  /** Start the OAuth sign-in. Call from a click handler so the popup is allowed. A no-op unless `kind` is `sign-in-needed`. */
  readonly signIn: () => void;
  /** The sign-in's phase; `idle` when none is running. */
  readonly phase: OAuthConnectPhase;
  /** `true` while a sign-in is in flight. */
  readonly isSigningIn: boolean;
  /** Read the server and its grant again. */
  readonly refetch: () => void;
}

/**
 * Behaviour hook for one installed MCP server's readiness. Pass `null` for
 * either argument to hold the hook idle.
 *
 * @example
 * ```tsx
 * const readiness = useMcpServerReadiness(org, member.slug);
 * if (readiness.kind === "sign-in-needed") return <button onClick={readiness.signIn}>Sign in</button>;
 * ```
 */
export function useMcpServerReadiness(
  org: string | null,
  slug: string | null,
  onSignedIn?: (mcpServerId: string) => void,
): UseMcpServerReadinessReturn {
  const { mcpServer, isLoading, error: readError, refetch: refetchServer } = useMcpServer(org, slug);
  const credentials = useMcpServerCredentials(org, mcpServer);
  const oauth = useMcpServerOAuthConnect();

  const declaredVariables = useMemo(() => Object.keys(mcpServer?.spec?.env ?? {}), [mcpServer]);

  const kind = useMemo<McpServerReadinessKind>(() => {
    if (readError) return "unreadable";
    if (isLoading || mcpServer === null) return "loading";
    if (credentials.authMode === "oauth") {
      if (credentials.isOAuthConnected && credentials.connectionHealth !== OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED) {
        return "signed-in";
      }
      if (credentials.isVendorApprovalBlocked) return "approval-pending";
      return "sign-in-needed";
    }
    return declaredVariables.length > 0 ? "api-key" : "open";
  }, [readError, isLoading, mcpServer, credentials.authMode, credentials.isOAuthConnected, credentials.connectionHealth, credentials.isVendorApprovalBlocked, declaredVariables.length]);

  const refetch = useCallback(() => {
    refetchServer();
    credentials.refetch();
  }, [refetchServer, credentials.refetch]);

  const signIn = useCallback(() => {
    const id = mcpServer?.metadata?.id;
    if (kind !== "sign-in-needed" || !id || org === null) return;
    oauth.clearError();
    // A sign-in that fails leaves the row on "Sign in" with the reason; one
    // that lands refetches so the row says "Signed in" from the grant.
    void oauth.startOAuth(id, org, declaredVariables).then(
      () => {
        refetch();
        onSignedIn?.(id);
      },
      () => undefined,
    );
  }, [kind, mcpServer, org, oauth.clearError, oauth.startOAuth, declaredVariables, refetch, onSignedIn]);

  const error = useMemo(() => {
    if (readError) return readError;
    if (oauth.error) return new Error(getOAuthConnectErrorMessage(oauth.error, oauth.failedPhase));
    return null;
  }, [readError, oauth.error, oauth.failedPhase]);

  return useMemo(
    () => ({
      kind,
      mcpServer,
      connectionHealth: credentials.connectionHealth,
      declaredVariables,
      error,
      signIn,
      phase: oauth.phase,
      isSigningIn: oauth.isInProgress,
      refetch,
    }),
    [kind, mcpServer, credentials.connectionHealth, declaredVariables, error, signIn, oauth.phase, oauth.isInProgress, refetch],
  );
}
