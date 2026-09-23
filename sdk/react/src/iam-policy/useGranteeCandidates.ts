"use client";

/**
 * Who a share can be granted to in an organization: its people and, where
 * the edition serves teams and the caller asks for them, its teams.
 *
 * People are the organization's own access list, the member list the
 * caller can already see, so choosing someone introduces no new account
 * enumeration. That list holds only the organization's roles (owner,
 * admin, member, viewer); the cloud's share-link guests are never on it,
 * so every person offered here is an organization viewer and a valid team
 * member too. Teams come from the organization's team list, fetched only
 * when asked for, so an edition without teams never makes the call.
 */
import { useMemo } from "react";
import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { granteeFromView, personGrantee, teamGrantee, type Grantee } from "@stigmer/sdk";
import { useTeamList } from "../team/useTeamList.js";
import { useResourceAccess } from "./useResourceAccess.js";

/** A person the share can be granted to. */
export interface PersonCandidate {
  readonly kind: "identity_account";
  readonly grantee: Grantee;
  /** Display name, falling back to email, then id. */
  readonly name: string;
  /** Email address, when known. */
  readonly email: string;
  /** The full view, for the provider badge and avatar. */
  readonly view: ApiResourceRefView;
}

/** A team the share can be granted to. */
export interface TeamCandidate {
  readonly kind: "team";
  readonly grantee: Grantee;
  /** The team's name. */
  readonly name: string;
  /** The team's description, possibly empty. */
  readonly description: string;
  /** The full resource. */
  readonly team: Team;
}

/** A person or a team the share can be granted to, discriminated by `kind`. */
export type GranteeCandidate = PersonCandidate | TeamCandidate;

/** Options for {@link useGranteeCandidates}. */
export interface UseGranteeCandidatesOptions {
  /** The organization whose people (and teams) are offered, or `null` to skip. */
  readonly orgId: string | null;
  /** Offer the organization's teams too. Pass `false` where teams cannot be granted. */
  readonly includeTeams: boolean;
}

/** Return value of {@link useGranteeCandidates}. */
export interface UseGranteeCandidatesReturn {
  readonly people: readonly PersonCandidate[];
  readonly teams: readonly TeamCandidate[];
  /** `true` while either list is loading for the first time. */
  readonly isLoading: boolean;
  /** The first error either list reported, or `null`. */
  readonly error: Error | null;
}

/**
 * Data hook for the share picker's candidates.
 *
 * @example
 * ```tsx
 * const { people, teams } = useGranteeCandidates({
 *   orgId,
 *   includeTeams: share.canShareWithTeams,
 * });
 * ```
 */
export function useGranteeCandidates({
  orgId,
  includeTeams,
}: UseGranteeCandidatesOptions): UseGranteeCandidatesReturn {
  const access = useResourceAccess(orgId ? { kind: "organization", id: orgId } : null);
  const teamList = useTeamList(includeTeams ? orgId : null);

  const people = useMemo(() => {
    const byId = new Map<string, PersonCandidate>();
    for (const entry of access.members) {
      const view = entry.principal;
      const grantee = view ? granteeFromView(view) : undefined;
      if (!view || grantee?.kind !== "identity_account" || byId.has(grantee.id)) continue;
      byId.set(grantee.id, {
        kind: "identity_account",
        grantee: personGrantee(grantee.id),
        name: view.name || view.email || view.id,
        email: view.email,
        view,
      });
    }
    return [...byId.values()];
  }, [access.members]);

  const teams = useMemo(
    () =>
      includeTeams
        ? teamList.teams.flatMap((team): TeamCandidate[] => {
            const id = team.metadata?.id;
            if (!id) return [];
            return [
              {
                kind: "team",
                grantee: teamGrantee(id),
                name: team.metadata?.name || id,
                description: team.spec?.description ?? "",
                team,
              },
            ];
          })
        : [],
    [includeTeams, teamList.teams],
  );

  const isLoading = access.isLoading || (includeTeams && teamList.isLoading);
  const error = access.error ?? (includeTeams ? teamList.error : null);

  return useMemo(
    () => ({ people, teams, isLoading, error }),
    [people, teams, isLoading, error],
  );
}
