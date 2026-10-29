/**
 * Organization domain steps.
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
 * Organization create is a skip lane by annotation (any signed-in person
 * may found one), so it is also where a credential limited to one
 * organization is refused (RefuseBoundCredential): such a credential works
 * in its organization only and never founds another
 * (authorization/credential-binding.ts), except a child of that
 * organization, which its managers create (children.ts).
 *
 * The delete revokes the organization's grant rows BEFORE its row is
 * deleted, and fails the delete when it cannot, so nothing that grants on
 * the organization outlives it.
 *
 * Proven by organization.conformance.test.ts (CONFORMANCE_TARGET=local),
 * __tests__/organization.test.ts and __tests__/organization-delete.test.ts.
 */
import type { OrganizationNameResolver } from "../../pipeline/interceptors/organization-names.js";
import { create, isMessage } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";

import { Code, ConnectError } from "@connectrpc/connect";

import { boundOrgOf } from "../../extensions/identity.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ResourceReadForWrite, Store } from "../../store/interface.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  EXISTING_RESOURCE_BYTES_KEY,
  EXISTING_RESOURCE_KEY,
} from "../../pipeline/steps/load-existing.js";
import {
  EXISTS_IN_DATABASE_KEY,
  SHOULD_CREATE_KEY,
} from "../../pipeline/steps/load-for-apply.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { GrantPath } from "../grant/grant-path.js";
import { liveOrganizationName, refusalForHeldName } from "./names.js";
import { slugRenamedError } from "../../pipeline/steps/names.js";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceRefSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

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

/** Organization create's refusal of a credential limited to one organization. */
export const BOUND_CREDENTIAL_CREATES_NO_ORGANIZATION_MESSAGE =
  "this credential is limited to one organization and cannot create another, except a child of that organization; sign in as yourself to create an organization";

/**
 * Refuses organization create for a caller whose credential is bound to
 * one organization (a limited API key, a minted user token, a
 * composition's bound lane), unless the request creates a child of that
 * very organization (`spec.parent_org`, which the edge resolver has turned
 * into an id): managing an organization's children is managing the
 * organization, and ValidateChildOrganization still asks
 * `can_manage_child_orgs` on it. Runs first after the Authorize step.
 */
export function newRefuseBoundCredentialStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
  return {
    name: "RefuseBoundCredential",
    execute(ctx: RequestContext<Desc>): void {
      const bound = boundOrgOf(ctx.callerIdentity);
      if (bound !== undefined && parentOrgRequested(ctx.input) !== bound) {
        throw new ConnectError(
          BOUND_CREDENTIAL_CREATES_NO_ORGANIZATION_MESSAGE,
          Code.PermissionDenied,
        );
      }
    },
  };
}

/** The `spec.parent_org` an organization request names; "" for any other message. */
function parentOrgRequested(input: Message): string {
  return isMessage(input, OrganizationSchema)
    ? (input.spec?.parentOrg ?? "")
    : "";
}

/**
 * Refuses an organization that names an organization of its own: an
 * organization belongs to none, so its metadata.org is always empty.
 *
 * An org that names the organization itself is cleared instead: a client
 * that fills every document's metadata.org from its target organization
 * (the TypeScript SDK's `parseManifest` does) sends an organization's own
 * manifest naming itself when that organization is the target. It names
 * itself when it equals the request's own id or slug, or the id that slug
 * resolves to (the serving chain has already turned a slug in
 * metadata.org into its id).
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

/** The organization filed under `id`, or undefined when none is. */
async function readOrganization(
  store: Store,
  id: string,
): Promise<ResourceReadForWrite<typeof OrganizationSchema> | undefined> {
  try {
    return await store.readResourceForWrite(
      ApiResourceKind.organization,
      id,
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
 * The organization a slug names through the name table, or undefined. A
 * slug the organization was renamed away from is refused with
 * SLUG_RENAMED, as every write's is (pipeline/steps/names.ts
 * findResourceForWrite): a file that kept naming it would make a second
 * organization once the hold ends.
 */
async function organizationBySlug(
  store: Store,
  slug: string,
): Promise<ResourceReadForWrite<typeof OrganizationSchema> | undefined> {
  const entry = await liveOrganizationName(store, slug, new Date());
  if (entry?.state === "previous") {
    throw slugRenamedError(ApiResourceKind.organization, slug);
  }
  return entry === undefined ? undefined : readOrganization(store, entry.id);
}

/** Apply's lookup: by id when an organization holds it, else by slug. */
async function organizationForApply(
  store: Store,
  id: string,
  slug: string,
): Promise<ResourceReadForWrite<typeof OrganizationSchema> | undefined> {
  const byId = id === "" ? undefined : await readOrganization(store, id);
  if (byId !== undefined || slug === "") {
    return byId;
  }
  return organizationBySlug(store, slug);
}

/**
 * Apply's existence probe for an organization (the shared LoadForApply's
 * flags and name), in every apply's order (findResourceForWrite): by the
 * id the manifest carries, then, when no organization holds that id, by
 * slug through the name table. So a manifest that carries the id beside a
 * changed slug updates its organization instead of making a second one,
 * and the slug itself changes only through rename; one whose id no longer
 * names an organization (a file from another install, or one kept across
 * a delete and a new create of the slug) updates the organization its slug
 * names; one that names an old slug is refused. The update arm authorizes
 * the id found here, written back to the request.
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
          : (await organizationForApply(store, metadata.id, metadata.slug))
              ?.resource;
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
 * Update's loader for an organization (the shared LoadExisting's name,
 * failure and context keys): by id, as every update names its target
 * (pipeline/steps/load-existing.ts), and by slug through the name table
 * only when no id is given. An id no organization holds is NotFound, never
 * a lookup by slug: the update's Authorize ran on that id. The row's
 * stored bytes are kept for Persist's compare-and-swap
 * (pipeline/guarded-write.ts).
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
      const read =
        metadata.id !== ""
          ? await readOrganization(store, metadata.id)
          : await organizationBySlug(store, metadata.slug);
      if (read === undefined) {
        throw notFoundError(
          "Organization",
          metadata.id !== "" ? metadata.id : metadata.slug,
        );
      }
      metadata.id = read.resource.metadata?.id ?? "";
      ctx.set(EXISTING_RESOURCE_KEY, read.resource);
      ctx.set(EXISTING_RESOURCE_BYTES_KEY, read.bytes);
    },
  };
}

/**
 * Revokes every grant row that names the organization, as principal or as
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
 * `onRevoked` before each row, so a composition's tuples go with
 * their rows. The post-delete CleanupGrants still runs: it catches
 * whatever a concurrent write named the organization with in between.
 */
export function newRevokeOrganizationGrantsStep<Desc extends DescMessage>(
  grantPath: GrantPath,
): PipelineStep<Desc> {
  return {
    name: "RevokeOrganizationGrants",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error("organization delete reached RevokeOrganizationGrants without its loaded row"),
          "failed to remove the organization's grants",
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
          "failed to remove the organization's grants",
        );
      }
    },
  };
}
