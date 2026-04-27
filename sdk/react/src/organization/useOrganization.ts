"use client";

import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useOrganization}. */
export interface UseOrganizationReturn {
  /** The fetched Organization, or `null` while loading or on error. */
  readonly organization: Organization | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the organization from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Organization by ID.
 *
 * Pass `null` to skip fetching (stable no-op). When the `id` changes,
 * the previous in-flight request is discarded and a fresh fetch begins.
 * Call `refetch()` to re-query after mutating the organization through
 * a separate hook or API call.
 *
 * Returns the full proto {@link Organization} resource so consumers
 * have access to metadata (name, slug), spec (description, logo),
 * and status without additional calls.
 *
 * @example
 * ```tsx
 * const { organization, isLoading, error } = useOrganization("org-id-123");
 * ```
 */
export function useOrganization(
  id: string | null,
): UseOrganizationReturn {
  const stigmer = useStigmer();

  const { data: organization, isLoading, isRefetching, error, refetch } = useFetch(
    id ? () => stigmer.organization.get(id) : null,
    [id, stigmer],
    null as Organization | null,
  );

  return { organization, isLoading, isRefetching, error, refetch };
}
