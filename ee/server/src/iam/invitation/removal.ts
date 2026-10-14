/**
 * An organization's invitations die with it: the organization delete's
 * removal for this kind (iam/organization-delete.ts, beside the teams' and
 * the federation issuers'), run before the organization's row goes: an
 * invitation left behind would name an organization that is gone, trust
 * nobody administers.
 *
 * Team's removal is the shape (team/removal.ts): the invitation's rows
 * first, through the grant path's `cleanupResourceGrants` (its
 * organization link, which the organization's own cleanup has usually
 * revoked already, and any owner row an older server wrote), then its
 * row; one
 * invitation's failure is logged and the rest are still removed, then the
 * call throws, so the organization delete stops with the organization in
 * place. A row a concurrent write leaves behind opens nothing: redemption
 * refuses an invitation whose organization is gone or younger than it
 * (handlers.ts, organization-links.ts `orphanReason`).
 *
 * There is no delete RPC for an invitation (revoking is its end of life),
 * so this is the kind's only removal.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import type { Logger } from "@stigmer/server";

import type { GrantPathClient } from "../grant/grant-path-client.js";
import type { InvitationStore } from "./store.js";

/** The invitation's kind as an `ApiResourceRef.kind` spells it. */
const INVITATION_KIND_NAME = ApiResourceKind[ApiResourceKind.invitation];

export interface InvitationRemoval {
  /**
   * Every invitation of an organization being deleted, each on its own: one
   * invitation's failure is logged and the rest are still removed, then the
   * call throws. `actingFor`: the person deleting the organization.
   */
  removeByOrgId(orgId: string, actingFor: string): Promise<void>;
}

export interface InvitationRemovalDeps {
  readonly invitations: Pick<InvitationStore, "findIdsByOrg" | "deleteById">;
  readonly grants: Pick<GrantPathClient, "cleanupResourceGrants">;
  readonly logger: Logger;
}

export function newInvitationRemoval(deps: InvitationRemovalDeps): InvitationRemoval {
  return {
    async removeByOrgId(orgId, actingFor): Promise<void> {
      let failed = 0;
      for (const id of await deps.invitations.findIdsByOrg(orgId)) {
        try {
          await deps.grants.cleanupResourceGrants(
            create(ApiResourceRefSchema, { kind: INVITATION_KIND_NAME, id }),
            actingFor,
          );
          await deps.invitations.deleteById(id);
        } catch (error) {
          failed += 1;
          deps.logger.error(
            "invitation removal failed with its organization; the invitation row and its grants remain, and the organization delete stops",
            {
              invitation: id,
              org: orgId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      if (failed > 0) {
        throw new Error(`${failed} invitation(s) of organization '${orgId}' could not be removed`);
      }
    },
  };
}
