/**
 * The Enterprise identity domain's step on the library's
 * `org-delete:pre-delete` slot, which runs after the organization is
 * loaded and before anything is removed (stigmer/stigmer#1358). What this
 * domain keeps for the organization is trust configuration (providers,
 * teams, invitations), and none of it may outlive the organization with
 * nobody to administer it; it names the organization's id, which no later
 * organization carries. So it goes before the row does, or the delete does
 * not happen.
 *
 * RemoveOrganizationIdentity removes the organization's teams, its identity
 * providers and its invitations, each through its kind's one removal. Every
 * removal tries each row on its own and throws once the pass is done when
 * any failed; the first throw here fails the delete with the organization
 * in place, and a retry resumes with whatever is left.
 *
 * An organization that still has child organizations never reaches the
 * slot: the library refuses its delete first (ORGANIZATION_HAS_CHILDREN).
 * A child's external id is the library's name-table claim, released by the
 * library after the row.
 *
 * The library then revokes every policy row naming the organization and
 * accepts its deletion, and from then on every request naming the
 * organization answers not-found, so nothing new is written into it. A
 * provider, team or invitation written in the moment between this step
 * and that mark is removed by the purge: the unit's `identity` purge stage
 * (`newOrganizationIdentityPurgeStage`) runs the same three removals again,
 * as the purge, before the library removes the organization's row. The
 * stage also removes the organization's rows of the sign-in grant ledger
 * (federation/sign-in-grants.ts), the record of which accounts a provider
 * signed in to it: the ledger is this unit's port, so its rows go with the
 * unit that writes them, whichever host composes it. They go after the
 * providers, whose removal ends every sign-in that could write one. It
 * declares the three kinds, so the library's boot check knows who removes
 * them. Until the purge has run, nothing trusts such a row either: the
 * federated verifier and SSO discovery refuse a provider whose
 * organization is gone or younger than it, and redemption refuses such an
 * invitation (organization-links.ts `orphanReason`).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type {
  Logger,
  OrganizationPurgeStage,
  PipelineStep,
  RequestContext,
} from "@stigmer/server";
import { EXISTING_RESOURCE_KEY, internalError } from "@stigmer/server";

import type { AccessMoveTicketStore } from "./access-move/store.js";
import type { SignInGrantLedger } from "./federation/sign-in-grants.js";
import type { InvitationRemoval } from "./invitation/removal.js";
import type { ProviderRemoval } from "./provider/removal.js";
import type { TeamRemoval } from "./team/removal.js";

/** The fixed copy a removal fault answers; the cause is logged, never sent. */
export const ORGANIZATION_IDENTITY_REMOVAL_FAILED =
  "failed to remove the organization's identity providers, teams and invitations";

export interface RemoveOrganizationIdentityDeps {
  readonly teams: Pick<TeamRemoval, "removeByOrgId">;
  readonly providers: Pick<ProviderRemoval, "removeByOrgId">;
  readonly invitations: Pick<InvitationRemoval, "removeByOrgId">;
}

export function newRemoveOrganizationIdentityStep(
  deps: RemoveOrganizationIdentityDeps,
): PipelineStep<DescMessage> {
  return {
    name: "RemoveOrganizationIdentity",
    async execute(ctx: RequestContext<DescMessage>): Promise<void> {
      const org = organizationIdOf(ctx);
      // The removals revoke rows on the deleting person's behalf, so the
      // permission history names who deleted the organization.
      const actingFor = ctx.callerIdentity.identityId;
      try {
        await deps.teams.removeByOrgId(org, actingFor);
        await deps.providers.removeByOrgId(org, actingFor);
        await deps.invitations.removeByOrgId(org, actingFor);
      } catch (error) {
        throw internalError(error, ORGANIZATION_IDENTITY_REMOVAL_FAILED);
      }
    },
  };
}

/** The identity purge stage's name, as the deletion record and the logs carry it. */
export const IDENTITY_PURGE_STAGE = "identity";

export interface OrganizationIdentityPurgeDeps extends RemoveOrganizationIdentityDeps {
  /** The ledger's organization removal; the purge's alone (module header). */
  readonly signInGrants: Pick<SignInGrantLedger, "removeByOrgId">;
  /** The organization's access move tickets (iam/access-move/store.ts). */
  readonly accessMoves: Pick<AccessMoveTicketStore, "removeByOrgId">;
  readonly logger: Logger;
}

/**
 * The `identity` purge stage: the slot step's three removals again, for an
 * organization being deleted, acting for the purge, and the sign-in grant
 * ledger's rows after the providers. Idempotent: each removal lists what
 * is left of the organization's rows and removes it.
 * A fault is logged with its cause and thrown; the purge retries.
 */
export function newOrganizationIdentityPurgeStage(
  deps: OrganizationIdentityPurgeDeps,
): OrganizationPurgeStage {
  return {
    name: IDENTITY_PURGE_STAGE,
    kinds: [
      ApiResourceKind.identity_provider,
      ApiResourceKind.team,
      ApiResourceKind.invitation,
    ],
    async run(context) {
      const org = context.org.id;
      const actingFor = context.caller.identityId;
      try {
        await deps.teams.removeByOrgId(org, actingFor);
        await deps.providers.removeByOrgId(org, actingFor);
        const signInGrants = await deps.signInGrants.removeByOrgId(org);
        if (signInGrants > 0) {
          deps.logger.info("an organization's sign-in grants removed", { org, signInGrants });
        }
        await deps.invitations.removeByOrgId(org, actingFor);
        await deps.accessMoves.removeByOrgId(org);
      } catch (error) {
        deps.logger.error(
          "could not remove the identity providers, teams, sign-in grants, invitations or access move tickets of an organization being deleted",
          { org, error: error instanceof Error ? error.message : String(error) },
        );
        throw error;
      }
      return { more: false };
    },
  };
}

/** The id of the organization the delete loaded. */
function organizationIdOf(ctx: RequestContext<DescMessage>): string {
  const organization = ctx.get(EXISTING_RESOURCE_KEY) as Organization | undefined;
  const id = organization?.metadata?.id ?? "";
  if (id === "") {
    throw internalError(
      new Error("org-delete:pre-delete ran without the loaded organization"),
      ORGANIZATION_IDENTITY_REMOVAL_FAILED,
    );
  }
  return id;
}
