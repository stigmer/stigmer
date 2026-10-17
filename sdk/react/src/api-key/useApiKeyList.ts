"use client";

import type { ApiKey } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { create } from "@bufbuild/protobuf";
import { ListApiKeysInputSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Return value of {@link useApiKeyList}. */
export interface UseApiKeyListReturn {
  /** All API keys for the authenticated identity. Empty while loading or on error. */
  readonly apiKeys: readonly ApiKey[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the key list from the server. */
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
 * Data hook that fetches all {@link ApiKey} entries for the
 * authenticated identity.
 *
 * API keys are identity-scoped — the server returns the keys owned by
 * the identity in the auth header, regardless of organization, one page
 * at a time (`hasMore` / `loadMore`).
 * Call `refetch()` to re-query after mutations (create / delete).
 *
 * The raw key value is never returned by `list` — only the
 * `fingerprint` (last 6 characters) is available for display.
 *
 * @example
 * ```tsx
 * const { apiKeys, isLoading, error, refetch } = useApiKeyList();
 *
 * if (isLoading) return <Spinner />;
 * apiKeys.map((k) => k.metadata?.name);
 * ```
 */
export function useApiKeyList(): UseApiKeyListReturn {
  const stigmer = useStigmer();

  const pages = useCursorPages<ApiKey>(
    (pageToken) => stigmer.apiKey.list(create(ListApiKeysInputSchema, { pageToken })),
    [stigmer],
    (key) => key.metadata?.id ?? "",
  );

  return {
    apiKeys: pages.items,
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
