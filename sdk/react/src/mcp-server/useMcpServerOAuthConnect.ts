"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { StigmerError, connectAndWait, getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  InitiateOAuthConnectInputSchema,
  CompleteOAuthConnectInputSchema,
  ConnectInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks.js";
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

/**
 * User-facing message for an OAuth connect failure, honest about *where*
 * the chain broke.
 *
 * The flow persists state in two acts: `completeOAuthConnect` stores the
 * grant ("Connected" from then on), and only afterwards does the chained
 * `connect` run tool discovery. A failure in the `"connecting"` phase
 * therefore means sign-in itself SUCCEEDED — presenting the raw RPC error
 * alone reads as if OAuth failed and sends users back through the popup
 * for nothing (stigmer/stigmer#229). Every surface that renders
 * {@link UseMcpServerOAuthConnectReturn.error} should compose its copy
 * through this helper.
 *
 * The error object is never wrapped or mutated: `classifyError` /
 * `isRetryableError` dispatch on the original `StigmerError`/`ConnectError`
 * instance, so retry affordances keep working on the error as thrown.
 */
export function getOAuthConnectErrorMessage(
  error: Error,
  failedPhase: OAuthConnectPhase | null,
): string {
  const base = getUserMessage(error);
  if (failedPhase === "connecting") {
    return `Signed in successfully, but tool discovery failed: ${base}`;
  }
  return base;
}

/**
 * A shared vault a sign-in is saved into instead of My vault: the vault a
 * conversation that lists vaults reads its logins from. Its organization is
 * the sign-in's (the server keeps a sign-in only in a vault of the request's
 * organization).
 */
export interface SignInVault {
  /** The vault's id (`metadata.id`), sent as `vault_id`. */
  readonly id: string;
  /** The vault's organization id (`metadata.org`). */
  readonly org: string;
  /** The vault's display name, for the messages. */
  readonly name: string;
}

/** Options for {@link UseMcpServerOAuthConnectReturn.startOAuth}. */
export interface StartOAuthOptions {
  /**
   * The shared vault to save the sign-in into; omitted, My vault. The
   * signer must be allowed to edit it. A sign-in saved there serves the
   * runs that use that vault, never the connect lane (which reads only My
   * vault), so no tool discovery is chained after it.
   */
  readonly vault?: SignInVault;
}

/**
 * What a refused sign-in into a shared vault tells the person: a
 * conversation that lists vaults reads its logins only from them, so the
 * login must be saved in one, and only someone who may edit it can.
 */
export function signInVaultRefusalMessage(vault: SignInVault): string {
  return (
    `This conversation uses only its vaults, so the sign-in must be saved in vault '${vault.name}', which you may not edit. ` +
    "Ask an admin of that vault to sign in there, or to let you edit it."
  );
}

/** Return value of {@link useMcpServerOAuthConnect}. */
export interface UseMcpServerOAuthConnectReturn {
  /**
   * Start the OAuth connect flow for an MCP server.
   *
   * Opens a popup for the OAuth consent screen, waits for the callback,
   * exchanges the authorization code for tokens, then chains to the
   * `connect` RPC for tool discovery. A sign-in saved into a shared vault
   * (`options.vault`) chains no discovery: the connect lane reads only My
   * vault.
   *
   * **Must be called from a synchronous user-gesture handler** (e.g.,
   * an `onClick` callback) so the browser allows the popup. The popup
   * is opened synchronously before any async work to avoid popup
   * blockers.
   *
   * @param mcpServerId - System-generated ID (metadata.id) of the MCP server.
   * @param org - Organization context for token storage (caller's active org).
   *   With `options.vault`, the vault's organization is used instead.
   * @param options - Where the sign-in is saved; omitted, My vault.
   * @returns The updated McpServer after tool discovery completes (or, for
   *   a sign-in saved into a shared vault, the server as it stands).
   */
  readonly startOAuth: (mcpServerId: string, org: string, options?: StartOAuthOptions) => Promise<McpServer>;
  /** `true` while any phase of the OAuth flow is in progress. */
  readonly isInProgress: boolean;
  /** Current phase of the OAuth flow. */
  readonly phase: OAuthConnectPhase;
  /** Error from the most recent unsuccessful attempt, or `null`. */
  readonly error: Error | null;
  /**
   * The phase the flow was in when {@link error} was thrown, or `null`
   * when there is no error.
   *
   * The load-bearing value is `"connecting"`: it means OAuth sign-in
   * completed (the grant is stored server-side) and only the chained
   * tool-discovery `connect` failed. Consumers should branch on it to
   * (a) render honest copy via {@link getOAuthConnectErrorMessage} and
   * (b) retry with a bare `connect` instead of relaunching the popup.
   */
  readonly failedPhase: OAuthConnectPhase | null;
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
  const [failedPhase, setFailedPhase] = useState<OAuthConnectPhase | null>(null);

  const popupRef = useRef<Window | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  // Mirrors the phase state for the catch block: React state reads would be
  // stale inside the async flow, and failedPhase must record exactly where
  // the chain broke (completeOAuthConnect vs the chained connect).
  const phaseRef = useRef<OAuthConnectPhase>("idle");

  const advancePhase = useCallback((next: OAuthConnectPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

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
    advancePhase("idle");
    setError(null);
    setFailedPhase(null);
  }, [advancePhase]);

  const startOAuth = useCallback(
    async (mcpServerId: string, org: string, options?: StartOAuthOptions): Promise<McpServer> => {
      const vault = options?.vault;
      advancePhase("initiating");
      setError(null);
      setFailedPhase(null);
      cancelledRef.current = false;

      cleanupRef.current?.();

      const popup = openOAuthPopup();
      if (!popup) {
        const blocked = popupBlockedError();
        setError(blocked);
        setFailedPhase("initiating");
        advancePhase("idle");
        throw blocked;
      }

      popupRef.current = popup;

      try {
        const initOutput = await stigmer.mcpServer.initiateOAuthConnect(
          create(InitiateOAuthConnectInputSchema, {
            mcpServerId,
            org: vault?.org ?? org,
            vaultId: vault?.id ?? "",
          }),
        );

        popup.location.href = initOutput.authorizationUrl;
        advancePhase("awaiting-callback");

        const { code, state } = await waitForOAuthCallback(
          popup,
          initOutput.state,
          (dispose) => {
            cleanupRef.current = dispose;
          },
        );

        advancePhase("completing");

        await stigmer.mcpServer.completeOAuthConnect(
          create(CompleteOAuthConnectInputSchema, {
            mcpServerId,
            authorizationCode: code,
            state,
          }),
        );

        if (vault !== undefined) {
          // The connect lane reads only My vault, so discovery could not
          // use this sign-in: it serves the runs that use the vault.
          const server = await stigmer.mcpServer.get(mcpServerId);
          advancePhase("done");
          return server;
        }

        advancePhase("connecting");

        // No runtime env: the backend fills the login from the sign-in
        // this flow just saved in the caller's My vault, and every other
        // declared variable from that same My vault, the only vault a
        // connect reads.
        const input = create(ConnectInputSchema, { mcpServerId, org });

        // Async connect lane (stigmer/stigmer#425): startConnect + poll via
        // the SDK's shared protocol, so the discovery wait can outlive the
        // browser's ~300s no-bytes unary limit that used to fail this phase
        // spuriously. Old backends without the lane fall back to the
        // blocking RPC inside connectAndWait.
        const server = await connectAndWait(stigmer.mcpServer, input);

        advancePhase("done");
        return server;
      } catch (err) {
        const wrapped =
          vault !== undefined && isPermissionDenied(err)
            ? new StigmerError("permission-denied", signInVaultRefusalMessage(vault), Code.PermissionDenied, { cause: err })
            : toError(err);
        if (!cancelledRef.current) {
          setError(wrapped);
          setFailedPhase(phaseRef.current);
          advancePhase("idle");
          closeOAuthPopup(popup);
        }
        cancelledRef.current = false;
        throw wrapped;
      } finally {
        popupRef.current = null;
        cleanupRef.current = null;
      }
    },
    [stigmer, advancePhase],
  );

  return {
    startOAuth,
    isInProgress: phase !== "idle" && phase !== "done",
    phase,
    error,
    failedPhase,
    clearError,
  };
}
