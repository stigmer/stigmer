"use client";

import { create } from "@bufbuild/protobuf";
import { ListOAuthAppsInputSchema } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/io_pb";
import type { OAuthApp } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Return value of {@link useOAuthAppList}. */
export interface UseOAuthAppListReturn {
  /** OAuth apps owned by the organization. Empty while loading or on error. */
  readonly oauthApps: readonly OAuthApp[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the list from the server. */
  readonly refetch: () => void;
  /** `true` while the server holds entries beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
}

/**
 * Data hook that fetches the {@link OAuthApp} entries of an organization
 * that the caller may view.
 *
 * Returns the organization's OAuthApps that a `get` would return to the
 * caller: the organization's admins see every app, anyone granted viewer on
 * an app sees that app, and other members and viewers see none. Each app
 * lists the addresses it signs in to; a sign-in at one of them uses it.
 *
 * Pass `null` for `org` to skip fetching (stable no-op). Useful when
 * the active organization has not been resolved yet.
 *
 * @example
 * ```tsx
 * const { oauthApps, isLoading, error } = useOAuthAppList(org);
 *
 * if (isLoading) return <Spinner />;
 * oauthApps.map((app) => app.spec?.provider);
 * ```
 */
export function useOAuthAppList(
  org: string | null,
): UseOAuthAppListReturn {
  const stigmer = useStigmer();

  const pages = useCursorPages<OAuthApp>(
    org
      ? (pageToken) =>
          stigmer.oauthapp.list(
            create(ListOAuthAppsInputSchema, { org, pageToken }),
          )
      : null,
    [org, stigmer],
    (row) => row.metadata?.id ?? "",
  );

  return {
    oauthApps: pages.items,
    hasMore: pages.hasMore,
    loadMore: pages.loadMore,
    isLoadingMore: pages.isLoadingMore,
    loadMoreError: pages.loadMoreError,
    isLoading: pages.isLoading,
    isRefetching: pages.isRefetching,
    error: pages.error,
    refetch: pages.refetch,
  };
}
