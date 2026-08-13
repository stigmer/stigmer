"use client";

import { create } from "@bufbuild/protobuf";
// AgentChannel is type-only here so the doc link below resolves (the sibling
// channel hooks import it for real use); the strict tsdoc gate guards it.
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ListSessionsByChannelRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useChannelSessions}. */
export interface UseChannelSessionsReturn {
  /**
   * The channel's conversations (one session per external conversation),
   * newest activity first. Empty while loading, on error, or when nobody
   * has messaged the channel yet — `sessions.length === 0 && !isLoading
   * && !error` means "no conversations yet".
   */
  readonly sessions: readonly Session[];
  /** `true` while the initial fetch is in flight and no data is shown. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /**
   * Error from the last failed request, or `null` when healthy. A
   * PERMISSION_DENIED here means the caller cannot view the channel —
   * conversations are visible to exactly the channel's viewers (the
   * connector and org admins).
   */
  readonly error: Error | null;
  /** Re-fetch the conversations from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that loads the conversations an {@link AgentChannel} created —
 * the Slack/WhatsApp sessions the channel runtime owns (design decision
 * 012: channel-session read-only observability).
 *
 * The server enforces the visibility boundary twice: the caller must hold
 * `can_view` on the channel, and results are filtered to sessions the
 * caller can individually view. Open a returned session with
 * `SessionViewer` — it self-selects the read-only `"observer"` audience
 * for channel-originated sessions.
 *
 * Pass an empty `channelId` to skip fetching (stable no-op) — useful
 * while the channel list is still loading.
 *
 * @example
 * ```tsx
 * const { sessions, isLoading, error } = useChannelSessions(
 *   channel.metadata?.id ?? "",
 * );
 * ```
 */
export function useChannelSessions(channelId: string): UseChannelSessionsReturn {
  const stigmer = useStigmer();

  const fetchFn = channelId
    ? async () => {
        const result = await stigmer.session.listByChannel(
          create(ListSessionsByChannelRequestSchema, { channelId }),
        );
        return result.entries;
      }
    : null;

  const { data: sessions, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [channelId, stigmer],
    [] as Session[],
  );

  return { sessions, isLoading, isRefetching, error, refetch };
}
