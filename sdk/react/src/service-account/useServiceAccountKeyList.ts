"use client";

/**
 * Data hook for the API keys that speak for one service account
 * (`apiKey.listByAccount`), one page at a time.
 *
 * A person's own keys come from `useApiKeyList` (`list`, the caller's own
 * keys); a service account's keys are listed by account, because the admin
 * reading them is not their owner. The server answers a caller who may view
 * the account: the organization's admins. As with every key read, no raw key
 * value comes back, only the fingerprint.
 */
import type { ApiKey } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { create } from "@bufbuild/protobuf";
import { ListApiKeysByAccountInputSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";
import { useCursorPages } from "@stigmer/react-core/internal";

/** Return value of {@link useServiceAccountKeyList}. */
export interface UseServiceAccountKeyListReturn {
  /** The keys that speak for the account. Empty while loading or on error. */
  readonly apiKeys: readonly ApiKey[];
  /** `true` while the first fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the keys, after a create or a revoke. */
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
 * Data hook that lists a service account's API keys.
 *
 * Pass `null` to skip fetching.
 *
 * @example
 * ```tsx
 * const { apiKeys, refetch } = useServiceAccountKeyList(account.metadata?.id ?? null);
 * ```
 */
export function useServiceAccountKeyList(
  serviceAccountId: string | null,
): UseServiceAccountKeyListReturn {
  const stigmer = useStigmer();

  const pages = useCursorPages<ApiKey>(
    serviceAccountId
      ? (pageToken) =>
          stigmer.apiKey.listByAccount(
            create(ListApiKeysByAccountInputSchema, { accountId: serviceAccountId, pageToken }),
          )
      : null,
    [serviceAccountId, stigmer],
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
