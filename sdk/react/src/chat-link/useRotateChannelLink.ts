"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { RotateChannelLinkInputSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useRotateChannelLink}. */
export interface UseRotateChannelLinkReturn {
  /**
   * Rotate the web channel's link token via the `rotateLink` RPC.
   * Resolves with the updated channel, whose `status.typeStatus` web arm
   * carries the new `linkToken` for building the fresh chat URL.
   */
  readonly rotateLink: () => Promise<Channel | undefined>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that rotates a web channel's chat-link token.
 *
 * Wraps the `stigmer.channel.rotateLink()` RPC (authorized by the
 * channel's `can_edit`) with loading and error state management. The
 * server generates the token — there is nothing to supply — and the
 * previous link stops working the moment the call resolves, including
 * for visitors mid-conversation. The token lives in the web arm of
 * `status.typeStatus` (server-owned; this RPC is its sole writer), so it
 * is never part of a draft and survives every apply.
 *
 * The hook is stateless with respect to the channel — adopt the returned
 * channel (or refetch) so the UI shows the new tokened link, matching the
 * `useSaveChannel` convention.
 *
 * Pass `null` for `channelId` to produce a stable no-op (useful while the
 * channel is still loading, or before the agent has a chat link — there
 * is no token to rotate until a web channel exists).
 *
 * @example
 * ```tsx
 * const { rotateLink, isPending } = useRotateChannelLink(
 *   channel?.metadata?.id ?? null,
 * );
 *
 * const updated = await rotateLink();
 * // webLinkTokenOf(updated) is the new token
 * ```
 */
export function useRotateChannelLink(
  channelId: string | null,
): UseRotateChannelLinkReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const rotateLink = useCallback(async (): Promise<Channel | undefined> => {
    if (!channelId) return undefined;

    setIsPending(true);
    setError(null);

    try {
      return await stigmer.channel.rotateLink(
        create(RotateChannelLinkInputSchema, { resourceId: channelId }),
      );
    } catch (err) {
      setError(toError(err));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [channelId, stigmer]);

  return { rotateLink, isPending, error };
}
