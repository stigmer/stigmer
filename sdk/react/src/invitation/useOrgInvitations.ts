"use client";

import { create } from "@bufbuild/protobuf";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { ListInvitationsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useOrgInvitations}. */
export interface UseOrgInvitationsReturn {
  /** All invitations for the organization. Empty while loading or on error. */
  readonly invitations: readonly Invitation[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the invitation list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all {@link Invitation} entries for an
 * organization.
 *
 * Pass `null` to skip fetching (stable no-op). When the `org` slug
 * changes, the previous in-flight request is discarded and a fresh
 * fetch begins. Call `refetch()` to re-query after mutations
 * (create / revoke).
 *
 * Requires `can_view_access` permission on the organization —
 * only admins and owners can list invitation links.
 *
 * @param org - Organization slug, or `null` to skip fetching.
 *
 * @example
 * ```tsx
 * const { invitations, isLoading, error, refetch } = useOrgInvitations("acme");
 *
 * if (isLoading) return <Spinner />;
 * invitations.map((inv) => inv.spec?.label);
 * ```
 */
export function useOrgInvitations(
  org: string | null,
): UseOrgInvitationsReturn {
  const stigmer = useStigmer();

  const { data: invitations, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          stigmer.invitation
            .listByOrg(create(ListInvitationsByOrgInputSchema, { org }))
            .then((r) => [...r.entries])
      : null,
    [org, stigmer],
    [] as Invitation[],
  );

  return { invitations, isLoading, isRefetching, error, refetch };
}
