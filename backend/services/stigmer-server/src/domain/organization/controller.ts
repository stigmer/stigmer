/**
 * Organization controller — ports pkg/domain/organization (command +
 * query sides). Organization is the top-level tenancy container; all
 * resources scope under it.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character;
 * see the domain row in blueprint/01-domain-inventory.md. Proven by
 * organization.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/organization.test.ts.
 *
 * getByExternalOrgId is DELIBERATELY not implemented: it is the single
 * genuinely Unimplemented RPC across all registered domains (Go falls to
 * the embedded Unimplemented struct; here the method is simply absent from
 * the partial service implementation, and ConnectRPC answers Unimplemented)
 * — the SDK capability-probes this and must see UNIMPLEMENTED, not
 * NotFound (conformance pins it via externalOrgLookup=false).
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies, and
 * Publish steps (no multi-tenant auth, IAM/FGA, or event publishing here).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { fromBinary } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { FindApiResourcesRequest } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import {
  OrganizationListSchema,
  OrganizationsSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import type {
  OrganizationId,
  OrganizationList,
  Organizations,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResolvedGateSteps } from "../../extensions/gate-slots.js";
import { stepsForSlot } from "../../extensions/gate-slots.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
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
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import {
  newLoadTargetStep,
  TARGET_RESOURCE_KEY,
} from "../../pipeline/steps/load-target.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { organizationSearchExtractor } from "./search-extractor.js";
import { newCheckOrgDuplicateStep, newCopySlugToIdStep } from "./steps.js";

export interface OrganizationControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed slot registrations — this domain's post-persist slot (O4). */
  readonly gateSteps: ResolvedGateSteps;
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
    delete: (orgId, ctx) => deleteOrganization(deps, orgId, ctx),
  });
  // getByExternalOrgId deliberately absent → ConnectRPC answers
  // Unimplemented (the capability-probed pin; see the module header).
  router.service(OrganizationQueryController, {
    get: (orgId, ctx) => get(deps, orgId, ctx),
    find: (req, ctx) => find(deps, req, ctx),
    findMyOrganizations: () => findMyOrganizations(deps),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline: ResolveSlug runs before
 * ValidateProto so clients can omit the slug and have it derived before
 * field constraints (slug pattern, 2–15 chars) are checked.
 *
 * The post-persist gate slot splices after Persist, before IndexSearch —
 * the verified Java OrganizationCreateHandler ordering (FGA tuple
 * seeding, billing account getOrCreate: synchronous, a failure fails the
 * request). Java runs these with NO transactional envelope: a slot-step
 * failure leaves the org row persisted while the request fails, healed by
 * idempotent retry — inherited semantics (O4 verification V1).
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
    .addStep(newResolveSlugStep())
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newCheckOrgDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newCopySlugToIdStep())
    .addStep(newPersistStep(deps.store));
  // The ratified post-persist gate slot (blueprint 03 §3a; O4 — see the
  // doc comment above for the inherited failure semantics). Empty in OSS.
  for (const step of stepsForSlot<typeof OrganizationSchema>(
    deps.gateSteps,
    "org-create:post-persist",
  )) {
    builder.addStep(step);
  }
  await builder
    .addStep(
      newIndexSearchStep(deps.store, organizationSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
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
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(deps.store, organizationSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style idempotent create-or-update: a minimal pipeline
 * decides existence, then delegates to Create or Update with the ORIGINAL
 * request message (Go delegates `org`, not the pipeline's mutated clone).
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
    .addStep(newLoadForApplyStep(deps.store))
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
    : update(deps, org, ctx);
}

/** Delete — returns the deleted organization (gRPC audit-trail convention). */
async function deleteOrganization(
  deps: OrganizationControllerDeps,
  orgId: OrganizationId,
  ctx: HandlerContext,
): Promise<Organization> {
  const reqCtx = new RequestContext(
    OrganizationCommandController.method.delete.input,
    orgId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof OrganizationCommandController.method.delete.input>(
    "organization-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        OrganizationCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, OrganizationSchema))
    .addStep(newDeleteResourceStep(deps.store))
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
 * org. Single-tenant OSS enumerates freely; cloud gates this behind
 * admin access (the organizationEnumeration capability fork).
 */
async function find(
  deps: OrganizationControllerDeps,
  req: FindApiResourcesRequest,
  ctx: HandlerContext,
): Promise<OrganizationList> {
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
 * filtering — ALL organizations are "mine". Cloud filters by the caller's
 * IAM policies instead (the multiTenant capability fork).
 */
async function findMyOrganizations(
  deps: OrganizationControllerDeps,
): Promise<Organizations> {
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
