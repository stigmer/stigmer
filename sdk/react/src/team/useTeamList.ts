"use client";

/**
 * The organization's teams, for the Teams settings page and the share
 * picker. A team list is small (an organization names its teams by hand),
 * so it is one flat call with no pagination. Teams are an Enterprise and
 * Cloud kind; callers gate on `useResourceAvailable(ApiResourceKind.team)`
 * and pass `null` where it is not served, which makes this a no-op rather
 * than a call the server answers UNIMPLEMENTED.
 */
import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { ListTeamsByOrgInputSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useTeamList}. */
export interface UseTeamListReturn {
  /** Every team in the organization. Empty while loading or on error. */
  readonly teams: readonly Team[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

const NO_TEAMS: Team[] = [];

/**
 * Data hook that lists an organization's teams.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` after a
 * create, update or delete.
 *
 * @example
 * ```tsx
 * const teamsServed = useResourceAvailable(ApiResourceKind.team);
 * const { teams, isLoading } = useTeamList(teamsServed ? orgSlug : null);
 * ```
 */
export function useTeamList(org: string | null): UseTeamListReturn {
  const stigmer = useStigmer();

  const { data: teams, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          stigmer.team
            .listByOrg(create(ListTeamsByOrgInputSchema, { org }))
            .then((r) => [...r.entries])
      : null,
    [org, stigmer],
    NO_TEAMS,
  );

  return useMemo(
    () => ({ teams, isLoading, isRefetching, error, refetch }),
    [teams, isLoading, isRefetching, error, refetch],
  );
}
