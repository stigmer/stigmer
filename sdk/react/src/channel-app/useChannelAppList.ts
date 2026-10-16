"use client";

import { create } from "@bufbuild/protobuf";
import { ListChannelAppsInputSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/io_pb";
import type { ChannelApp } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useChannelAppList}. */
export interface UseChannelAppListReturn {
  /** Channel apps owned by the organization. Empty while loading or on error. */
  readonly channelApps: readonly ChannelApp[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all {@link ChannelApp} entries for an
 * organization.
 *
 * These are the customer-owned messaging-platform apps (bring-your-own
 * Slack apps) that agent channels can install through instead of the
 * shared Stigmer app. Secret fields arrive redacted. The connect dialogs
 * pick from them, so the hook walks every page of the list and answers
 * the whole set (an organization holds a handful).
 *
 * Pass `null` for `org` to skip fetching (stable no-op). Useful when
 * the active organization has not been resolved yet.
 *
 * @example
 * ```tsx
 * const { channelApps, isLoading, error } = useChannelAppList(org);
 *
 * if (isLoading) return <Spinner />;
 * channelApps.map((app) => app.metadata?.name);
 * ```
 */
export function useChannelAppList(
  org: string | null,
): UseChannelAppListReturn {
  const stigmer = useStigmer();

  const { data: channelApps, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          readEveryPage((pageToken) =>
            stigmer.channelapp.list(
              create(ListChannelAppsInputSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          )
      : null,
    [org, stigmer],
    [] as ChannelApp[],
  );

  return { channelApps, isLoading, isRefetching, error, refetch };
}
