"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { InitiateChannelInstallInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/**
 * Progress phases of a direct channel install.
 *
 * One live phase only — a direct install has no consent redirect and no
 * code exchange; the whole flow is the single `initiateInstall` call.
 */
export type InstallChannelPhase = "idle" | "installing" | "done";

/** Return value of {@link useInstallChannel}. */
export interface UseInstallChannelReturn {
  /**
   * Run the direct install flow for a channel.
   *
   * One `initiateInstall` call does everything: the server validates the
   * declared provider identity against the provider's API, persists the
   * install facts on status, and answers `completed=true` (DD-WA-1).
   * Works for first installs and retries of a pending channel alike.
   *
   * The server's `completed` field is the authoritative outcome
   * (DD-WA-1b): `false` means this channel's provider actually wants the
   * redirect flow — surfaced as an error rather than silently ignored,
   * because this hook cannot run a consent redirect.
   *
   * Failure modes surface as `error` with server-authored copy: bad or
   * expired app credentials, an unrecognized provider identity, a
   * dangling app reference, or a duplicate install (carrying a
   * `google.rpc.ErrorInfo` reason readable via `getErrorReason`).
   *
   * @param channelId - System-generated ID (metadata.id) of the channel.
   */
  readonly install: (channelId: string) => Promise<void>;
  /** `true` while the install call is in flight. */
  readonly isInProgress: boolean;
  /** Current phase of the install flow. */
  readonly phase: InstallChannelPhase;
  /** Error from the most recent unsuccessful attempt, or `null`. */
  readonly error: Error | null;
  /** Reset the hook to idle state. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that runs a direct (non-redirect) channel install —
 * WhatsApp today ({@link useConnectSlackChannel} is the redirect
 * counterpart). No popup, no callback route, no `completeInstall`.
 *
 * `initiateInstall` does not return the channel — callers refetch their
 * channel (list) afterwards to observe the `installed` state, exactly
 * like every other mutation-then-refetch flow in this package.
 *
 * @example
 * ```tsx
 * const installer = useInstallChannel();
 *
 * async function handleConnect() {
 *   await installer.install(channel.metadata.id);
 *   refetch();
 * }
 * ```
 */
export function useInstallChannel(): UseInstallChannelReturn {
  const stigmer = useStigmer();
  const [phase, setPhase] = useState<InstallChannelPhase>("idle");
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  const install = useCallback(
    async (channelId: string): Promise<void> => {
      setPhase("installing");
      setError(null);

      try {
        const output = await stigmer.agentChannel.initiateInstall(
          create(InitiateChannelInstallInputSchema, { resourceId: channelId }),
        );

        if (!output.completed) {
          // The server says this provider installs via consent redirect —
          // a wiring error (the caller routed a redirect-style provider
          // to the direct hook), not a user-fixable condition.
          throw new Error(
            "This channel's provider requires an interactive install — " +
              "connect it through its provider flow instead.",
          );
        }

        setPhase("done");
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        setPhase("idle");
        throw wrapped;
      }
    },
    [stigmer],
  );

  return {
    install,
    isInProgress: phase === "installing",
    phase,
    error,
    clearError,
  };
}
