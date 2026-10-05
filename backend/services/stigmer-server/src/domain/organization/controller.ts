/**
 * Organization controller — ports pkg/domain/organization (command +
 * query sides). Organization is the top-level tenancy container; all
 * resources scope under it.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by organization.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/organization.test.ts.
 *
 * Parent and child organizations are this domain's own (children.ts): the
 * create validates and claims a child's parent and external id and writes
 * no owner for it, the update keeps both, the delete refuses a parent
 * that still has children, and getByExternalId and listChildOrgs are
 * ordinary annotated lanes on the parent (`can_manage_child_orgs`). The
 * composed OrganizationDirectory carries the two edition forks: find's
 * enumeration posture and findMyOrganizations' filtering (see
 * organization-directory.ts).
 *
 * Every chain opens with Authorize; create and delete run the shared
 * tuple-lifecycle steps (CreateAuthorizationTuples, CleanupIamPolicies)
 * against the lifecycle compose.ts hands it: a composed
 * resourceAuthorizationLifecycle driver when a unit registers one, else,
 * under the built-in posture, open source's role lifecycle (the creator's
 * `owner` row), and under trusted-local none, where the steps no-op.
 * Per-RPC posture: docs/authorization-coverage.md §2.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { fromBinary } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  FindApiResourcesRequest,
  RenameInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import {
  ChildOrgListSchema,
  OrganizationListSchema,
  OrganizationsSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import type {
  ChildOrgList,
  ListChildOrgsInput,
  OrganizationExternalLookup,
  OrganizationId,
  OrganizationList,
  Organizations,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import { ALL_ORGANIZATIONS } from "../../extensions/organization-directory.js";
import type { OrganizationDirectory } from "../../extensions/organization-directory.js";
import type { IamPolicyGrantPath } from "../iampolicy/grant-path.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  withResolvedApplyId,
} from "../../pipeline/steps/load-for-apply.js";
import {
  newLoadTargetStep,
  TARGET_RESOURCE_KEY,
} from "../../pipeline/steps/load-target.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { readListPage } from "../../pipeline/steps/list-page.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  childOwnerAttribution,
  decodeOrganization,
  getChildByExternalId,
  newClaimExternalIdStep,
  newLinkChildOrganizationStep,
  newPreserveChildLinkStep,
  newRefuseDeletingParentStep,
  newReleaseExternalIdStep,
  newValidateChildOrganizationStep,
  parentOrgOf,
  releaseExternalIdClaimAfterFailure,
} from "./children.js";
import { organizationListIndex } from "./list-index.js";
import {
  newOrganizationLimitStep,
  newRefuseDeletingSingleOrganizationStep,
} from "./limit.js";
import { organizationSearchExtractor } from "./search-extractor.js";
import {
  newClaimOrganizationSlugStep,
  newOrganizationNameResolver,
  newRetireOrganizationSlugStep,
  newSettleOrganizationSlugStep,
  releaseSlugClaimAfterFailure,
} from "./names.js";
import {
  RENAMED_ORGANIZATION_KEY,
  newIndexOrganizationAfterRenameStep,
  newLoadOrganizationForRenameStep,
  newPersistRenamedOrganizationStep,
  newRenameOrganizationSlugStep,
} from "./rename.js";
import {
  newCheckOrgDuplicateStep,
  newLoadExistingOrganizationStep,
  newLoadOrganizationForApplyStep,
  newRefuseBoundCredentialStep,
  newRefuseOrganizationOrgStep,
  newRevokeOrganizationPoliciesStep,
} from "./steps.js";

export interface OrganizationControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed slot registrations — this domain's create and delete slots. */
  readonly gateSteps: ResolvedGateSteps;
  /** The one grant path: the delete revokes the organization's rows through it before its row goes. */
  readonly grantPath: IamPolicyGrantPath;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed query directory — undefined = OSS single-tenant behavior. */
  readonly organizationDirectory: OrganizationDirectory | undefined;
  /**
   * The composition's declared organization limit (ServerExtension.orgLimit),
   * or undefined for any number. Set, the create chain counts against it;
   * at 1, the delete chain also refuses to delete the one (limit.ts).
   */
  readonly orgLimit: number | undefined;
}

/** Registers both organization services on the router (routes stage). */
export function registerOrganizationServices(
  router: ConnectRouter,
  deps: OrganizationControllerDeps,
): void {
  router.service(OrganizationCommandController, {
    apply: (org, ctx) => apply(deps, org, ctx),
    create: (org, ctx) => createOrganization(deps, org, ctx),
    update: (org, ctx) => update(deps, org, ctx),
    rename: (input, ctx) => rename(deps, input, ctx),
    delete: (orgId, ctx) => deleteOrganization(deps, orgId, ctx),
  });
  router.service(OrganizationQueryController, {
    get: (orgId, ctx) => get(deps, orgId, ctx),
    find: (req, ctx) => find(deps, req, ctx),
    findMyOrganizations: (_, ctx) => findMyOrganizations(deps, ctx),
    getByExternalId: (lookup, ctx) => getByExternalId(deps, lookup, ctx),
    listChildOrgs: (input, ctx) => listChildOrgs(deps, input, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline: ResolveSlug runs before
 * ValidateProto so clients can omit the slug and have it derived before
 * the slug pattern is checked. BuildNewState mints the organization's id
 * (org_<ulid>), which every resource it owns will name; an organization
 * names no organization of its own (RefuseOrganizationOrg).
 *
 * The pre-side-effect gate slot splices before Persist, after the last pure
 * step, the session chain's position: every step above it only reads, so a
 * refusal there leaves no organization behind. It is where a unit refuses
 * an organization it does not admit. Two of the chain's own rules run at
 * the same seat, just before the slot: ValidateChildOrganization, for a
 * create that names a parent (children.ts), and the composition's
 * organization count, OrganizationLimit (limit.ts).
 *
 * ClaimOrganizationSlug follows the slot, immediately before Persist: the
 * slug is claimed in the name table atomically for the minted id, so of two
 * concurrent creates of one slug exactly one proceeds (names.ts). A child's
 * external id is claimed the same way, right after (ClaimExternalId). When
 * the chain fails after a claim and the organization was never stored, the
 * claims are released so a retry can take them.
 *
 * A child has no creator owner: the creation event carries NONE
 * (childOwnerAttribution), and LinkChildOrganization then hands an
 * edition that stores tuples the parent and child edges.
 *
 * The post-persist gate slot splices after Persist, before IndexSearch —
 * the verified Java OrganizationCreateHandler ordering (FGA tuple
 * seeding, billing account getOrCreate: synchronous, a failure fails the
 * request). Java runs these with NO transactional envelope: a slot-step
 * failure leaves the org row persisted while the request fails, healed by
 * idempotent retry — inherited semantics.
 */
async function createOrganization(
  deps: OrganizationControllerDeps,
  org: Organization,
  ctx: HandlerContext,
): Promise<Organization> {
  const reqCtx = new RequestContext(
    OrganizationSchema,
    org,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  const builder = newPipeline<typeof OrganizationSchema>(
    "organization-create",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        OrganizationCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newRefuseBoundCredentialStep())
    .addStep(newResolveSlugStep())
    .addStep(newValidateProtoStep())
    .addStep(newRefuseOrganizationOrgStep(newOrganizationNameResolver(deps.store)))
    .addStep(newValidateVisibilityStep())
    .addStep(newCheckOrgDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newValidateChildOrganizationStep(deps.store, deps.authorizer));
  // The composition's organization count, at the slot's seat and before its
  // steps: the chain's own rule, not a unit's (limit.ts).
  if (deps.orgLimit !== undefined) {
    builder.addStep(
      newOrganizationLimitStep<typeof OrganizationSchema>(
        deps.store,
        deps.orgLimit,
      ),
    );
  }
  // The pre-side-effect gate slot (see the doc comment above). No unit
  // fills it in OSS.
  for (const step of stepsForSlot<typeof OrganizationSchema>(
    deps.gateSteps,
    "org-create:pre-side-effect-gate",
  )) {
    builder.addStep(step);
  }
  builder
    .addStep(newClaimOrganizationSlugStep(deps.store))
    .addStep(newClaimExternalIdStep(deps.store))
    .addStep(newPersistStep(deps.store))
    // The tuple steps run BEFORE the post-persist slot, so a unit's
    // post-persist work (a billing account) meets the organization's
    // authorization in place. No-ops with no driver composed.
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
        childOwnerAttribution,
      ),
    )
    .addStep(newLinkChildOrganizationStep(deps.authorizationLifecycle));
  // The post-persist gate slot (see the doc comment above for the
  // inherited failure semantics). Empty in OSS.
  for (const step of stepsForSlot<typeof OrganizationSchema>(
    deps.gateSteps,
    "org-create:post-persist",
  )) {
    builder.addStep(step);
  }
  const pipeline = builder
    .addStep(
      newIndexSearchStep(deps.store, organizationSearchExtractor, deps.logger),
    )
    .build();
  try {
    await pipeline.execute(reqCtx);
  } catch (error) {
    await releaseSlugClaimAfterFailure(deps.store, deps.logger, reqCtx);
    await releaseExternalIdClaimAfterFailure(deps.store, deps.logger, reqCtx);
    throw error;
  }
  return reqCtx.newState;
}

/** Update — chain per Go buildUpdatePipeline. */
async function update(
  deps: OrganizationControllerDeps,
  org: Organization,
  ctx: HandlerContext,
): Promise<Organization> {
  const reqCtx = new RequestContext(
    OrganizationSchema,
    org,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof OrganizationSchema>(
    "organization-update",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        OrganizationCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingOrganizationStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newPreserveChildLinkStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newPersistStep(deps.store))
    .addStep(newSettleOrganizationSlugStep(deps.store, deps.logger))
    .addStep(
      newIndexSearchStep(deps.store, organizationSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Rename — the only writer of an organization's slug (rename.ts): the
 * names move, then the row; the old slug keeps leading to the organization
 * for a while. Returns the renamed organization.
 */
async function rename(
  deps: OrganizationControllerDeps,
  input: RenameInput,
  ctx: HandlerContext,
): Promise<Organization> {
  type RenameDesc = typeof OrganizationCommandController.method.rename.input;
  const reqCtx = new RequestContext(
    OrganizationCommandController.method.rename.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<RenameDesc>("organization-rename", deps.logger)
    .addStep(
      newAuthorizeStep(
        OrganizationCommandController.method.rename,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadOrganizationForRenameStep(deps.store))
    .addStep(newRenameOrganizationSlugStep(deps.store))
    .addStep(newPersistRenamedOrganizationStep(deps.store, deps.logger))
    .addStep(newIndexOrganizationAfterRenameStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(RENAMED_ORGANIZATION_KEY) as Organization;
}

/**
 * Apply — kubectl-style idempotent create-or-update: a minimal pipeline
 * decides existence, then delegates to Create or Update with the ORIGINAL
 * request message (Go delegates `org`, not the pipeline's mutated clone);
 * the update arm carries the resolved id via withResolvedApplyId.
 */
async function apply(
  deps: OrganizationControllerDeps,
  org: Organization,
  ctx: HandlerContext,
): Promise<Organization> {
  const reqCtx = new RequestContext(
    OrganizationSchema,
    org,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof OrganizationSchema>(
    "organization-apply",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        OrganizationCommandController.method.apply,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newRefuseOrganizationOrgStep(newOrganizationNameResolver(deps.store)))
    .addStep(newLoadOrganizationForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  return shouldCreate
    ? createOrganization(deps, org, ctx)
    : update(deps, withResolvedApplyId(OrganizationSchema, org, reqCtx), ctx);
}

/**
 * Delete — returns the deleted organization (gRPC audit-trail convention).
 *
 * Whatever outlives the row names the organization's id, which no later
 * organization can carry, so its slug is released once the row is gone and
 * a later organization of that slug sees nothing of this one. Everything
 * that grants on the organization still goes before its row, and a fault
 * stops the delete with the organization intact, so nothing it granted
 * outlives it. After the load:
 *
 *   0. under a declared limit of 1, RefuseDeletingSingleOrganization: the
 *      store's only organization is never deleted, refused before any
 *      write (limit.ts); and RefuseDeletingParent: an organization that
 *      still has children is not deleted (children.ts);
 *   1. the `org-delete:pre-delete` slot, where an edition refuses or
 *      removes the rows it keeps for the organization (empty in OSS);
 *   2. RevokeOrganizationPolicies, every policy row naming the
 *      organization, through the grant path, never caught;
 *   3. the row;
 *   4. RetireOrganizationSlug, every name the organization held released,
 *      best-effort (names.ts says why after the row), and a child's
 *      external id with them (ReleaseExternalId);
 *   5. CleanupIamPolicies, the lifecycle's post-delete event: best-effort
 *      like every delete chain's, it revokes whatever a concurrent write
 *      named the organization with after step 2, and runs a composed
 *      driver's post-delete companions;
 *   6. the search entry.
 */
async function deleteOrganization(
  deps: OrganizationControllerDeps,
  orgId: OrganizationId,
  ctx: HandlerContext,
): Promise<Organization> {
  type DeleteInput = typeof OrganizationCommandController.method.delete.input;
  const reqCtx = new RequestContext(
    OrganizationCommandController.method.delete.input,
    orgId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  const builder = newPipeline<DeleteInput>("organization-delete", deps.logger)
    .addStep(
      newAuthorizeStep(
        OrganizationCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, OrganizationSchema));
  // A server that holds one organization never deletes it, refused before
  // the first write; a store holding several deletes down to one (limit.ts).
  if (deps.orgLimit === 1) {
    builder.addStep(
      newRefuseDeletingSingleOrganizationStep<DeleteInput>(deps.store),
    );
  }
  builder.addStep(newRefuseDeletingParentStep<DeleteInput>(deps.store));
  // The pre-delete gate slot (see the doc comment above). No unit fills it
  // in OSS.
  for (const step of stepsForSlot<DeleteInput>(
    deps.gateSteps,
    "org-delete:pre-delete",
  )) {
    builder.addStep(step);
  }
  await builder
    .addStep(newRevokeOrganizationPoliciesStep<DeleteInput>(deps.grantPath))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newRetireOrganizationSlugStep<DeleteInput>(deps.store, deps.logger),
    )
    .addStep(newReleaseExternalIdStep<DeleteInput>(deps.store, deps.logger))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted organization not found in context"),
      "delete operation lost its loaded resource",
    );
  }
  return deleted as Organization;
}

/** Get — LoadTarget by id; NotFound when absent. */
async function get(
  deps: OrganizationControllerDeps,
  orgId: OrganizationId,
  ctx: HandlerContext,
): Promise<Organization> {
  const reqCtx = new RequestContext(
    OrganizationQueryController.method.get.input,
    orgId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof OrganizationQueryController.method.get.input>(
    "organization-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(OrganizationQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, OrganizationSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Organization;
}

const FIND_RESULT_KEY = "findResult";

/**
 * Find — enumerates ALL organizations with manual pagination (page size
 * default 20, cap 100). The request's org field is accepted but IGNORED
 * for filtering: organizations are the top-level scope and belong to no
 * org. Single-tenant OSS enumerates freely; a composed directory with
 * refusesEnumeration answers UNIMPLEMENTED before any work — the
 * organizationEnumeration capability fork, byte-matching the
 * absent-method semantics the cloud edition pins.
 */
async function find(
  deps: OrganizationControllerDeps,
  req: FindApiResourcesRequest,
  ctx: HandlerContext,
): Promise<OrganizationList> {
  if (deps.organizationDirectory?.refusesEnumeration === true) {
    throw new ConnectError(
      "ai.stigmer.tenancy.organization.v1.OrganizationQueryController.find is not implemented",
      Code.Unimplemented,
    );
  }
  const reqCtx = new RequestContext(
    OrganizationQueryController.method.find.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof OrganizationQueryController.method.find.input>(
    "organization-find",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        OrganizationQueryController.method.find,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListAllOrganizationsStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(FIND_RESULT_KEY) as OrganizationList;
}

/**
 * ListAllOrganizations — the domain-local find step (Go
 * listAllOrganizationsStep): full list, malformed rows skipped, then
 * legacy pageSize/pageNumber fields overridden by the newer page message
 * when present, defaults 20/1, cap 100.
 */
function newListAllOrganizationsStep(
  store: Store,
): PipelineStep<typeof OrganizationQueryController.method.find.input> {
  return {
    name: "ListAllOrganizations",
    async execute(
      ctx: RequestContext<typeof OrganizationQueryController.method.find.input>,
    ): Promise<void> {
      let data: Uint8Array[];
      try {
        data = await store.listResources(ctx.apiResourceKind);
      } catch (error) {
        throw internalError(error, "failed to list organizations");
      }

      const orgs: Organization[] = [];
      for (const bytes of data) {
        try {
          orgs.push(fromBinary(OrganizationSchema, bytes));
        } catch {
          continue; // skip malformed rows, as Go does
        }
      }

      const req = ctx.input;
      let pageSize = req.pageSize;
      let pageNumber = req.pageNumber;
      if (req.page !== undefined) {
        if (req.page.size > 0) {
          pageSize = req.page.size;
        }
        if (req.page.num > 0) {
          pageNumber = req.page.num;
        }
      }
      if (pageSize <= 0) {
        pageSize = 20;
      }
      if (pageSize > 100) {
        pageSize = 100;
      }
      if (pageNumber <= 0) {
        pageNumber = 1;
      }

      const totalPages = Math.ceil(orgs.length / pageSize);
      const start = (pageNumber - 1) * pageSize;
      const entries =
        start >= orgs.length ? [] : orgs.slice(start, start + pageSize);

      ctx.set(
        FIND_RESULT_KEY,
        create(OrganizationListSchema, { totalPages, entries }),
      );
    },
  };
}

/**
 * FindMyOrganizations — deliberately pipeline-less (Go): the input is
 * Empty, there is nothing to validate, and single-user OSS applies no IAM
 * filtering — ALL organizations are "mine". A composed directory filters
 * to the caller's authorized set instead (the multiTenant capability
 * fork): the directory answers ids, the controller loads
 * them, and ids whose rows are gone are skipped (grants can outlive
 * rows).
 */
async function findMyOrganizations(
  deps: OrganizationControllerDeps,
  ctx: HandlerContext,
): Promise<Organizations> {
  const directory = deps.organizationDirectory;
  if (directory !== undefined) {
    const authorized = await directory.listMyOrganizationIds(
      callerIdentityOf(ctx),
    );
    if (authorized !== ALL_ORGANIZATIONS) {
      const entries: Organization[] = [];
      for (const id of authorized) {
        try {
          entries.push(
            await deps.store.getResource(
              ApiResourceKind.organization,
              id,
              OrganizationSchema,
            ),
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            continue;
          }
          throw internalError(error, "failed to list organizations");
        }
      }
      return create(OrganizationsSchema, { entries });
    }
  }
  let data: Uint8Array[];
  try {
    data = await deps.store.listResources(ApiResourceKind.organization);
  } catch (error) {
    throw internalError(error, "failed to list organizations");
  }
  const entries: Organization[] = [];
  for (const bytes of data) {
    try {
      entries.push(fromBinary(OrganizationSchema, bytes));
    } catch {
      continue;
    }
  }
  return create(OrganizationsSchema, { entries });
}

/**
 * GetByExternalId — an ordinary annotated lane: Authorize asks
 * `can_manage_child_orgs` on `parent_org` (the edge resolver has turned a
 * slug into its id), then the name table answers the child that holds
 * the external id among that parent's children. Every miss (no claim, a
 * claim whose child is gone or never stored) is the same NotFound.
 */
async function getByExternalId(
  deps: OrganizationControllerDeps,
  input: OrganizationExternalLookup,
  ctx: HandlerContext,
): Promise<Organization> {
  type LookupDesc =
    typeof OrganizationQueryController.method.getByExternalId.input;
  const reqCtx = new RequestContext(
    OrganizationQueryController.method.getByExternalId.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<LookupDesc>("organization-get-by-external-id", deps.logger)
    .addStep(
      newAuthorizeStep(
        OrganizationQueryController.method.getByExternalId,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  return getChildByExternalId(deps.store, input.parentOrg, input.externalId);
}

/**
 * ListChildOrgs — Authorize asks `can_manage_child_orgs` on `org`, then
 * the organization list index pages the parent's children newest first
 * (pipeline/steps/list-page.ts). No per-row read scope runs: the parent's
 * managers manage every child, and hold no `can_view` on any of them, so
 * the scope would hide them all.
 */
async function listChildOrgs(
  deps: OrganizationControllerDeps,
  input: ListChildOrgsInput,
  ctx: HandlerContext,
): Promise<ChildOrgList> {
  type ListDesc =
    typeof OrganizationQueryController.method.listChildOrgs.input;
  const reqCtx = new RequestContext(
    OrganizationQueryController.method.listChildOrgs.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListDesc>("organization-list-child-orgs", deps.logger)
    .addStep(
      newAuthorizeStep(
        OrganizationQueryController.method.listChildOrgs,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  const page = await readListPage({
    store: deps.store,
    declaration: organizationListIndex,
    query: { anyKey: [{ name: "parent_org", value: input.org }] },
    request: { pageSize: input.pageSize, pageToken: input.pageToken },
    fingerprint: input.org,
    decode: decodeOrganization,
    keep: (child) => parentOrgOf(child) === input.org,
    scope: (rows) => Promise.resolve(rows),
    failure: "failed to list child organizations",
  });
  return create(ChildOrgListSchema, {
    entries: page.entries,
    nextPageToken: page.nextPageToken,
  });
}
