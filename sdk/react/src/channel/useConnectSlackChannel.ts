"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  InitiateChannelInstallInputSchema,
  CompleteChannelInstallInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import {
  openOAuthPopup,
  popupBlockedError,
  waitForOAuthCallback,
  closeOAuthPopup,
} from "../internal/oauthPopup.js";

/**
 * Progress phases of the Slack channel install flow.
 *
 * Mirrors the MCP OAuth phases minus `connecting` — a channel install has
 * no tool-discovery step; `completeInstall` returns the installed channel
 * directly.
 */
export type SlackConnectPhase =
  | "idle"
  | "initiating"
  | "awaiting-callback"
  | "completing"
  | "done";

/** Return value of {@link useConnectSlackChannel}. */
export interface UseConnectSlackChannelReturn {
  /**
   * Run the Slack install flow for a channel.
   *
   * Opens a popup for Slack's "Add to Slack" consent screen, waits for
   * the OAuth callback, then exchanges the authorization code via
   * `completeInstall`. Works for first installs and re-installs after
   * revocation alike (the server transitions `revoked → installed`).
   *
   * **Must be called from a synchronous user-gesture handler** (e.g. an
   * `onClick` callback) so the browser allows the popup. The popup is
   * opened synchronously before any async work to avoid popup blockers.
   *
   * Failure modes surface as `error` with server-authored copy:
   * a deployment without Slack app credentials or an OSS backend refuses
   * at `initiating` (FAILED_PRECONDITION); duplicate-workspace and
   * Enterprise Grid installs refuse at `completing`.
   *
   * @param channelId - System-generated ID (metadata.id) of the channel.
   * @returns The installed AgentChannel (status carries the Slack facts).
   */
  readonly connect: (channelId: string) => Promise<AgentChannel>;
  /** `true` while any phase of the install flow is in progress. */
  readonly isInProgress: boolean;
  /** Current phase of the install flow. */
  readonly phase: SlackConnectPhase;
  /** Error from the most recent unsuccessful attempt, or `null`. */
  readonly error: Error | null;
  /** Reset the hook to idle state, cancelling any in-flight flow. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that orchestrates the Slack channel install flow.
 *
 * Handles the complete lifecycle:
 * 1. Calls `initiateInstall` to get Slack's authorization URL + state
 * 2. Opens a popup window to the "Add to Slack" consent screen
 * 3. Waits for the callback (`postMessage` + BroadcastChannel, via the
 *    shared `internal/oauthPopup.ts` machinery)
 * 4. Calls `completeInstall` to exchange the code — the server stores the
 *    bot token and records the install facts on `status.slack`
 *
 * The callback page is the same `OAuthCallbackHandler` component used by
 * MCP OAuth, hosted on the console's Slack redirect route.
 *
 * @example
 * ```tsx
 * const slack = useConnectSlackChannel();
 *
 * async function handleConnect() {
 *   try {
 *     const installed = await slack.connect(channel.metadata.id);
 *     refetch();
 *   } catch {
 *     // error is available via slack.error
 *   }
 * }
 *
 * <button onClick={handleConnect} disabled={slack.isInProgress}>
 *   {slack.isInProgress ? "Connecting..." : "Connect to Slack"}
 * </button>
 * ```
 */
export function useConnectSlackChannel(): UseConnectSlackChannelReturn {
  const stigmer = useStigmer();
  const [phase, setPhase] = useState<SlackConnectPhase>("idle");
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

  const connect = useCallback(
    async (channelId: string): Promise<AgentChannel> => {
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
        const initOutput = await stigmer.agentChannel.initiateInstall(
          create(InitiateChannelInstallInputSchema, { resourceId: channelId }),
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

        const channel = await stigmer.agentChannel.completeInstall(
          create(CompleteChannelInstallInputSchema, {
            resourceId: channelId,
            state,
            code,
          }),
        );

        setPhase("done");
        return channel;
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
    connect,
    isInProgress: phase !== "idle" && phase !== "done",
    phase,
    error,
    clearError,
  };
}
