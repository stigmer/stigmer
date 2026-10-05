"use client";

import { create } from "@bufbuild/protobuf";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ListChildOrgsInputSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Options for {@link useChildOrganizations}. */
export interface UseChildOrganizationsOptions {
  /** Children per page, the first and each `loadMore`; the server caps it at 100. @default 25 */
  readonly pageSize?: number;
}

/** Return value of {@link useChildOrganizations}. */
export interface UseChildOrganizationsReturn {
  /** The organization's children, newest first: the first page, then every page loaded since. */
  readonly children: readonly Organization[];
  /** `true` while more children exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` page is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** `true` only during the first load. */
  readonly isLoading: boolean;
  /** Error from the last failed first-page read, or `null`. */
  readonly error: Error | null;
  /** Re-read the first page. */
  readonly refetch: () => void;
}

/**
 * Data hook that pages an organization's child organizations through
 * `OrganizationQueryController.listChildOrgs`, newest first.
 *
 * The server answers only a caller who may manage the organization's
 * children (`can_manage_child_orgs`, its admins); gate the hook on that
 * permission and pass `null` otherwise, which keeps it idle.
 *
 * @example
 * ```tsx
 * const { children, hasMore, loadMore } = useChildOrganizations(orgId);
 * ```
 */
export function useChildOrganizations(
  org: string | null,
  options: UseChildOrganizationsOptions = {},
): UseChildOrganizationsReturn {
  const stigmer = useStigmer();
  const pageSize = options.pageSize ?? 25;
  const pages = useCursorPages<Organization>(
    org
      ? (pageToken) =>
          stigmer.organization.listChildOrgs(
            create(ListChildOrgsInputSchema, { org, pageSize, pageToken }),
          )
      : null,
    [org, pageSize, stigmer],
    (child) => child.metadata?.id ?? "",
  );
  return {
    children: pages.items,
    hasMore: pages.hasMore,
    loadMore: pages.loadMore,
    isLoadingMore: pages.isLoadingMore,
    loadMoreError: pages.loadMoreError,
    isLoading: pages.isLoading,
    error: pages.error,
    refetch: pages.refetch,
  };
}
