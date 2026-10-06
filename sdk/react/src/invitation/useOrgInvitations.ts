"use client";

import { create } from "@bufbuild/protobuf";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { ListInvitationsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Options for {@link useOrgInvitations}. */
export interface UseOrgInvitationsOptions {
  /** Invitations per page, the first and each `loadMore`; the server caps it at 100. @default 25 */
  readonly pageSize?: number;
}

/** Return value of {@link useOrgInvitations}. */
export interface UseOrgInvitationsReturn {
  /** The organization's invitations, newest first: the first page, then every page loaded since. Empty while loading or on error. */
  readonly invitations: readonly Invitation[];
  /** `true` while more invitations exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` page is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** `true` only during the first load. */
  readonly isLoading: boolean;
  /** `true` while the first page refreshes in the background and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed first-page read, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-read the first page (after a create or a revoke); loaded older pages stay. */
  readonly refetch: () => void;
}

/**
 * Data hook that pages an organization's {@link Invitation} entries
 * through `InvitationQueryController.listByOrg`, newest first.
 *
 * Pass `null` to skip fetching (stable no-op). When the `org` changes,
 * the list starts again from its first page. Call `refetch()` after a
 * create or a revoke: it re-reads the first page and keeps the older
 * pages already loaded.
 *
 * The server lists an organization's invitations only to callers who hold
 * `can_grant_access` on it (its admins); gate the hook on that permission
 * and pass `null` otherwise.
 *
 * @param org - Organization id (a slug is also accepted), or `null` to skip fetching.
 *
 * @example
 * ```tsx
 * const { invitations, hasMore, loadMore } = useOrgInvitations("acme");
 * ```
 */
export function useOrgInvitations(
  org: string | null,
  options: UseOrgInvitationsOptions = {},
): UseOrgInvitationsReturn {
  const stigmer = useStigmer();
  const pageSize = options.pageSize ?? 25;
  const pages = useCursorPages<Invitation>(
    org
      ? (pageToken) =>
          stigmer.invitation.listByOrg(
            create(ListInvitationsByOrgInputSchema, { org, pageSize, pageToken }),
          )
      : null,
    [org, pageSize, stigmer],
    (invitation) => invitation.metadata?.id ?? "",
  );
  return {
    invitations: pages.items,
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
