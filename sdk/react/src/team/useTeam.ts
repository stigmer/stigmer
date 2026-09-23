"use client";

/**
 * One team by id, for the team detail panel. Its members are not on the
 * resource: they are the access list on the team (`useShareFlow` on
 * `{ kind: "team", id }`), so this hook carries the name and description
 * only.
 */
import { useMemo } from "react";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useTeam}. */
export interface UseTeamReturn {
  /** The fetched team, or `null` while loading or on error. */
  readonly team: Team | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single team by id.
 *
 * Pass `null` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { team, isLoading, error } = useTeam(teamId);
 * ```
 */
export function useTeam(id: string | null): UseTeamReturn {
  const stigmer = useStigmer();

  const { data: team, isLoading, isRefetching, error, refetch } = useFetch(
    id ? () => stigmer.team.get(id) : null,
    [id, stigmer],
    null as Team | null,
  );

  return useMemo(
    () => ({ team, isLoading, isRefetching, error, refetch }),
    [team, isLoading, isRefetching, error, refetch],
  );
}
