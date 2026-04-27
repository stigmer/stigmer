"use client";

import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link usePlatformClient}. */
export interface UsePlatformClientReturn {
  /** The fetched PlatformClient, or `null` while loading or on error. */
  readonly platformClient: PlatformClient | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single PlatformClient by ID.
 *
 * Pass `null` to skip fetching (stable no-op). When the `id` changes,
 * the previous in-flight request is discarded and a fresh fetch begins.
 *
 * Returns the full proto {@link PlatformClient} resource so consumers
 * have access to metadata, spec (client ID, expiry, JIT config), and
 * status without additional calls.
 *
 * @example
 * ```tsx
 * function PlatformClientDetail({ pcId }: { pcId: string }) {
 *   const { platformClient, isLoading, error } = usePlatformClient(pcId);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!platformClient) return <NotFound />;
 *
 *   return <h1>{platformClient.metadata?.name}</h1>;
 * }
 * ```
 */
export function usePlatformClient(
  id: string | null,
): UsePlatformClientReturn {
  const stigmer = useStigmer();

  const { data: platformClient, isLoading, isRefetching, error, refetch } = useFetch(
    id ? () => stigmer.platformclient.get(id) : null,
    [id, stigmer],
    null as PlatformClient | null,
  );

  return { platformClient, isLoading, isRefetching, error, refetch };
}
