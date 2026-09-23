"use client";

/**
 * Create, update and delete for teams, each with its own in-flight and
 * error state so a form can show the one it is waiting on.
 *
 * Update takes a complete `TeamInput`: the RPC replaces the whole spec, so
 * callers spread `toTeamUpdateInput(team)` and override only what they
 * edit. Deleting a team removes every membership and every grant made to
 * the team with it (the server's delete cleanup); people keep what was
 * granted to them directly.
 */
import { useCallback, useMemo, useState } from "react";
import type { DeleteResourceInput, TeamInput } from "@stigmer/sdk";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** The state every team mutation hook returns beside its action. */
interface MutationState {
  /** Error from the last failed call, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/** Return value of {@link useCreateTeam}. */
export interface UseCreateTeamReturn extends MutationState {
  /** Create a team. Resolves with the server-created resource. */
  readonly create: (input: TeamInput) => Promise<Team>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
}

/** Return value of {@link useUpdateTeam}. */
export interface UseUpdateTeamReturn extends MutationState {
  /** Replace a team's name and description. */
  readonly update: (input: TeamInput) => Promise<Team>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
}

/** Return value of {@link useDeleteTeam}. */
export interface UseDeleteTeamReturn extends MutationState {
  /** Delete a team, its memberships and every grant made to it. */
  readonly deleteTeam: (input: DeleteResourceInput) => Promise<Team>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
}

/** One call with its own in-flight flag and error, the shape all three share. */
function useTracked<A, R>(call: (arg: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const run = useCallback(
    async (arg: A): Promise<R> => {
      setPending(true);
      setError(null);
      try {
        return await call(arg);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [call],
  );
  return { run, pending, error, clearError };
}

/**
 * Mutation hook that creates a team.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateTeam();
 * await create({ name: "Site Reliability", org: orgSlug, description: "On call" });
 * ```
 */
export function useCreateTeam(): UseCreateTeamReturn {
  const stigmer = useStigmer();
  const call = useCallback((input: TeamInput) => stigmer.team.create(input), [stigmer]);
  const { run, pending, error, clearError } = useTracked(call);
  return useMemo(
    () => ({ create: run, isCreating: pending, error, clearError }),
    [run, pending, error, clearError],
  );
}

/**
 * Mutation hook that updates a team. Spread `toTeamUpdateInput(team)` so
 * the fields you do not edit are kept.
 *
 * @example
 * ```tsx
 * const { update } = useUpdateTeam();
 * await update({ ...toTeamUpdateInput(team), description: next });
 * ```
 */
export function useUpdateTeam(): UseUpdateTeamReturn {
  const stigmer = useStigmer();
  const call = useCallback((input: TeamInput) => stigmer.team.update(input), [stigmer]);
  const { run, pending, error, clearError } = useTracked(call);
  return useMemo(
    () => ({ update: run, isUpdating: pending, error, clearError }),
    [run, pending, error, clearError],
  );
}

/**
 * Mutation hook that deletes a team.
 *
 * @example
 * ```tsx
 * const { deleteTeam } = useDeleteTeam();
 * await deleteTeam({ resourceId: team.metadata?.id ?? "" });
 * ```
 */
export function useDeleteTeam(): UseDeleteTeamReturn {
  const stigmer = useStigmer();
  const call = useCallback(
    (input: DeleteResourceInput) => stigmer.team.delete(input),
    [stigmer],
  );
  const { run, pending, error, clearError } = useTracked(call);
  return useMemo(
    () => ({ deleteTeam: run, isDeleting: pending, error, clearError }),
    [run, pending, error, clearError],
  );
}
