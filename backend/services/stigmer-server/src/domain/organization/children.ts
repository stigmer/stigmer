/**
 * Parent and child organizations: an organization may name a parent in
 * `spec.parent_org`, one level deep, and carry the parent's own
 * identifier for it in `spec.external_id` ("cust-4411", the customer id
 * an integrator keeps). Both are fixed at create. The behaviour lives
 * here, in the domain every edition runs, because it is a field of the
 * organization rather than of a sign-in setting:
 *
 *   - ValidateChildOrganization (create, at the pre-side-effect seat):
 *     `can_manage_child_orgs` on the parent, a parent the caller may not
 *     manage refused exactly as a missing one, so only its managers learn
 *     anything; then the parent may not itself be a child. Runs before
 *     any unit's admission and before anything is written, so a refusal
 *     leaves nothing behind.
 *   - ClaimExternalId (create, immediately before Persist, beside the
 *     slug claim): the external id is a name in the resource-name table,
 *     unique among the parent's children
 *     (`{kind: "organization_external_id", org: <parent>, name: <id>}`),
 *     claimed atomically, so of two concurrent creates exactly one wins.
 *     The claim is released when the create fails before its row is
 *     stored, and at the child's delete.
 *   - Nobody owns a new child: the creation event carries NONE
 *     (`childOwnerAttribution`), so neither open source's role lifecycle
 *     nor a tuple driver makes the creator its owner. The parent's admins
 *     manage it (`parent_admin`, fga/model/tenancy/organization.fga) and
 *     grant its people; the membership rules skip it
 *     (domain/iampolicy/membership.ts).
 *   - LinkChildOrganization (create, after the creation event): the
 *     lifecycle's `onChildOrganizationLinked`, so an edition that stores
 *     tuples writes both edges. Open source derives them at check time
 *     (authorization/model/child-organizations.ts).
 *   - PreserveChildLink (update): `parent_org` and `external_id` stay as
 *     stored; a manifest carries both, so apply is idempotent.
 *   - RefuseDeletingParent (delete, before the pre-delete slot): an
 *     organization that still has children is not deleted
 *     (ORGANIZATION_HAS_CHILDREN).
 *
 * A parent's children are read through the organization list index
 * (list-index.ts), never by decoding the kind. `newChildOrganizations`
 * is the lookup a composition receives (ComposedServices
 * .childOrganizations): sign-in routing by external id and billing's
 * roll-up.
 *
 * Proven by __tests__/children.test.ts and child-organizations
 * .conformance.test.ts.
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { fromBinary, isMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ChildOrganizations } from "../../extensions/child-organizations.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  alreadyExistsError,
  failedPreconditionError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import type { OwnerAttributionOf } from "../../pipeline/steps/authorization-tuples.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameKey,
  Store,
} from "../../store/interface.js";
import { organizationListIndex } from "./list-index.js";

/** The ErrorInfo reason a create naming a child as its parent carries; metadata `parent_org`. */
export const ORGANIZATION_PARENT_IS_CHILD = "ORGANIZATION_PARENT_IS_CHILD";

/** The ErrorInfo reason a delete of an organization that has children carries; metadata `org`. */
export const ORGANIZATION_HAS_CHILDREN = "ORGANIZATION_HAS_CHILDREN";

/**
 * The deny copy for a parent the caller may not manage, or that does not
 * exist: the getByExternalId and listChildOrgs annotations' own words, so
 * the create, the lookup and the list refuse alike.
 */
export const CHILD_ORGS_DENIED_MESSAGE =
  "unauthorized to manage this organization's child organizations";

/**
 * The name-table namespace external ids are claimed in: one per parent
 * (`org` is the parent's id), so two parents may each have a child called
 * "cust-4411" and one parent may not have two.
 */
export const EXTERNAL_ID_NAME_KIND = "organization_external_id";

/** Where ClaimExternalId leaves the entry it won, for the release after a failure. */
const CLAIMED_EXTERNAL_ID_KEY = "organizationExternalIdClaim";

/** A child's external id as a key in the name table. */
export function externalIdNameKey(
  parentId: string,
  externalId: string,
): ResourceNameKey {
  return { kind: EXTERNAL_ID_NAME_KIND, org: parentId, name: externalId };
}

function specOf(resource: Message): Organization["spec"] {
  return isMessage(resource, OrganizationSchema) ? resource.spec : undefined;
}

/** The parent a stored or requested organization names; "" for one that has none. */
export function parentOrgOf(organization: Organization): string {
  return organization.spec?.parentOrg ?? "";
}

/**
 * The creation event's owner for an organization: NONE for a child, which
 * nobody owns; the kind's configured attribution otherwise.
 */
export const childOwnerAttribution: OwnerAttributionOf = (resource) =>
  (specOf(resource)?.parentOrg ?? "") === ""
    ? undefined
    : OwnerAttributionType.NONE;

async function loadOrganization(
  store: Store,
  id: string,
): Promise<Organization | undefined> {
  try {
    return await store.getResource(
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
 * Whether `orgId` is a child of `parentId`: one read of the child's row.
 * False for an organization that does not exist, so a caller answers a
 * missing organization and another parent's child alike.
 */
export async function isChildOf(
  store: Pick<Store, "getResource">,
  orgId: string,
  parentId: string,
): Promise<boolean> {
  if (orgId === "" || parentId === "" || orgId === parentId) {
    return false;
  }
  try {
    const child = await store.getResource(
      ApiResourceKind.organization,
      orgId,
      OrganizationSchema,
    );
    return parentOrgOf(child) === parentId;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return false;
    }
    throw error;
  }
}

/** Every child of `parentId`, decoded, newest first, through the list index. */
export async function childrenOf(
  store: Store,
  parentId: string,
): Promise<Organization[]> {
  if (parentId === "") {
    return [];
  }
  const rows = await store.queryResources(organizationListIndex, {
    anyKey: [{ name: "parent_org", value: parentId }],
  });
  const children: Organization[] = [];
  for (const row of rows) {
    const child = fromBinary(OrganizationSchema, row.data);
    // The index narrows; the row's own field keeps the answer exact.
    if (parentOrgOf(child) === parentId) {
      children.push(child);
    }
  }
  return children;
}

/** The lookups a composition receives (extensions/child-organizations.ts). */
export function newChildOrganizations(store: Store): ChildOrganizations {
  return {
    async findByExternalId(parentId, externalId) {
      if (parentId === "" || externalId === "") {
        return undefined;
      }
      const entry = await store.resourceNames.resolve(
        externalIdNameKey(parentId, externalId),
        new Date().toISOString(),
      );
      if (entry === undefined) {
        return undefined;
      }
      const child = await loadOrganization(store, entry.id);
      // A claim whose create never stored its row, or whose child is gone
      // and whose release failed, answers nothing.
      return child !== undefined &&
        parentOrgOf(child) === parentId &&
        (child.spec?.externalId ?? "") === externalId
        ? child
        : undefined;
    },
    async listIds(parentId) {
      return (await childrenOf(store, parentId)).map(
        (child) => child.metadata?.id ?? "",
      );
    },
  };
}

// =============================================================================
// Create
// =============================================================================

/**
 * ValidateChildOrganization — for a create that names `spec.parent_org`:
 * the caller manages the parent, and the parent is not itself a child.
 * The edge resolver has already turned a parent slug into its id; a name
 * nothing holds passed through and is refused here as a parent the caller
 * may not manage.
 */
export function newValidateChildOrganizationStep(
  store: Store,
  authorizer: Authorizer,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "ValidateChildOrganization",
    async execute(
      ctx: RequestContext<typeof OrganizationSchema>,
    ): Promise<void> {
      const parentId = parentOrgOf(ctx.newState);
      if (parentId === "") {
        return;
      }
      try {
        await authorizeResolvedResource(
          authorizer,
          ctx.callerIdentity,
          {
            permission: IamPermission.can_manage_child_orgs,
            resourceKind: ApiResourceKind.organization,
            resourceId: parentId,
          },
          CHILD_ORGS_DENIED_MESSAGE,
        );
      } catch (error) {
        throw asChildOrgsDenial(error);
      }
      let parent: Organization | undefined;
      try {
        parent = await loadOrganization(store, parentId);
      } catch (error) {
        throw internalError(error, "failed to read the parent organization");
      }
      if (parent === undefined) {
        // Reached only by a caller every check admits (the in-process
        // class, a trusted-local server): the same sentence as a parent
        // the caller may not manage.
        throw new ConnectError(CHILD_ORGS_DENIED_MESSAGE, Code.PermissionDenied);
      }
      if (parentOrgOf(parent) !== "") {
        throw failedPreconditionError(
          "a child organization cannot have child organizations: name an organization that is not a child as parent_org",
          {
            reason: ORGANIZATION_PARENT_IS_CHILD,
            metadata: { parent_org: parentId },
          },
        );
      }
    },
  };
}

/**
 * A NotFound for the parent answers as the denial, so a caller cannot
 * tell an organization that does not exist from one they may not manage.
 */
export function asChildOrgsDenial(error: unknown): unknown {
  if (error instanceof ConnectError && error.code === Code.NotFound) {
    return new ConnectError(CHILD_ORGS_DENIED_MESSAGE, Code.PermissionDenied);
  }
  return error;
}

/**
 * ClaimExternalId — immediately before Persist, after the slug claim:
 * claims the child's external id among its parent's children, for the
 * minted id. A claim held by a child that is gone (its row never landed,
 * or its delete's release failed) is let go and claimed again, as the slug
 * claim frees a gone holder; one held by a live child is refused
 * AlreadyExists.
 */
export function newClaimExternalIdStep(
  store: Store,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "ClaimExternalId",
    async execute(
      ctx: RequestContext<typeof OrganizationSchema>,
    ): Promise<void> {
      const parentId = parentOrgOf(ctx.newState);
      const externalId = ctx.newState.spec?.externalId ?? "";
      if (parentId === "" || externalId === "") {
        return;
      }
      const id = metadataOf(ctx.newState)?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error("organization id is empty"),
          "failed to claim the organization's external id",
        );
      }
      let claim;
      try {
        claim = await claimFreeingGoneChild(
          store,
          externalIdNameKey(parentId, externalId),
          id,
        );
      } catch (error) {
        throw internalError(error, "failed to claim the organization's external id");
      }
      if (!claim.claimed) {
        throw alreadyExistsError(
          "Organization",
          `external_id '${externalId}' under this parent`,
        );
      }
      ctx.set(CLAIMED_EXTERNAL_ID_KEY, claim.entry);
    },
  };
}

/** How old a claim must be before a holder with no row counts as gone (a create holds its claim a step before its row). */
const ABANDONED_CLAIM_AFTER_MS = 60 * 1000;

async function claimFreeingGoneChild(
  store: Store,
  key: ResourceNameKey,
  id: string,
) {
  const now = new Date();
  const claim = await store.resourceNames.claim(key, id, now.toISOString());
  if (claim.claimed) {
    return claim;
  }
  const holder = claim.entry;
  const young =
    now.getTime() - Date.parse(holder.claimedAt) < ABANDONED_CLAIM_AFTER_MS;
  if (young || (await loadOrganization(store, holder.id)) !== undefined) {
    return claim;
  }
  await store.resourceNames.release(key.kind, key.org, holder.id);
  return store.resourceNames.claim(key, id, now.toISOString());
}

/**
 * Frees the external id a failed create claimed when its organization was
 * never stored, beside the slug's release (names.ts
 * releaseSlugClaimAfterFailure, whose reasoning this follows). A fault is
 * logged; the next claim of the id frees it once it is old enough.
 */
export async function releaseExternalIdClaimAfterFailure(
  store: Store,
  logger: Logger,
  ctx: RequestContext<typeof OrganizationSchema>,
): Promise<void> {
  const entry = ctx.get(CLAIMED_EXTERNAL_ID_KEY) as
    | ResourceNameEntry
    | undefined;
  if (entry === undefined) {
    return;
  }
  try {
    if ((await loadOrganization(store, entry.id)) !== undefined) {
      return; // stored: the child exists and keeps its external id
    }
    await store.resourceNames.release(entry.kind, entry.org, entry.id);
  } catch (error) {
    logger.error(
      "organization create failed and its external id claim could not be released; it stays claimed",
      {
        parent_org: entry.org,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * LinkChildOrganization — after CreateAuthorizationTuples: the lifecycle's
 * child-organization event, for an edition that stores the edges. No
 * driver, or one without the method: nothing to do.
 */
export function newLinkChildOrganizationStep(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
): PipelineStep<typeof OrganizationSchema> {
  return {
    name: "LinkChildOrganization",
    async execute(
      ctx: RequestContext<typeof OrganizationSchema>,
    ): Promise<void> {
      const parentId = parentOrgOf(ctx.newState);
      if (parentId === "" || lifecycle?.onChildOrganizationLinked === undefined) {
        return;
      }
      try {
        await lifecycle.onChildOrganizationLinked({
          childId: metadataOf(ctx.newState)?.id ?? "",
          parentId,
        });
      } catch (error) {
        throw internalError(error, "failed to link the child organization");
      }
    },
  };
}

// =============================================================================
// Update
// =============================================================================

/**
 * PreserveChildLink — after BuildUpdateState: `parent_org` and
 * `external_id` stay as stored. Neither moves after create (a child is
 * never re-parented, and its external id is the sign-in key its people's
 * tokens carry), and a manifest that carries them, or one that leaves
 * them out, updates the organization the same way.
 */
export function newPreserveChildLinkStep(): PipelineStep<
  typeof OrganizationSchema
> {
  return {
    name: "PreserveChildLink",
    execute(ctx: RequestContext<typeof OrganizationSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const spec = ctx.newState.spec;
      if (existing === undefined || spec === undefined) {
        throw internalError(
          new Error("organization update reached PreserveChildLink without its loaded row or spec"),
          "failed to update organization",
        );
      }
      spec.parentOrg = existing.spec?.parentOrg ?? "";
      spec.externalId = existing.spec?.externalId ?? "";
    },
  };
}

// =============================================================================
// Delete
// =============================================================================

/**
 * RefuseDeletingParent — before the pre-delete slot: an organization that
 * still has children is not deleted. Its children are deleted first, each
 * by its parent's admins or its own owners.
 */
export function newRefuseDeletingParentStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "RefuseDeletingParent",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      if (id === "") {
        throw internalError(
          new Error("organization delete reached RefuseDeletingParent without its loaded row"),
          "failed to delete organization",
        );
      }
      let rows;
      try {
        rows = await store.queryResources(organizationListIndex, {
          anyKey: [{ name: "parent_org", value: id }],
          limit: 1,
        });
      } catch (error) {
        throw internalError(error, "failed to read the organization's child organizations");
      }
      if (rows.length === 0) {
        return;
      }
      throw failedPreconditionError(
        "this organization has child organizations: delete them first",
        { reason: ORGANIZATION_HAS_CHILDREN, metadata: { org: id } },
      );
    },
  };
}

/**
 * ReleaseExternalId — after the row: the deleted child's external id is
 * let go, so its parent may give the id to a new child. Best-effort, like
 * the slug's release: a fault is logged and the next claim frees it.
 */
export function newReleaseExternalIdStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "ReleaseExternalId",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      const parentId = organization === undefined ? "" : parentOrgOf(organization);
      if (id === "" || parentId === "" || (organization?.spec?.externalId ?? "") === "") {
        return;
      }
      try {
        await store.resourceNames.release(EXTERNAL_ID_NAME_KIND, parentId, id);
      } catch (error) {
        logger.error(
          "organization deleted but its external id could not be released; a later claim frees it",
          {
            org: id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}
