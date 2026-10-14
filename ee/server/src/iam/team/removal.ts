/**
 * The one place a team is removed: the delete RPC and the organization
 * delete both come here, so "a team dies" has one order.
 *
 * Grants first, the row last, and a failure stops before the row. That is
 * the reverse of the generic delete chains, whose cleanup runs after the
 * row and is best-effort because a resource's grants are inert once the
 * resource is gone. A team is the one principal whose rows grant access to
 * other people who can still sign in: its organization link, its
 * memberships and every share made with it live as tuples, not in its row,
 * so a deleted row with a failed cleanup would leave a team that no longer
 * exists still granting. Here a failed cleanup leaves the team in place
 * and the retry resumes, because the grant path revokes row by row, each
 * tuple before its row, and stops at the first failure.
 *
 * The cleanup is the grant path's `cleanupResourceGrants`, which finds
 * the team's rows in both directions: the memberships and the organization
 * link as resource, every `team:<id>#member` share as principal.
 *
 * After the row, the team's slug is let go in the server's name table, so
 * a later team may take it; best-effort, as the next claim frees a name
 * whose team is gone.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import type { Logger, NameTable } from "@stigmer/server";

import type { GrantPathClient } from "../grant/grant-path-client.js";
import type { TeamStore } from "./store.js";

/** The team's kind as an `ApiResourceRef.kind` spells it. */
export const TEAM_KIND_NAME = ApiResourceKind[ApiResourceKind.team];

export interface TeamRemoval {
  /**
   * The team's grants, then its row; throws with the row intact when the
   * grants cannot all be revoked. `actingFor`: the person deleting it.
   */
  remove(id: string, actingFor: string): Promise<void>;
  /**
   * Every team of an organization being deleted, each on its own: one
   * team's failure is logged and the rest are still removed, then the call
   * throws, so the organization delete fails with the organization in place
   * and its retry removes what is left (iam/organization-delete.ts).
   * `actingFor`: the person deleting the organization.
   */
  removeByOrgId(orgId: string, actingFor: string): Promise<void>;
}

export interface TeamRemovalDeps {
  readonly teams: Pick<TeamStore, "findById" | "findIdsByOrg" | "deleteById">;
  /** The server's one name table: a removed team's slug is let go after its row. */
  readonly names: NameTable;
  readonly policies: Pick<GrantPathClient, "cleanupResourceGrants">;
  readonly logger: Logger;
}

export function newTeamRemoval(deps: TeamRemovalDeps): TeamRemoval {
  async function remove(id: string, actingFor: string): Promise<void> {
    await deps.policies.cleanupResourceGrants(
      create(ApiResourceRefSchema, { kind: TEAM_KIND_NAME, id }),
      actingFor,
    );
    const team = await deps.teams.findById(id);
    await deps.teams.deleteById(id);
    await releaseTeamNames(id, team?.metadata?.org ?? "");
  }

  /**
   * Lets the removed team's names go, after its row: best-effort, as every
   * delete's post-row release is, since the next claim of the slug frees a
   * name whose team is gone.
   */
  async function releaseTeamNames(id: string, org: string): Promise<void> {
    try {
      await deps.names.resourceNames.release(TEAM_KIND_NAME, org, id);
    } catch (error) {
      deps.logger.error("team removed but its name could not be released; a later claim frees it", {
        team: id,
        org,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    remove,
    async removeByOrgId(orgId, actingFor): Promise<void> {
      let failed = 0;
      for (const id of await deps.teams.findIdsByOrg(orgId)) {
        try {
          await remove(id, actingFor);
        } catch (error) {
          failed += 1;
          deps.logger.error(
            "team removal failed with its organization; the team row and its policies remain",
            {
              team: id,
              org: orgId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      if (failed > 0) {
        throw new Error(`${failed} team(s) of organization '${orgId}' could not be removed`);
      }
    },
  };
}
