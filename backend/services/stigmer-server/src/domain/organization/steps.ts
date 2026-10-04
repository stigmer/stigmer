/**
 * Organization domain steps — port
 * pkg/domain/organization/controller/steps.go, reshaped for minted ids.
 *
 * An organization is filed under the id BuildNewState mints (org_<ulid>),
 * like every other kind, and its slug is a name in the resource-name table
 * (names.ts), unique across the server and changeable through rename. So
 * the steps here differ from the shared ones only where a slug is global
 * rather than org-scoped: the duplicate check and the two loaders read the
 * name table, which also answers for a renamed organization's previous
 * name. An organization belongs to no organization, so its own
 * metadata.org must be empty.
 *
 * The delete revokes the organization's policy rows BEFORE its row is
 * deleted, and fails the delete when it cannot, so nothing that grants on
 * the organization outlives it.
 *
 * Proven by organization.conformance.test.ts (CONFORMANCE_TARGET=local),
 * __tests__/organization.test.ts and __tests__/organization-delete.test.ts.
 */
import type { OrganizationNameResolver } from "../../pipeline/interceptors/organization-names.js";
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  EXISTS_IN_DATABASE_KEY,
  SHOULD_CREATE_KEY,
} from "../../pipeline/steps/load-for-apply.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { IamPolicyGrantPath } from "../iampolicy/grant-path.js";
import { liveOrganizationName, refusalForHeldName } from "./names.js";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

/**
 * Rejects a create whose slug a live organization answers to, as its
 * current name or as a recent previous one: the early refusal, before any
 * gate. The atomic guarantee is ClaimOrganizationSlug's, immediately before
 * Persist (names.ts). A name whose organization is gone does not count.
 *
 * Keeps the shared vocabulary name: the inventory row reads straight onto
 * the chain even though the semantics are organization-specific.
 */
export function newCheckOrgDuplicateStep(
  store: Store,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "CheckDuplicate",
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("organization metadata is nil"), "duplicate check");
      }
      // ResolveSlug runs before this step, so an empty slug here is a
      // server-side pipeline-ordering bug, not bad client input.
      if (metadata.slug === "") {
        throw internalError(new Error("organization slug is empty"), "duplicate check");
      }
      let entry;
      try {
        entry = await liveOrganizationName(store, metadata.slug, new Date());
      } catch (error) {
        throw internalError(error, "failed to check for duplicate organization");
      }
      if (entry !== undefined) {
        throw refusalForHeldName(entry);
      }
    },
  };
}

/**
 * Refuses an organization that names an organization of its own: an
 * organization belongs to none, so its metadata.org is always empty.
 *
 * An org that names the organization itself is cleared instead: earlier
 * releases stored an organization's own slug there (clients sent it on
 * create), so its `get -o yaml` manifest, and the clients of that time,
 * still carry it. It names itself when it equals the request's own id or
 * slug, or the id that slug resolves to (the serving chain has already
 * turned a slug in metadata.org into its id). Stored rows are not
 * rewritten; an update keeps what the row holds.
 */
export function newRefuseOrganizationOrgStep(
  resolver: OrganizationNameResolver,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "RefuseOrganizationOrg",
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      const org = metadata?.org ?? "";
      if (
        metadata !== undefined &&
        org !== "" &&
        (org === metadata.id ||
          org === metadata.slug ||
          (metadata.slug !== "" && org === (await resolver.resolve(metadata.slug))))
      ) {
        metadata.org = "";
        return;
      }
      if (org !== "") {
        throw invalidArgumentError(
          "an organization belongs to no organization: metadata.org must be empty",
        );
      }
    },
  };
}

/**
 * The organization a request names by id or slug, or undefined. The id is
 * read first; a slug resolves through the name table, so a renamed
 * organization's previous name still finds it.
 */
async function findOrganization(
  store: Store,
  id: string,
  slug: string,
): Promise<Organization | undefined> {
  const byId = id !== "" ? id : (await liveOrganizationName(store, slug, new Date()))?.id;
  if (byId === undefined || byId === "") {
    return undefined;
  }
  try {
    return await store.getResource(
      ApiResourceKind.organization,
      byId,
      OrganizationSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Apply's existence probe for an organization (the shared LoadForApply's
 * flags and name): by id when the manifest carries one, else by slug
 * through the name table. So a manifest that names an old slug, or that
 * carries the id beside a changed slug, updates its organization instead of
 * making a second one; the slug itself changes only through rename.
 */
export function newLoadOrganizationForApplyStep(
  store: Store,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "LoadForApply",
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      const existing =
        metadata === undefined
          ? undefined
          : await findOrganization(store, metadata.id, metadata.slug);
      if (existing === undefined) {
        ctx.set(EXISTS_IN_DATABASE_KEY, false);
        ctx.set(SHOULD_CREATE_KEY, true);
        return;
      }
      ctx.set(EXISTING_RESOURCE_KEY, existing);
      ctx.set(EXISTS_IN_DATABASE_KEY, true);
      ctx.set(SHOULD_CREATE_KEY, false);
      if (metadata !== undefined) {
        metadata.id = existing.metadata?.id ?? "";
      }
    },
  };
}

/**
 * Update's loader for an organization (the shared LoadExisting's name and
 * failure): by id, else by slug through the name table. NotFound fails the
 * update.
 */
export function newLoadExistingOrganizationStep(
  store: Store,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "LoadExisting",
    async execute(ctx: RequestContext<typeof OrganizationSchema>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("resource metadata is nil"), "load existing");
      }
      if (metadata.id === "" && metadata.slug === "") {
        throw invalidArgumentError("resource id or slug is required for update");
      }
      const existing = await findOrganization(store, metadata.id, metadata.slug);
      if (existing === undefined) {
        throw notFoundError(
          "Organization",
          metadata.id !== "" ? metadata.id : metadata.slug,
        );
      }
      metadata.id = existing.metadata?.id ?? "";
      ctx.set(EXISTING_RESOURCE_KEY, existing);
    },
  };
}

/**
 * Revokes every policy row that names the organization, as principal or as
 * resource, before the delete removes its row: the rows its members hold
 * on it, and the scope link every organization-scoped resource holds to
 * it. Runs after the `org-delete:pre-delete` slot and before
 * DeleteResource.
 *
 * The generic delete chains clean up after the row and log a fault,
 * because a deleted resource's rows grant nothing once it is gone. An
 * organization is the exception: its rows are the grants on the tenancy
 * root itself, and the scope link of every resource under it. They name the
 * organization's id, which no later organization can carry, but a row left
 * behind would still be a grant nobody administers. So this
 * step does not catch. A fault fails the delete with the
 * organization in place, and a retry resumes where the revocation stopped
 * (the grant path revokes the organization's owners last, so the owner
 * who retries still can). The grant path fires the composed driver's
 * `onPolicyRevoked` before each row, so a composition's tuples go with
 * their rows. The post-delete CleanupIamPolicies still runs: it catches
 * whatever a concurrent write named the organization with in between.
 */
export function newRevokeOrganizationPoliciesStep<Desc extends DescMessage>(
  grantPath: IamPolicyGrantPath,
): PipelineStep<Desc> {
  return {
    name: "RevokeOrganizationPolicies",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error("organization delete reached RevokeOrganizationPolicies without its loaded row"),
          "failed to remove the organization's access policies",
        );
      }
      try {
        await grantPath.cleanupResource(
          create(ApiResourceRefSchema, {
            kind: ApiResourceKind[ApiResourceKind.organization],
            id,
          }),
          ctx.callerIdentity,
        );
      } catch (error) {
        throw internalError(
          error,
          "failed to remove the organization's access policies",
        );
      }
    },
  };
}
