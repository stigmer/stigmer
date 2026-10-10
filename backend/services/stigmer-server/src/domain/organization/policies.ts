/**
 * An organization's policies (`spec.policies`): what it lets its members
 * do, today whether members may create agents. A policy decides who may do
 * what, so it follows the visibility precedent (pipeline/steps/
 * build-update-state.ts): one door changes it and the authorization model
 * holds it.
 *
 *   - DefaultOrganizationPolicies (create): an omitted message becomes the
 *     defaults, members may create agents.
 *   - AnnounceCreatedOrganizationPolicies (create, after the row and its
 *     tuples persist): an organization created with agent creation open
 *     hands the lifecycle's `onOrganizationPoliciesChanged` the edge to
 *     write. Created closed, there is nothing to write.
 *   - PreservePolicies (update and apply, after BuildUpdateState): the
 *     stored policies stay, whatever the request carries, so a manifest
 *     written before an admin changed a policy neither fails nor reverts
 *     it. The CLI's apply follows up through updatePolicies when a
 *     manifest declares policies that differ.
 *   - updatePolicies (its own chain): replaces the whole message. Its order
 *     is fail-closed (extensions/resource-authorization.ts): a change that
 *     closes an act is announced BEFORE the row persists, one that opens an
 *     act AFTER; a throw fails the request. A change of nothing writes
 *     nothing and announces the standing policy again, so a retry repairs
 *     an edge an earlier announcement failed to write (the row persisted,
 *     its announcement threw): the lifecycle makes the edge match the
 *     policy it is told, idempotently.
 *
 * Open source derives the policy edge from the row at check time
 * (authorization/model/organization-policies.ts), so with no lifecycle
 * method composed the row alone decides.
 */
import { clone, create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { UpdateOrganizationPoliciesInputSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import type { OrganizationPolicies } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import {
  OrganizationPoliciesSchema,
  OrganizationSpecSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";

import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

type UpdatePoliciesDesc = typeof UpdateOrganizationPoliciesInputSchema;

/** Where the updatePolicies chain keeps the organization it changes, and returns. */
export const POLICIES_ORGANIZATION_KEY = "policiesOrganization";

/** The policies a new organization starts with: members may create agents. */
export function defaultOrganizationPolicies(): OrganizationPolicies {
  return create(OrganizationPoliciesSchema, { membersCanCreateAgents: true });
}

/**
 * Whether `before` → `after` opens agent creation to members. A stored row
 * with no policies (one stored before policies existed) reads as open, but
 * an edition that stores tuples never wrote its edge, so saving it either
 * way announces: the write is idempotent. A create is its own step.
 */
function opensAgentCreation(
  before: OrganizationPolicies | undefined,
  after: OrganizationPolicies,
): boolean {
  return after.membersCanCreateAgents && before?.membersCanCreateAgents !== true;
}

/** Whether `before` → `after` closes agent creation to members. */
function closesAgentCreation(
  before: OrganizationPolicies | undefined,
  after: OrganizationPolicies,
): boolean {
  return !after.membersCanCreateAgents && before?.membersCanCreateAgents !== false;
}

async function announce(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  organizationId: string,
  before: OrganizationPolicies | undefined,
  after: OrganizationPolicies,
): Promise<void> {
  if (lifecycle?.onOrganizationPoliciesChanged === undefined) {
    return;
  }
  try {
    await lifecycle.onOrganizationPoliciesChanged({ organizationId, before, after });
  } catch (error) {
    throw internalError(error, "failed to apply the organization's policies");
  }
}

/** DefaultOrganizationPolicies — create: an omitted message becomes the defaults. */
export function newDefaultOrganizationPoliciesStep(): PipelineStep<
  typeof OrganizationSchema
> {
  return {
    name: "DefaultOrganizationPolicies",
    execute(ctx: RequestContext<typeof OrganizationSchema>): void {
      const spec = (ctx.newState.spec ??= create(OrganizationSpecSchema));
      spec.policies ??= defaultOrganizationPolicies();
    },
  };
}

/**
 * AnnounceCreatedOrganizationPolicies — create, after Persist and the
 * creation tuples: an organization created with agent creation open has its
 * edge written; one created closed has none to write.
 */
export function newAnnounceCreatedOrganizationPoliciesStep(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "AnnounceCreatedOrganizationPolicies",
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      const after = ctx.newState.spec?.policies ?? defaultOrganizationPolicies();
      if (!after.membersCanCreateAgents) {
        return;
      }
      await announce(lifecycle, ctx.newState.metadata?.id ?? "", undefined, after);
    },
  };
}

/** PreservePolicies — update and apply, after BuildUpdateState: the stored policies stay. */
export function newPreservePoliciesStep(): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "PreservePolicies",
    execute(ctx: RequestContext<typeof OrganizationSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Organization | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("organization update reached PreservePolicies without its loaded row"),
          "failed to update organization",
        );
      }
      const stored = existing.spec?.policies;
      if (stored === undefined) {
        if (ctx.newState.spec !== undefined) {
          ctx.newState.spec.policies = undefined;
        }
        return;
      }
      const spec = (ctx.newState.spec ??= create(OrganizationSpecSchema));
      spec.policies = clone(OrganizationPoliciesSchema, stored);
    },
  };
}

/** LoadOrganizationForPolicies — updatePolicies: the organization by id; a missing one is NotFound. */
export function newLoadOrganizationForPoliciesStep(
  store: Store,
): PipelineStep<UpdatePoliciesDesc> {
  return {
    name: "LoadOrganizationForPolicies",
    async execute(ctx: RequestContext<UpdatePoliciesDesc>): Promise<void> {
      let organization: Organization;
      try {
        organization = await store.getResource(
          ApiResourceKind.organization,
          ctx.input.orgId,
          OrganizationSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Organization", ctx.input.orgId);
        }
        throw internalError(error, "failed to load organization");
      }
      ctx.set(POLICIES_ORGANIZATION_KEY, organization);
    },
  };
}

/**
 * ChangeOrganizationPolicies — updatePolicies: replaces the whole message,
 * stamps the spec audit, and announces a change that closes an act before
 * the write. A change to the same policies writes nothing.
 */
export function newChangeOrganizationPoliciesStep(
  store: Store,
  lifecycle: ResourceAuthorizationLifecycle | undefined,
): PipelineStep<UpdatePoliciesDesc> {
  return {
    name: "ChangeOrganizationPolicies",
    async execute(ctx: RequestContext<UpdatePoliciesDesc>): Promise<void> {
      const organization = ctx.get(POLICIES_ORGANIZATION_KEY) as Organization;
      const id = organization.metadata?.id ?? "";
      const before = organization.spec?.policies;
      const after = clone(
        OrganizationPoliciesSchema,
        ctx.input.policies ?? create(OrganizationPoliciesSchema),
      );
      if (
        before !== undefined &&
        before.membersCanCreateAgents === after.membersCanCreateAgents
      ) {
        await announce(lifecycle, id, before, after);
        return;
      }
      if (closesAgentCreation(before, after)) {
        await announce(lifecycle, id, before, after);
      }
      (organization.spec ??= create(OrganizationSpecSchema)).policies = after;
      setAuditFieldsForUpdate(
        OrganizationSchema,
        organization,
        "spec_audit",
        ctx.callerIdentity,
      );
      try {
        await store.saveResource(
          ApiResourceKind.organization,
          id,
          OrganizationSchema,
          organization,
        );
      } catch (error) {
        throw internalError(error, "failed to save organization");
      }
      if (opensAgentCreation(before, after)) {
        await announce(lifecycle, id, before, after);
      }
    },
  };
}
