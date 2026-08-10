"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { GetConversationMediaDownloadUrlInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useConversationMediaUrl}. */
export interface UseConversationMediaUrlReturn {
  /**
   * A freshly minted presigned download URL for the timeline item's media,
   * or `null` when:
   * - Fetching is skipped (`enabled` is `false`, or any address part is empty)
   * - The request is in-flight
   * - The request failed (including the server's uniform NOT_FOUND for
   *   items without ingested media)
   */
  readonly url: string | null;

  /** `true` while the URL request is in-flight (first load). */
  readonly isLoading: boolean;

  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;

  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;

  /** Re-fetch the URL (e.g. to mint a fresh one after the previous expired). */
  readonly refetch: () => void;
}

interface UrlData {
  readonly url: string | null;
}

const EMPTY: UrlData = { url: null };

/** Options for {@link useConversationMediaUrl}. */
export interface UseConversationMediaUrlOptions {
  /**
   * Gate the request. When `false`, the hook stays idle and returns `null` —
   * use this to defer minting a URL until it is actually needed.
   * Defaults to `true`.
   */
  readonly enabled?: boolean;
}

/**
 * Data hook that resolves a **fresh** presigned download URL for one
 * timeline item's ingested media (an image or document the customer sent)
 * via `stigmer.agentChannel.getMediaDownloadUrl()`.
 *
 * Addressed by `(channel, conversation, item_id)` — never a storage key:
 * the server resolves the blob from its own row, so the read path stays
 * conversation-viewer-scoped by construction and blob capabilities never
 * ride the wire (whatsapp-media DD-001 D4). The URL expires (about an
 * hour); minting at view time keeps it always valid, the
 * `useArtifactDownloadUrl` rationale.
 *
 * The URL is cached cross-mount by the item's full address (DD-014), so
 * the 5s timeline poll's re-renders and a lightbox opened from a
 * thumbnail reuse the minted URL instead of re-hitting the API.
 *
 * Pass empty strings (or `enabled: false`) to skip fetching — the
 * conversation surface's established skip convention.
 *
 * @param agentChannelId - AgentChannel the conversation belongs to, or `""` to skip.
 * @param conversationKey - Conversation key within the channel, or `""` to skip.
 * @param itemId - The timeline item whose media to fetch (e.g. `"wa:<wamid>"`), or `""` to skip.
 * @param options - Optional gating (`enabled`).
 *
 * @example
 * ```tsx
 * // Render an inbound photo with an always-fresh URL.
 * const { url, isLoading } = useConversationMediaUrl(channelId, key, item.itemId);
 * if (isLoading) return <Skeleton />;
 * return url ? <img src={url} alt={item.media?.filename} /> : null;
 * ```
 *
 * @see useArtifactDownloadUrl — the execution-artifact counterpart this mirrors
 */
export function useConversationMediaUrl(
  agentChannelId: string,
  conversationKey: string,
  itemId: string,
  options?: UseConversationMediaUrlOptions,
): UseConversationMediaUrlReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;
  const active =
    enabled && agentChannelId !== "" && conversationKey !== "" && itemId !== "";

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    active
      ? () =>
          stigmer.agentChannel
            .getMediaDownloadUrl(
              create(GetConversationMediaDownloadUrlInputSchema, {
                agentChannelId,
                conversationKey,
                itemId,
              }),
            )
            .then((result): UrlData => ({ url: result.url || null }))
      : null,
    [agentChannelId, conversationKey, itemId, active, stigmer],
    EMPTY,
    {
      cacheKey: active
        ? `conversation-media-url:${agentChannelId}:${conversationKey}:${itemId}`
        : undefined,
    },
  );

  return useMemo(
    () => ({ url: data.url, isLoading, isRefetching, error, refetch }),
    [data.url, isLoading, isRefetching, error, refetch],
  );
}
