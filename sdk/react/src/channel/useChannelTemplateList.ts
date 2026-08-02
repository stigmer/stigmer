"use client";

import { useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { ChannelTemplate } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { ListChannelTemplatesInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useChannelTemplateList}. */
export interface UseChannelTemplateListOptions {
  /**
   * When `true`, only templates the provider will accept for sending
   * are returned (WhatsApp: status APPROVED). The console leaves it
   * unset to render every status with its badge; agent-composition
   * surfaces set it so a model never drafts against a paused or
   * pending template.
   */
  readonly approvedOnly?: boolean;
}

/** Return value of {@link useChannelTemplateList}. */
export interface UseChannelTemplateListReturn {
  /**
   * The channel provider's templates, verbatim, in provider order.
   * Empty while loading, on error, and when the registry answered with
   * no templates — `templates.length === 0 && !isLoading && !error`
   * means the provider reported none, which callers should phrase as
   * "none found" rather than "none exist" (an empty success is
   * indistinguishable from a filtered or truncated one).
   */
  readonly templates: readonly ChannelTemplate[];
  /** `true` while the initial fetch is in flight and no data is shown. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the templates from the server. */
  readonly refetch: () => void;
}

/**
 * How often to re-read the registry while any template is PENDING.
 * Matches the server's template-cache TTL (60s) — polling faster only
 * re-reads a cached answer.
 */
const PENDING_POLL_INTERVAL_MS = 60_000;

/**
 * Data hook that lists a channel's message templates as the channel's
 * provider registry reports them (`listTemplates`) — every field
 * provider-verbatim, including approval `status`, the provider's
 * `rejectionReason`, and Stigmer's own `unsupportedReason` (why this
 * platform version cannot send an otherwise-approved template).
 *
 * The channel is addressed by `slug` + `org` (not id), because that is
 * the RPC's key — the provider registry is derived from the channel's
 * phone number, not stored on any Stigmer resource. Pass an empty
 * `channelSlug` or `org` to skip fetching (stable no-op).
 *
 * While any entry is PENDING the hook polls every 60 seconds — the
 * server's registry-cache TTL, so a faster interval would only re-read
 * a cached answer. There is deliberately no `refetchInterval` option:
 * the pending-only conditional poll is the hook's policy, and
 * `approvedOnly` (a wire field) is the only knob exposed.
 *
 * Results are never cached across mounts: a template's approval status
 * can change on the provider's side at any time, and rendering a stale
 * "APPROVED" is exactly what this surface must not do.
 *
 * @example
 * ```tsx
 * const { templates, isLoading, error } = useChannelTemplateList(
 *   channel.metadata?.slug ?? "",
 *   channel.metadata?.org ?? "",
 * );
 * ```
 */
export function useChannelTemplateList(
  channelSlug: string,
  org: string,
  options?: UseChannelTemplateListOptions,
): UseChannelTemplateListReturn {
  const stigmer = useStigmer();
  const approvedOnly = options?.approvedOnly ?? false;

  // The pending-only poll rides useFetch's own guarded interval (the
  // ONE polling implementation) rather than a second setInterval here.
  // The interval cannot be derived inline — it depends on the data the
  // same useFetch call returns — so it round-trips through state: data
  // arrives, the effect below flips the interval, useFetch re-arms.
  const [pollInterval, setPollInterval] = useState<number | false>(false);

  const fetchFn =
    channelSlug && org
      ? async () => {
          const result = await stigmer.agentChannel.listTemplates(
            create(ListChannelTemplatesInputSchema, {
              channel: channelSlug,
              org,
              approvedOnly,
            }),
          );
          return result.entries;
        }
      : null;

  const { data: templates, isLoading, isRefetching, error, refetch } =
    useFetch(
      fetchFn,
      [channelSlug, org, approvedOnly, stigmer],
      [] as ChannelTemplate[],
      { refetchInterval: pollInterval },
    );

  const hasPending = templates.some((t) => t.status === "PENDING");
  useEffect(() => {
    setPollInterval(hasPending ? PENDING_POLL_INTERVAL_MS : false);
  }, [hasPending]);

  return { templates, isLoading, isRefetching, error, refetch };
}
