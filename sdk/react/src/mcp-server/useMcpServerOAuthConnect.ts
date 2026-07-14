"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  InitiateOAuthConnectInputSchema,
  CompleteOAuthConnectInputSchema,
  ConnectInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { resolveDeclaredSystemEnvVars } from "../environment/systemEnvVars.js";
import { toError } from "../internal/toError.js";
import {
  openOAuthPopup,
  popupBlockedError,
  waitForOAuthCallback,
  closeOAuthPopup,
} from "../internal/oauthPopup.js";

// Re-exported for compatibility: these constants and the message type now
// live in the shared popup machinery (internal/oauthPopup.ts) because the
// channel-install flow uses the same callback contract.
export {
  OAUTH_CALLBACK_MESSAGE_TYPE,
  OAUTH_BROADCAST_CHANNEL,
  type OAuthCallbackMessage,
} from "../internal/oauthPopup.js";

/** Progress phases of the OAuth connect flow. */
export type OAuthConnectPhase =
  | "idle"
  | "initiating"
  | "awaiting-callback"
  | "completing"
  | "connecting"
  | "done";

/** Return value of {@link useMcpServerOAuthConnect}. */
export interface UseMcpServerOAuthConnectReturn {
  /**
   * Start the OAuth connect flow for an MCP server.
   *
   * Opens a popup for the OAuth consent screen, waits for the callback,
   * exchanges the authorization code for tokens, then chains to the
   * `connect` RPC for tool discovery.
   *
   * **Must be called from a synchronous user-gesture handler** (e.g.,
   * an `onClick` callback) so the browser allows the popup. The popup
   * is opened synchronously before any async work to avoid popup
   * blockers.
   *
   * @param mcpServerId - System-generated ID (metadata.id) of the MCP server.
   * @param org - Organization context for token storage (caller's active org).
   * @param declaredEnvKeys - Keys from the server's `spec.env` declaration.
   *   System vars are only injected when declared here.
   * @returns The updated McpServer after tool discovery completes.
   */
  readonly startOAuth: (mcpServerId: string, org: string, declaredEnvKeys?: readonly string[]) => Promise<McpServer>;
  /** `true` while any phase of the OAuth flow is in progress. */
  readonly isInProgress: boolean;
  /** Current phase of the OAuth flow. */
  readonly phase: OAuthConnectPhase;
  /** Error from the most recent unsuccessful attempt, or `null`. */
  readonly error: Error | null;
  /** Reset the hook to idle state, clearing any error. */
  readonly clearError: () => void;
}

/**
 * Action hook that orchestrates the full OAuth popup flow for MCP servers.
 *
 * Handles the complete lifecycle:
 * 1. Calls `initiateOAuthConnect` to get the authorization URL
 * 2. Opens a popup window to the OAuth consent screen
 * 3. Listens for the callback via `window.postMessage`
 * 4. Calls `completeOAuthConnect` to exchange the code for tokens
 * 5. Chains to `connect` for tool discovery
 *
 * The popup is opened **synchronously** before the `initiateOAuthConnect`
 * RPC to avoid browser popup blockers. A blank page is shown briefly
 * while the RPC resolves, then the popup navigates to the auth URL.
 *
 * Popup plumbing (callback wait, COOP fallbacks, cancellation) lives in
 * the shared `internal/oauthPopup.ts` machinery.
 *
 * @example
 * ```tsx
 * const oauth = useMcpServerOAuthConnect();
 * const { refetch } = useMcpServer(org, slug);
 *
 * async function handleSignIn() {
 *   try {
 *     await oauth.startOAuth(mcpServer.metadata.id, org);
 *     refetch();
 *   } catch {
 *     // error is available via oauth.error
 *   }
 * }
 *
 * <button onClick={handleSignIn} disabled={oauth.isInProgress}>
 *   {oauth.isInProgress ? "Signing in..." : "Sign in with OAuth"}
 * </button>
 * ```
 */
export function useMcpServerOAuthConnect(): UseMcpServerOAuthConnectReturn {
  const stigmer = useStigmer();
  const [phase, setPhase] = useState<OAuthConnectPhase>("idle");
  const [error, setError] = useState<Error | null>(null);

  const popupRef = useRef<Window | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const clearError = useCallback(() => {
    if (cleanupRef.current || popupRef.current) {
      cancelledRef.current = true;
      cleanupRef.current?.();
      closeOAuthPopup(popupRef.current);
      popupRef.current = null;
      cleanupRef.current = null;
    }
    setPhase("idle");
    setError(null);
  }, []);

  const startOAuth = useCallback(
    async (mcpServerId: string, org: string, declaredEnvKeys?: readonly string[]): Promise<McpServer> => {
      setPhase("initiating");
      setError(null);
      cancelledRef.current = false;

      cleanupRef.current?.();

      const popup = openOAuthPopup();
      if (!popup) {
        const blocked = popupBlockedError();
        setError(blocked);
        setPhase("idle");
        throw blocked;
      }

      popupRef.current = popup;

      try {
        const initOutput = await stigmer.mcpServer.initiateOAuthConnect(
          create(InitiateOAuthConnectInputSchema, { mcpServerId, org }),
        );

        popup.location.href = initOutput.authorizationUrl;
        setPhase("awaiting-callback");

        const { code, state } = await waitForOAuthCallback(
          popup,
          initOutput.state,
          (dispose) => {
            cleanupRef.current = dispose;
          },
        );

        setPhase("completing");

        await stigmer.mcpServer.completeOAuthConnect(
          create(CompleteOAuthConnectInputSchema, {
            mcpServerId,
            authorizationCode: code,
            state,
          }),
        );

        setPhase("connecting");

        const systemEnv = declaredEnvKeys
          ? await resolveDeclaredSystemEnvVars(stigmer, declaredEnvKeys)
          : {};
        const runtimeEnvMap: Record<string, { value: string; isSecret: boolean }> = {};
        for (const [key, envInput] of Object.entries(systemEnv)) {
          runtimeEnvMap[key] = {
            value: envInput.value,
            isSecret: envInput.isSecret ?? false,
          };
        }

        const input = create(ConnectInputSchema, {
          mcpServerId,
          org,
          ...(Object.keys(runtimeEnvMap).length > 0
            ? { runtimeEnv: runtimeEnvMap }
            : {}),
        });

        const server = await stigmer.mcpServer.connect(input);

        setPhase("done");
        return server;
      } catch (err) {
        const wrapped = toError(err);
        if (!cancelledRef.current) {
          setError(wrapped);
          setPhase("idle");
          closeOAuthPopup(popup);
        }
        cancelledRef.current = false;
        throw wrapped;
      } finally {
        popupRef.current = null;
        cleanupRef.current = null;
      }
    },
    [stigmer],
  );

  return {
    startOAuth,
    isInProgress: phase !== "idle" && phase !== "done",
    phase,
    error,
    clearError,
  };
}
