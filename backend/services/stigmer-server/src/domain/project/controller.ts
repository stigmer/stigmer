/**
 * Project controller — ports pkg/domain/project/controller (command + query
 * sides). Project is the aggregate root grouping related resources: its spec
 * carries lightweight ApiResourceReference members the CLI derives from
 * individual apply responses (never user-authored); apply reconciles the
 * membership and prunes orphans through the four downstream domains'
 * in-process clients — the widest client fan-out of any CRUD domain, which
 * is why it ported last of Class A (D4 #16).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character; the
 * create/update ASYMMETRY is contract: create runs ValidateVisibility and
 * NormalizeReferences, update runs neither (an updated members list persists
 * without reference normalization — Go update.go). No chain runs
 * ValidateReferences: members referencing nonexistent resources persist
 * silently. Delete removes ONLY the project — members are never cascaded.
 *
 * Proven by project.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/{reconcile,project.composed}.test.ts (the conformance suite
 * never touches spec.members or last_reconciliation; the composed tests own
 * those pins).
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies,
 * Publish, and TransformResponse steps (no multi-tenant auth, IAM/FGA, or
 * event publishing here).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import type { Project } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import { ProjectCommandController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/command_pb";
import type { ProjectId } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/io_pb";
import { ProjectQueryController } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/query_pb";
import { ProjectStatusSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/status_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
  withResolvedApplyId,
} from "../../pipeline/steps/load-for-apply.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import {
  DEFAULT_RECONCILIATION_OPTIONS,
  newReconciliationService,
  toProtoSummary,
} from "./reconcile.js";
import type { OrphanDeleter, ReconciliationService } from "./reconcile.js";
import { projectSearchExtractor } from "./search-extractor.js";

export interface ProjectControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /**
   * The four downstream delete edges (agent/workflow/mcp_server/skill),
   * lazy per the compose root's boot-ordering idiom — the TS replacement
   * for Go's SetReconciliationService late-bind (server.go:635-648).
   */
  readonly orphanDeleter: () => OrphanDeleter;
}

/** Registers both project services on the router (routes stage). */
export function registerProjectServices(
  router: ConnectRouter,
  deps: ProjectControllerDeps,
): void {
  const reconciliation = newReconciliationService({
    store: deps.store,
    orphanDeleter: deps.orphanDeleter,
    logger: deps.logger,
  });
  router.service(ProjectCommandController, {
    apply: (project, ctx) => apply(deps, reconciliation, project, ctx),
    create: (project, ctx) => createProject(deps, project, ctx),
    update: (project, ctx) => update(deps, project, ctx),
    delete: (projectId, ctx) => deleteProject(deps, projectId, ctx),
  });
  router.service(ProjectQueryController, {
    get: (projectId, ctx) => get(deps, projectId, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/** Create — chain per Go buildCreatePipeline (create.go:54-63). */
async function createProject(
  deps: ProjectControllerDeps,
  project: Project,
  ctx: HandlerContext,
): Promise<Project> {
  const reqCtx = new RequestContext(
    ProjectSchema,
    project,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ProjectSchema>("project-create", deps.logger)
    .addStep(
      newAuthorizeStep(ProjectCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(
      newIndexSearchStep(deps.store, projectSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline (update.go:55-62). Deliberately
 * narrower than create (no ValidateVisibility, no NormalizeReferences —
 * the asymmetry is contract; see the module header).
 */
async function update(
  deps: ProjectControllerDeps,
  project: Project,
  ctx: HandlerContext,
): Promise<Project> {
  const reqCtx = new RequestContext(
    ProjectSchema,
    project,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ProjectSchema>("project-update", deps.logger)
    .addStep(
      newAuthorizeStep(ProjectCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(deps.store, projectSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — declarative create-or-update PLUS membership reconciliation
 * (apply.go:29-85): a minimal pipeline decides existence, the previous
 * members are captured BEFORE delegation overwrites them, the full Create
 * or Update handler runs, then the reconciler diffs previous vs persisted
 * members and prunes orphans.
 *
 * Two ported postures:
 *   - A reconcile failure is logged and SWALLOWED — apply still succeeds,
 *     returning the persisted project without a summary (apply.go:77-82;
 *     defensive in both editions — the reconciler never throws).
 *   - On success the summary is set UNCONDITIONALLY, so every successful
 *     apply response carries status.last_reconciliation, even as an empty
 *     message. Response-only — never persisted.
 */
async function apply(
  deps: ProjectControllerDeps,
  reconciliation: ReconciliationService,
  project: Project,
  ctx: HandlerContext,
): Promise<Project> {
  const reqCtx = new RequestContext(
    ProjectSchema,
    project,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ProjectSchema>("project-apply", deps.logger)
    .addStep(
      newAuthorizeStep(ProjectCommandController.method.apply, deps.authorizer),
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

  // Captured before Create/Update runs; on first apply (create) there are
  // no previous members (Go apply.go:45-50).
  const previousMembers: ReadonlyArray<ApiResourceReference> = shouldCreate
    ? []
    : ((reqCtx.get(EXISTING_RESOURCE_KEY) as Project | undefined)?.spec
        ?.members ?? []);

  const persisted = shouldCreate
    ? await createProject(deps, project, ctx)
    : await update(
        deps,
        withResolvedApplyId(ProjectSchema, project, reqCtx),
        ctx,
      );

  const currentMembers = persisted.spec?.members ?? [];

  try {
    const result = await reconciliation.reconcile(
      previousMembers,
      currentMembers,
      DEFAULT_RECONCILIATION_OPTIONS,
    );
    persisted.status ??= create(ProjectStatusSchema);
    persisted.status.lastReconciliation = toProtoSummary(result);
  } catch (error) {
    deps.logger.error("Reconciliation failed", {
      projectId: persisted.metadata?.id ?? "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return persisted;
}

/**
 * Delete — returns the pre-delete resource (delete.go). Deletes ONLY the
 * project entity: member resources are never cascaded.
 */
async function deleteProject(
  deps: ProjectControllerDeps,
  projectId: ProjectId,
  ctx: HandlerContext,
): Promise<Project> {
  const reqCtx = new RequestContext(
    ProjectCommandController.method.delete.input,
    projectId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ProjectCommandController.method.delete.input>(
    "project-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ProjectCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ProjectSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    // Go puts this text ON THE WIRE (delete.go:43, InternalError(nil, …));
    // the arm is unreachable in practice but the copy is byte-pinned.
    throw internalError(
      new Error("delete pipeline completed without a loaded resource"),
      "deleted project not found in context",
    );
  }
  return deleted as Project;
}

/** Get — LoadTarget by id; NotFound when absent (get.go). */
async function get(
  deps: ProjectControllerDeps,
  projectId: ProjectId,
  ctx: HandlerContext,
): Promise<Project> {
  const reqCtx = new RequestContext(
    ProjectQueryController.method.get.input,
    projectId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ProjectQueryController.method.get.input>(
    "project-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ProjectQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, ProjectSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Project;
}

/**
 * GetByReference — slug lookup within an org (get_by_reference.go). Project
 * is org-scoped, so an empty-org reference is rejected InvalidArgument by
 * the shared step's kind_meta scope check — a bare slug is under-specified,
 * never a global search (the conformance suite pins this; Go's file-level
 * doc comment claiming a platform-scoped fallback is stale).
 */
async function getByReference(
  deps: ProjectControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Project> {
  const reqCtx = new RequestContext(
    ProjectQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ProjectQueryController.method.getByReference.input>(
    "project-get-by-reference",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        ProjectQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, ProjectSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Project;
}
