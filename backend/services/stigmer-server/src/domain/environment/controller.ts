/**
 * Environment controller: the kind's command and query sides. An
 * Environment is a named sandbox setup (its packages and its network
 * access) that a conversation, a routine, an agent's default or an
 * organization's default names, resolved per conversation by the session's
 * ResolveSessionEnvironment and honoured by the sandbox drivers
 * (sandbox/provisioner.ts EnvironmentFacts).
 *
 * The chains are the channel app's (an org-scoped kind with a claimed slug)
 * with a visibility block, as a skill's: create asks can_create_environment
 * of the organization (admins), and updateVisibility is the one door that
 * changes the stored level. Create and update then run the domain's steps
 * (steps.ts): NormalizeEnvironment, ValidateEnvironmentHosts and
 * RefuseUnservableEnvironment, so an Environment this server's sandboxes
 * cannot serve is refused when it is saved. Delete runs
 * GuardEnvironmentUnreferenced before the row goes. Not search-indexed: the
 * kind declares not_search_indexed, so no index steps appear in any chain.
 *
 * list narrows the organization's Environments through the composed list
 * read scope to the ones a `get` would return. Per-RPC posture:
 * docs/authorization-coverage.md.
 *
 * Proven by __tests__/environment.test.ts (composed-server round trips) and
 * environment.conformance.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import {
  EnvironmentListSchema,
  UpdateEnvironmentInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import type {
  EnvironmentId,
  EnvironmentList,
  ListEnvironmentsRequest,
  UpdateEnvironmentInput,
} from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvironmentStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/status_pb";
import type {
  ApiResourceReference,
  RenameInput,
  UpdateVisibilityInput,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import {
  newCleanupGrantsStep,
  newCreateAuthorizationTuplesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import {
  newBuildNewStateStep,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { matchesAllLabels, sortedLabels } from "../../pipeline/steps/helpers.js";
import {
  decodeOrSkip,
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
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
  newClaimNameStep,
  newReleaseNamesStep,
  releaseNameOnFailure,
} from "../../pipeline/steps/names.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { renameResource, storeRenameRows } from "../../pipeline/steps/rename.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { everyPathUpdate, updateContext } from "../../pipeline/steps/update-input.js";
import {
  newRefuseChildOrgsVisibilityInChildStep,
  newRefuseChildOrgsVisibilityInChildUpdateStep,
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { EnvironmentSupport } from "../../sandbox/provisioner.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { environmentListIndex } from "./list-index.js";
import {
  newGuardEnvironmentUnreferencedStep,
  newNormalizeEnvironmentStep,
  newRefuseUnservableEnvironmentStep,
  newValidateEnvironmentHostsStep,
} from "./steps.js";

export interface EnvironmentControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed credential binding: the persist and rename backstops refuse a credential that does not reach the row's organization. */
  readonly credentialBinding: CredentialBinding;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — list narrows through it; undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
  /** What this server's sandboxes can do with an Environment (domain/environment/facts.ts environmentSupportOf). */
  readonly environmentSupport: EnvironmentSupport;
}

/** Registers both environment services on the router (routes stage). */
export function registerEnvironmentServices(
  router: ConnectRouter,
  deps: EnvironmentControllerDeps,
): void {
  router.service(EnvironmentCommandController, {
    apply: (environment, ctx) => apply(deps, environment, ctx),
    create: (environment, ctx) => createEnvironment(deps, environment, ctx),
    update: (input, ctx) => update(deps, input, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    rename: (input, ctx) => rename(deps, input, ctx),
    delete: (input, ctx) => deleteEnvironment(deps, input, ctx),
  });
  router.service(EnvironmentQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    list: (req, ctx) => list(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/** The noun every not-found answer names. */
const ENVIRONMENT_NOUN = "environment";

/**
 * Create: the organization's admins (can_create_environment), the
 * visibility the kind supports, then the domain's normalize and its two
 * refusals before the slug is claimed, so a refused save leaves nothing.
 */
async function createEnvironment(
  deps: EnvironmentControllerDeps,
  environment: Environment,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentSchema,
    environment,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentSchema>("environment-create", deps.logger)
    .addStep(newAuthorizeStep(EnvironmentCommandController.method.create, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newRefuseChildOrgsVisibilityInChildStep(deps.store))
    // The slug first, so a refusal below names the Environment.
    .addStep(newResolveSlugStep())
    .addStep(newNormalizeEnvironmentStep())
    .addStep(newValidateEnvironmentHostsStep())
    .addStep(newRefuseUnservableEnvironmentStep(deps.environmentSupport))
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newClaimNameStep(deps.store, ApiResourceKind.environment))
    .addStep(newPersistStep(deps.store, deps.credentialBinding))
    .addStep(newCreateAuthorizationTuplesStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx)
    .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
  return reqCtx.newState;
}

/**
 * Update: the merged state is validated whole, then normalized and judged
 * as create judges it. A conversation using the Environment reads its new
 * packages at its sandbox's next start and its network at its next turn.
 */
async function update(
  deps: EnvironmentControllerDeps,
  input: UpdateEnvironmentInput,
  ctx: HandlerContext,
): Promise<Environment> {
  return runGuardedWrite(async () => {
    const reqCtx = updateContext(
      EnvironmentSchema,
      input,
      callerIdentityOf(ctx),
      kindOf(ctx),
    );
    await newPipeline<typeof EnvironmentSchema>("environment-update", deps.logger)
      .addStep(newAuthorizeStep(EnvironmentCommandController.method.update, deps.authorizer, input))
      .addStep(newResolveSlugStep({ update: true }))
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep())
      .addStep(newValidateProtoStep({ of: "state" }))
      .addStep(newNormalizeEnvironmentStep())
      .addStep(newValidateEnvironmentHostsStep())
      .addStep(newRefuseUnservableEnvironmentStep(deps.environmentSupport))
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newPersistStep(deps.store, deps.credentialBinding))
      .build()
      .execute(reqCtx);
    return reqCtx.newState;
  });
}

/** Rename — the only writer of an Environment's slug (pipeline/steps/rename.ts). */
async function rename(
  deps: EnvironmentControllerDeps,
  input: RenameInput,
  ctx: HandlerContext,
): Promise<Environment> {
  return renameResource(
    {
      method: EnvironmentCommandController.method.rename,
      names: deps.store,
      rows: storeRenameRows(deps.store, ApiResourceKind.environment, EnvironmentSchema),
      authorizer: deps.authorizer,
      credentialBinding: deps.credentialBinding,
      logger: deps.logger,
    },
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
}

/**
 * Apply — create-or-update: a probe pipeline decides existence, then
 * delegates to create or to update with every path, the resolved id
 * carried (the channel app's apply shape).
 */
async function apply(
  deps: EnvironmentControllerDeps,
  environment: Environment,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentSchema,
    environment,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentSchema>("environment-apply", deps.logger)
    .addStep(newAuthorizeStep(EnvironmentCommandController.method.apply, deps.authorizer))
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
    ? createEnvironment(deps, environment, ctx)
    : update(
        deps,
        everyPathUpdate(
          UpdateEnvironmentInputSchema,
          withResolvedApplyId(EnvironmentSchema, environment, reqCtx),
        ),
        ctx,
      );
}

/** Delete — refused while something names the Environment (steps.ts GuardEnvironmentUnreferenced). */
async function deleteEnvironment(
  deps: EnvironmentControllerDeps,
  input: EnvironmentId,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentCommandController.method.delete.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentCommandController.method.delete.input>(
    "environment-delete",
    deps.logger,
  )
    .addStep(newAuthorizeStep(EnvironmentCommandController.method.delete, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, EnvironmentSchema))
    .addStep(newGuardEnvironmentUnreferencedStep(deps.store))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.environment))
    .addStep(newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted Environment not found in context"),
      "deleted Environment not found in context",
    );
  }
  return deleted as Environment;
}

// ─── updateVisibility ────────────────────────────────────────────────────
// A targeted metadata update: only metadata.visibility changes. Load runs
// before level validation so NOT_FOUND wins.
// ─────────────────────────────────────────────────────────────────────────

const UPDATE_VISIBILITY_ENVIRONMENT_KEY = "updateVisibilityEnvironment";

type UpdateVisibilityDesc =
  typeof EnvironmentCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: EnvironmentControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>("environment-update-visibility", deps.logger)
    .addStep(newAuthorizeStep(EnvironmentCommandController.method.updateVisibility, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadEnvironmentForVisibilityUpdateStep(deps.store))
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_ENVIRONMENT_KEY))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newRefuseChildOrgsVisibilityInChildUpdateStep(deps.store, UPDATE_VISIBILITY_ENVIRONMENT_KEY))
    .addStep(newSetEnvironmentVisibilityStep())
    .addStep(newPersistEnvironmentVisibilityStep(deps.store))
    .addStep(newUpdateVisibilityTuplesStep(deps.authorizationLifecycle, UPDATE_VISIBILITY_ENVIRONMENT_KEY))
    .build()
    .execute(reqCtx);
  return reqCtx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
}

/** Loads the Environment by resource_id; a missing one answers NotFound, a store fault Internal. */
function newLoadEnvironmentForVisibilityUpdateStep(store: Store): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadEnvironmentForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      let environment: Environment;
      try {
        environment = await store.getResource(ctx.apiResourceKind, ctx.input.resourceId, EnvironmentSchema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(ENVIRONMENT_NOUN, ctx.input.resourceId);
        }
        throw internalError(error, "failed to load environment");
      }
      ctx.set(UPDATE_VISIBILITY_ENVIRONMENT_KEY, environment);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot. */
function newSetEnvironmentVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetEnvironmentVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const environment = ctx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
      if (environment.metadata !== undefined) {
        environment.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(EnvironmentSchema, environment, "status_audit", ctx.callerIdentity);
    },
  };
}

/**
 * The visibility and status audit the chain set on the loaded Environment,
 * applied to the live row inside the store's atomic write, so an update
 * that landed since the load stays.
 */
function newPersistEnvironmentVisibilityStep(store: Store): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistEnvironmentForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const environment = ctx.get(UPDATE_VISIBILITY_ENVIRONMENT_KEY) as Environment;
      const id = environment.metadata?.id ?? "";
      let written: Environment;
      try {
        written = await store.updateResource(ctx.apiResourceKind, id, EnvironmentSchema, (row) => {
          if (row.metadata !== undefined) {
            row.metadata.visibility = environment.metadata?.visibility ?? row.metadata.visibility;
          }
          const audit = ((row.status ??= create(EnvironmentStatusSchema)).audit ??= create(ApiResourceAuditSchema));
          audit.statusAudit = environment.status?.audit?.statusAudit;
        });
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(ENVIRONMENT_NOUN, id);
        }
        throw internalError(error, "failed to save environment");
      }
      ctx.set(UPDATE_VISIBILITY_ENVIRONMENT_KEY, written);
    },
  };
}

/** Get — LoadTarget by id. */
async function get(
  deps: EnvironmentControllerDeps,
  id: EnvironmentId,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentQueryController.method.get.input>("environment-get", deps.logger)
    .addStep(newAuthorizeStep(EnvironmentQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, EnvironmentSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Environment;
}

/** GetByReference — org/slug lookup, then the loaded Environment authorized exactly as `get` would. */
async function getByReference(
  deps: EnvironmentControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Environment> {
  const reqCtx = new RequestContext(
    EnvironmentQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentQueryController.method.getByReference.input>(
    "environment-get-by-reference",
    deps.logger,
  )
    .addStep(newAuthorizeStep(EnvironmentQueryController.method.getByReference, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, EnvironmentSchema))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(EnvironmentQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Environment;
}

const LIST_RESULT_KEY = "listResult";

/** List — the Environments of an organization the caller may view, newest first, one page at a time. */
async function list(
  deps: EnvironmentControllerDeps,
  req: ListEnvironmentsRequest,
  ctx: HandlerContext,
): Promise<EnvironmentList> {
  const reqCtx = new RequestContext(
    EnvironmentQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof EnvironmentQueryController.method.list.input>("environment-list", deps.logger)
    .addStep(newAuthorizeStep(EnvironmentQueryController.method.list, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newListStep(deps.store, deps.listReadScope, deps.logger))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("Environment list not found in context"),
      "Environment list not found in context",
    );
  }
  return result as EnvironmentList;
}

/** One page of the organization's Environments through the list index, narrowed to the caller's. */
function newListStep(
  store: Store,
  listReadScope: ListReadScope | undefined,
  logger: Logger,
): PipelineStep<typeof EnvironmentQueryController.method.list.input> {
  return {
    name: "ListByOrg",
    async execute(
      ctx: RequestContext<typeof EnvironmentQueryController.method.list.input>,
    ): Promise<void> {
      const org = ctx.input.org;
      const page = await readListPage({
        store,
        declaration: environmentListIndex,
        query: { org },
        request: {
          pageSize: ctx.input.pageSize,
          pageToken: ctx.input.pageToken,
        },
        fingerprint: listPageFingerprint({
          org,
          labels: sortedLabels(ctx.input.labels),
        }),
        decode: decodeOrSkip<Environment>(EnvironmentSchema, {
          logger,
          message: "Failed to unmarshal Environment, skipping",
        }),
        keep: (environment) =>
          (environment.metadata?.org ?? "") === org &&
          matchesAllLabels(environment.metadata?.labels ?? {}, ctx.input.labels),
        scope: (rows) =>
          restrictListByReadScope(
            listReadScope,
            ctx.callerIdentity,
            ApiResourceKind.environment,
            rows,
            "",
          ),
        failure: "failed to list Environments",
      });
      ctx.set(
        LIST_RESULT_KEY,
        create(EnvironmentListSchema, {
          entries: page.entries,
          nextPageToken: page.nextPageToken,
        }),
      );
    },
  };
}
