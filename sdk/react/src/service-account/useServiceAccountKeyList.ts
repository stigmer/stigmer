"use client";

/**
 * Data hook for the API keys that speak for one service account
 * (`apiKey.findByAccount`).
 *
 * A person's own keys come from `useApiKeyList` (`findAll`, the caller's own
 * keys); a service account's keys are listed by account, because the admin
 * reading them is not their owner. The server answers a caller who may view
 * the account: the organization's admins. As with every key read, no raw key
 * value comes back, only the fingerprint.
 */
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

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

  const { data: apiKeys, isLoading, isRefetching, error, refetch } = useFetch(
    serviceAccountId
      ? () => stigmer.apiKey.findByAccount(serviceAccountId).then((r) => [...r.entries])
      : null,
    [serviceAccountId, stigmer],
    [] as ApiKey[],
  );

  return { apiKeys, isLoading, isRefetching, error, refetch };
}
