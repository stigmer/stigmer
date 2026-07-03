"use client";

import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

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
}

/**
 * Data hook that fetches all {@link ApiKey} entries for the
 * authenticated identity.
 *
 * API keys are identity-scoped — the server returns every key owned
 * by the identity in the auth header, regardless of organization.
 * Call `refetch()` to re-query after mutations (create / delete).
 *
 * The raw key value is never returned by `findAll` — only the
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

  const { data: apiKeys, isLoading, isRefetching, error, refetch } = useFetch(
    () => stigmer.apiKey.findAll().then((r) => [...r.entries]),
    [stigmer],
    [] as ApiKey[],
  );

  return { apiKeys, isLoading, isRefetching, error, refetch };
}
