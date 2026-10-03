/**
 * The organization count a composition declares (`ServerExtension.orgLimit`),
 * held by the organization domain's own chains rather than by a unit.
 *
 * One rule serves every edition: the composition declares a number and
 * this domain counts against it. The open-source edition declares 1
 * (editions/open-source.ts); a composition that declares nothing holds any
 * number, as the Cloud does. A child organization is an organization row,
 * so it counts like any other.
 *
 * OrganizationLimit runs at the `org-create:pre-side-effect-gate` seat,
 * immediately before the slot's own steps: after the last pure step and
 * before the slug claim, so a refusal leaves nothing written. It is the
 * chain's own step, not an entry in the slot, so the slot's list keeps
 * naming only what units registered there. The count is read, not locked:
 * two creates racing at one below the limit can both pass. The open-source
 * edition does not race there on its usual path, because its one
 * organization is made at boot before the port binds
 * (boot/single-organization.ts). It can when it boots with none (its slug
 * retired, or a slug claim left with no row): two people creating one in
 * the console at once can both pass, leaving a store of two whose fill is
 * off until one is deleted.
 *
 * RefuseDeletingSingleOrganization runs in the delete chain under a
 * declared limit of 1, after the organization is loaded and before the
 * first write (RetireOrganizationSlug), and refuses when the store holds
 * that organization alone: deleting a server's only organization would leave
 * a server with no organization and a slug that is never taken again, so the
 * next boot would make another under a new slug. Refused, it writes nothing.
 * A store that holds several (one from before the server held one) may
 * delete down to one, which is the way back to a server that fills it. The
 * count is read, not locked, as the limit's is: two deletes racing on a
 * store that holds two can both pass and leave none. The next boot then
 * makes the organization again, or, when the slug was retired, warns and
 * lets the console's onboarding make one, which the limit admits at zero.
 *
 * Both reasons are wire contract, documented on OrganizationCommandController
 * create and delete.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Store } from "../../store/interface.js";
import {
  failedPreconditionError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";

/**
 * The slug of the organization a one-organization server makes at its
 * first start (boot/single-organization.ts) — the one the CLI used to make
 * on a laptop, so a manifest or a doc that names it stays true.
 */
export const SINGLE_ORGANIZATION_SLUG = "stigmer";

/**
 * The bootstrap-state key that names the server's organization (its id):
 * the one organization a one-organization server holds and fills, recorded
 * by every start that settles the fill, whoever made it (the server's own
 * boot step, or an older release's console or CLI before the server held
 * one). It is a recorded fact the membership rules read
 * (iampolicy/membership.ts: arms 3 and 4 answer `owner` on that
 * organization, and the laptop operator account is nobody there), never
 * the creator stamp: under sign-in the server makes it as nobody
 * (`"system"`), so the stamp cannot say whose it is. It does not decide
 * whether to make one: "none in the store" does.
 */
export const SINGLE_ORG_KEY = "single_org";

/** The ErrorInfo reason a create carries once the server holds its declared number of organizations; metadata `limit`. */
export const ORGANIZATION_LIMIT_REACHED = "ORGANIZATION_LIMIT_REACHED";

/** The ErrorInfo reason a delete of a one-organization server's organization carries; metadata `org`. */
export const ORGANIZATION_IS_SINGLE = "ORGANIZATION_IS_SINGLE";

export function newOrganizationLimitStep<Desc extends DescMessage>(
  store: Store,
  limit: number,
): PipelineStep<Desc> {
  return {
    name: "OrganizationLimit",
    async execute(): Promise<void> {
      let held: number;
      try {
        held = (await store.listResources(ApiResourceKind.organization)).length;
      } catch (error) {
        throw internalError(error, "failed to count organizations");
      }
      if (held >= limit) {
        throw failedPreconditionError(
          `this server holds ${limit} ${limit === 1 ? "organization" : "organizations"}, its limit`,
          {
            reason: ORGANIZATION_LIMIT_REACHED,
            metadata: { limit: String(limit) },
          },
        );
      }
    },
  };
}

export function newRefuseDeletingSingleOrganizationStep<
  Desc extends DescMessage,
>(store: Store): PipelineStep<Desc> {
  return {
    name: "RefuseDeletingSingleOrganization",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error(
            "organization delete reached RefuseDeletingSingleOrganization without its loaded row",
          ),
          "failed to delete organization",
        );
      }
      let held: number;
      try {
        held = (await store.listResources(ApiResourceKind.organization)).length;
      } catch (error) {
        throw internalError(error, "failed to count organizations");
      }
      if (held > 1) {
        return;
      }
      throw failedPreconditionError(
        "this server's only organization cannot be deleted",
        { reason: ORGANIZATION_IS_SINGLE, metadata: { org: id } },
      );
    },
  };
}
