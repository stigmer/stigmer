"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  InitiateOAuthConnectInputSchema,
  CompleteOAuthConnectInputSchema,
  ConnectInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks";
import { resolveDeclaredSystemEnvVars } from "../environment/systemEnvVars";
import { toError } from "../internal/toError";

/**
 * Message type posted by {@link OAuthCallbackHandler} to the opener window.
 *
 * @internal
 */
export const OAUTH_CALLBACK_MESSAGE_TYPE = "stigmer:oauth:callback";

/**
 * Shape of the `postMessage` payload sent from the OAuth callback popup.
 *
 * @internal
 */
export interface OAuthCallbackMessage {
  readonly type: typeof OAUTH_CALLBACK_MESSAGE_TYPE;
  readonly code: string;
  readonly state: string;
}

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

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;
const POPUP_CALLBACK_TIMEOUT_MS = 120_000;

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

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const clearError = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  const startOAuth = useCallback(
    async (mcpServerId: string, org: string, declaredEnvKeys?: readonly string[]): Promise<McpServer> => {
      setPhase("initiating");
      setError(null);

      cleanupRef.current?.();

      const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
      const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
      const popup = window.open(
        "about:blank",
        "stigmer_oauth",
        `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},popup=yes`,
      );

      if (!popup) {
        const blocked = new Error(
          "Your browser blocked the authentication popup. " +
            "Please allow popups for this site and try again.",
        );
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
        setError(wrapped);
        setPhase("idle");
        closePopup(popup);
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

// ---------------------------------------------------------------------------
// Popup callback listener
// ---------------------------------------------------------------------------

function waitForOAuthCallback(
  popup: Window,
  expectedState: string,
  onDispose: (dispose: () => void) => void,
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let pollId: ReturnType<typeof setInterval>;

    function cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      if (pollId) clearInterval(pollId);
      window.removeEventListener("message", onMessage);
    }

    function settle(
      outcome: { code: string; state: string } | Error,
    ) {
      if (settled) return;
      settled = true;
      cleanup();
      if (outcome instanceof Error) {
        reject(outcome);
      } else {
        resolve(outcome);
      }
    }

    onDispose(() => {
      settle(new Error("OAuth flow was cancelled."));
      closePopup(popup);
    });

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;

      const data = event.data as OAuthCallbackMessage | undefined;
      if (data?.type !== OAUTH_CALLBACK_MESSAGE_TYPE) return;

      if (data.state !== expectedState) {
        settle(
          new Error(
            "OAuth state mismatch — the callback did not match the " +
              "initiated flow. Please try again.",
          ),
        );
        return;
      }

      if (!data.code) {
        settle(new Error("No authorization code received from the OAuth provider."));
        return;
      }

      settle({ code: data.code, state: data.state });
    }

    window.addEventListener("message", onMessage);

    timeoutId = setTimeout(() => {
      settle(
        new Error(
          "OAuth authentication timed out. Ensure your callback page " +
            "renders <OAuthCallbackHandler /> from @stigmer/react at " +
            "the URL configured as your OAuth redirect URI.",
        ),
      );
      closePopup(popup);
    }, POPUP_CALLBACK_TIMEOUT_MS);

    pollId = setInterval(() => {
      if (popup.closed) {
        settle(new Error("The authentication window was closed before completing sign-in."));
      }
    }, 500);
  });
}

function closePopup(popup: Window | null) {
  try {
    popup?.close();
  } catch {
    // Cross-origin popup may throw on close — safe to ignore.
  }
}
