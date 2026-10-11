"use client";

/**
 * Who a share can be granted to in an organization: its people, the
 * accounts an integrator's product created for its own users ("Users from
 * your product", the Members page's name for them), its service accounts
 * and, where the edition serves teams and the caller asks for them, its
 * teams.
 *
 * People are the organization's own access list, the member list the
 * caller can already see, so choosing someone introduces no new account
 * enumeration. That list holds only the organization's roles (owner,
 * admin, member, viewer); the cloud's share-link guests are never on it,
 * so every person offered here is an organization viewer and a valid team
 * member too. Accounts a platform client provisioned are split out of the
 * people (`isPlatformClientAccount`), so a picker labels them rather than
 * presenting them as the organization's people; a team's picker leaves
 * them out (`includeAppUsers: false`). Service accounts, the accounts the
 * organization's automation acts as, are split out the same way
 * (`isServiceAccount`): a resource can be shared with one, but a team is a
 * group of people and never takes one (`includeServiceAccounts: false`).
 * People who sign in through their organization's own identity provider are
 * people. Teams come from the
 * organization's team list, fetched only when asked for, so an edition
 * without teams never makes the call.
 */
import { useMemo } from "react";
import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import {
  granteeFromView,
  isPlatformClientAccount,
  isServiceAccount,
  personGrantee,
  teamGrantee,
  type Grantee,
} from "@stigmer/sdk";
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
  readonly org: string | null;
  /** Offer the organization's teams too. Pass `false` where teams cannot be granted. */
  readonly includeTeams: boolean;
  /**
   * Offer the accounts a platform client provisioned for an integrator's
   * own users, in `appUsers`. Defaults to `true`; pass `false` where only
   * the organization's people belong (a team's members).
   */
  readonly includeAppUsers?: boolean;
  /**
   * Offer the organization's service accounts, in `serviceAccounts`.
   * Defaults to `true`; pass `false` where only people belong (a team's
   * members).
   */
  readonly includeServiceAccounts?: boolean;
}

/** Return value of {@link useGranteeCandidates}. */
export interface UseGranteeCandidatesReturn {
  /** The organization's people, federated sign-ins included. */
  readonly people: readonly PersonCandidate[];
  /**
   * Accounts a platform client provisioned for an integrator's own users
   * ("Users from your product"); empty when `includeAppUsers` is `false`.
   */
  readonly appUsers: readonly PersonCandidate[];
  /**
   * The organization's service accounts; empty when `includeServiceAccounts`
   * is `false`.
   */
  readonly serviceAccounts: readonly PersonCandidate[];
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
 * const { people, appUsers, serviceAccounts, teams } = useGranteeCandidates({
 *   org,
 *   includeTeams: share.canShareWithTeams,
 * });
 * ```
 */
export function useGranteeCandidates({
  org: orgId,
  includeTeams,
  includeAppUsers = true,
  includeServiceAccounts = true,
}: UseGranteeCandidatesOptions): UseGranteeCandidatesReturn {
  const access = useResourceAccess(orgId ? { kind: "organization", id: orgId } : null);
  const teamList = useTeamList(includeTeams ? orgId : null);

  const { people, appUsers, serviceAccounts } = useMemo(() => {
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
    const all = [...byId.values()];
    return {
      people: all.filter(
        (person) => !isPlatformClientAccount(person.view) && !isServiceAccount(person.view),
      ),
      appUsers: includeAppUsers
        ? all.filter((person) => isPlatformClientAccount(person.view))
        : [],
      serviceAccounts: includeServiceAccounts
        ? all.filter((person) => isServiceAccount(person.view))
        : [],
    };
  }, [access.members, includeAppUsers, includeServiceAccounts]);

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
    () => ({ people, appUsers, serviceAccounts, teams, isLoading, error }),
    [people, appUsers, serviceAccounts, teams, isLoading, error],
  );
}
