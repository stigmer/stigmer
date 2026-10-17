/**
 * Routine controller (command + query sides): a saved agent invocation,
 * run on its optional schedule or fired by its owner and Participants.
 *
 * A routine declares the agent and message each run starts from, an
 * optional cron with the routine's IANA time zone, and the owner's
 * enablement switch. Every run acts as the routine's owner (owner.ts).
 * Everything the platform observes about firing (next fire time, failure
 * streak, platform pause) lives in status, written only by the scheduling
 * runtime and by the explicit resume command — a declarative apply
 * preserves status verbatim, so a routine manifest apply can never reset a
 * failure streak or un-pause a platform-paused routine.
 *
 * Vocabulary: "disabled" is the owner's switch (spec.enabled = false);
 * "paused" is the platform's failure-streak latch (status.paused_reason).
 * Two words, two levers, two writers.
 *
 * The clock (per-resource Temporal Schedules) and the run starter arrive
 * through PROVIDERS wired by the compose root after the Temporal stage;
 * both may stay undefined forever when Temporal was never configured —
 * every consumer degrades instead of refusing, because a declarative
 * resource must be writable offline. A routine with no cron needs no clock
 * at all: it is created, updated and fired with the engine away.
 *
 * Authorization rides the composed Authorizer at position 1 of every
 * chain, from the contract's annotations (can_fire for fire); the owner's
 * lock (owners-lock.ts) adds the one rule the model cannot state.
 *
 * Proven by routine.conformance.test.ts (local), the firing suite
 * (local-execution), and __tests__/routine.composed.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineListSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type {
  FireRoutineInput,
  ListRoutineFiresRequest,
  ListRoutinesByAgentRequest,
  ListRoutinesRequest,
  RoutineId,
  RoutineList,
  RoutineFireList,
  RoutineFireResult,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type {
  ApiResourceReference,
  RenameInput,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { UpdateRoutineInput } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { UpdateRoutineInputSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { renameResource, storeRenameRows } from "../../pipeline/steps/rename.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  matchesAllLabels,
  sortedLabels,
} from "../../pipeline/steps/helpers.js";
import {
  decodeOrSkip,
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
import type { ListPageRequest } from "../../pipeline/steps/list-page.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  newLoadTargetStep,
  TARGET_RESOURCE_KEY,
} from "../../pipeline/steps/load-target.js";
import {
  newCleanupGrantsStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newClaimNameStep, newReleaseNamesStep, releaseNameOnFailure } from "../../pipeline/steps/names.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { everyPathUpdate, updateContext } from "../../pipeline/steps/update-input.js";
import {
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../../pipeline/steps/references.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexQuery } from "../../store/list-index.js";
import { routineListIndex } from "./list-index.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import {
  newArmResumedRoutineStep,
  newArmRoutineStep,
  newDeleteRoutineFiresStep,
  newTeardownRoutineArtifactStep,
  type ClockProvider,
} from "./clock.js";
import {
  LIST_FIRES_RESULT_KEY,
  newListFiresFromLedgerStep,
  newLoadRoutineForFiresStep,
} from "./list-fires.js";
import { newPersistRoutineUpdateStep } from "./persist-update.js";
import { newClearRoutinePauseStep } from "./resume.js";
import {
  newResolveRoutineDefaultsStep,
  newValidateRoutineUpdateStep,
  resolveRoutineCreateTargets,
} from "./steps.js";
import { newEnsureRoutineAgentStillExistsStep } from "./cascade.js";
import {
  FIRE_RESULT_KEY,
  newExtractFireRoutineIdStep,
  newFireDirectRunStep,
  newValidateFireableStep,
  type RunnerProvider,
} from "./fire.js";
import { newOwnersLockStep } from "./owners-lock.js";
import { newVaultAttachmentsStep } from "../vault/attachments.js";
import { ROUTINE_VAULT_ATTACHMENTS } from "./vault-attachments.js";

export interface RoutineControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /**
   * The composed credential binding: the persist and rename backstops
   * refuse a credential that does not reach the row's organization
   * (pipeline/steps/refuse-bound-elsewhere.ts).
   */
  readonly credentialBinding: CredentialBinding;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly modelRegistry: ModelCatalogProvider;
  /**
   * The scheduling runtime (clock.ts), resolved at call time so the
   * compose root can wire it after the Temporal stage — Go's SetClock,
   * without the mutable-controller seam.
   */
  readonly clock: ClockProvider;
  /**
   * The run starter (fire.ts), resolved at call time. The fire command is
   * its one consumer here: a fire needs no Temporal artifact, so it works
   * even while Temporal is away.
   */
  readonly runner: RunnerProvider;
  /**
   * The account port the owner's lock resolves a routine's owner through,
   * or undefined where the composition signs nobody in (the trusted-local
   * laptop's one person changes what their routines run).
   */
  readonly ownerAccounts: AccountsByCaller | undefined;
  /** The composed list read scope — list/listByAgent narrow through it; undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
}

/** Registers both routine services on the router (routes stage). */

export function registerRoutineServices(
  router: ConnectRouter,
  deps: RoutineControllerDeps,
): void {
  router.service(RoutineCommandController, {
    apply: (routine, ctx) => apply(deps, routine, ctx),
    create: (routine, ctx) => createRoutine(deps, routine, ctx),
    update: (input, ctx) => update(deps, input, ctx),
    rename: (input, ctx) => rename(deps, input, ctx),
    delete: (routineId, ctx) => deleteRoutine(deps, routineId, ctx),
    resume: (routineId, ctx) => resume(deps, routineId, ctx),
    fire: (input, ctx) => fire(deps, input, ctx),
  });
  router.service(RoutineQueryController, {
    get: (routineId, ctx) => get(deps, routineId, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listByAgent: (req, ctx) => listByAgent(deps, req, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    listFires: (req, ctx) => listFires(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Rename — the only writer of a routine's slug (pipeline/steps/rename.ts):
 * the name moves, then the live row's slug, and nothing else, so a fire
 * the tick records meanwhile stays. The Temporal schedule is named by the
 * routine's id and keeps firing; the old slug keeps leading to the
 * routine for reading for 30 days.
 */
async function rename(
  deps: RoutineControllerDeps,
  input: RenameInput,
  ctx: HandlerContext,
): Promise<Routine> {
  return renameResource(
    {
      method: RoutineCommandController.method.rename,
      names: deps.store,
      rows: storeRenameRows(deps.store, ApiResourceKind.routine, RoutineSchema),
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
 * Create. No IndexSearch tail: the routine kind is deliberately not
 * search-indexed. After the write, the agent is read again, so a routine
 * created while its agent is deleted goes with it (cascade.ts).
 */
async function createRoutine(
  deps: RoutineControllerDeps,
  routine: Routine,
  ctx: HandlerContext,
): Promise<Routine> {
  const reqCtx = new RequestContext(
    RoutineSchema,
    routine,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof RoutineSchema>("routine-create", deps.logger)
    .addStep(
      newAuthorizeStep(
        RoutineCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newNormalizeReferencesStep(deps.store))
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveRoutineDefaultsStep(deps))
    // Before the duplicate check and before ArmRoutineArtifact: a refused caller
    // learns nothing about existing slugs and costs no Temporal schedule
    // (steps.ts, resolveRoutineCreateTargets).
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        resolveRoutineCreateTargets,
      ),
    )
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newVaultAttachmentsStep(deps.store, deps.authorizer, ROUTINE_VAULT_ATTACHMENTS))
    .addStep(newClaimNameStep(deps.store, ApiResourceKind.routine))
    .addStep(newPersistStep(deps.store, deps.credentialBinding))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newArmRoutineStep(deps.clock, deps.logger))
    .addStep(
      newEnsureRoutineAgentStillExistsStep({
        store: deps.store,
        logger: deps.logger,
        authorizationLifecycle: deps.authorizationLifecycle,
        clock: deps.clock,
      }),
    )
    .build()
    .execute(reqCtx)
    .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
  return reqCtx.newState;
}

/**
 * Update. The owner's lock runs right after the routine's own validation,
 * before any reference or vault is judged, so a refused change names the
 * lock, not a vault.
 */
async function update(
  deps: RoutineControllerDeps,
  input: UpdateRoutineInput,
  ctx: HandlerContext,
): Promise<Routine> {
  return runGuardedWrite(async () => {
    const reqCtx = updateContext(
      RoutineSchema,
      input,
      callerIdentityOf(ctx),
      kindOf(ctx),
    );
    await newPipeline<typeof RoutineSchema>("routine-update", deps.logger)
      .addStep(
        newAuthorizeStep(
          RoutineCommandController.method.update,
          deps.authorizer,
        input,
      ),
      )
      .addStep(newResolveSlugStep({ update: true }))
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep())
      .addStep(newValidateProtoStep({ of: "state" }))
      .addStep(newNormalizeReferencesStep(deps.store))
      .addStep(newValidateRoutineUpdateStep(deps))
      .addStep(newOwnersLockStep(deps.ownerAccounts))
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
      .addStep(newVaultAttachmentsStep(deps.store, deps.authorizer, ROUTINE_VAULT_ATTACHMENTS))
      .addStep(newPersistRoutineUpdateStep(deps.store))
      .addStep(newArmRoutineStep(deps.clock, deps.logger))
      .build()
      .execute(reqCtx);
    return reqCtx.newState;
  });
}

/**
 * Apply — declarative create-or-update: routine defaults
 * resolve FIRST — matching the cloud edition, which runs its defaults
 * resolver before routing so the existence check sees the normalized
 * agent_ref and the same-org invariant fails loudly before any routing —
 * then existence decides create vs update. Delegates with the pipeline's
 * state, not the original input: the request context clones the input, so
 * the normalized agent_ref and the populated id (from LoadForApply) live
 * on the clone. Status is preserved verbatim across apply-as-update
 * (BuildUpdateState), so a routine manifest apply can never reset the
 * failure streak or un-pause an auto-paused routine.
 */
async function apply(
  deps: RoutineControllerDeps,
  routine: Routine,
  ctx: HandlerContext,
): Promise<Routine> {
  const reqCtx = new RequestContext(
    RoutineSchema,
    routine,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof RoutineSchema>("routine-apply", deps.logger)
    .addStep(
      newAuthorizeStep(RoutineCommandController.method.apply, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newNormalizeReferencesStep(deps.store))
    .addStep(newResolveRoutineDefaultsStep(deps))
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
  const resolved = reqCtx.newState;
  if (shouldCreate) {
    deps.logger.info("Routine does not exist - delegating to CREATE", {
      slug: resolved.metadata?.slug ?? "",
    });
    return createRoutine(deps, resolved, ctx);
  }
  deps.logger.info("Routine exists - delegating to UPDATE", {
    slug: resolved.metadata?.slug ?? "",
    id: resolved.metadata?.id ?? "",
  });
  return update(deps, everyPathUpdate(UpdateRoutineInputSchema, resolved), ctx);
}

/** Delete: the row, its names and access, then its artifact and fire ledger. */
async function deleteRoutine(
  deps: RoutineControllerDeps,
  routineId: RoutineId,
  ctx: HandlerContext,
): Promise<Routine> {
  type DeleteInput = typeof RoutineCommandController.method.delete.input;
  const reqCtx = new RequestContext(
    RoutineCommandController.method.delete.input,
    routineId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<DeleteInput>("routine-delete", deps.logger)
    .addStep(
      newAuthorizeStep(
        RoutineCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, RoutineSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.routine))
    .addStep(
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newTeardownRoutineArtifactStep(deps.clock, deps.logger))
    .addStep(newDeleteRoutineFiresStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted routine not found in context"),
      "deleted routine not found in context",
    );
  }
  return deleted as Routine;
}

/** Resume: clears the platform's pause and re-arms the schedule. */
async function resume(
  deps: RoutineControllerDeps,
  routineId: RoutineId,
  ctx: HandlerContext,
): Promise<Routine> {
  type ResumeInput = typeof RoutineCommandController.method.resume.input;
  const reqCtx = new RequestContext(
    RoutineCommandController.method.resume.input,
    routineId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ResumeInput>("routine-resume", deps.logger)
    .addStep(
      newAuthorizeStep(
        RoutineCommandController.method.resume,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, RoutineSchema))
    .addStep(newClearRoutinePauseStep(deps.store))
    .addStep(newArmResumedRoutineStep(deps.clock, deps.logger))
    .build()
    .execute(reqCtx);

  const resumed = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (resumed === undefined) {
    throw internalError(
      new Error("resumed routine not found in context"),
      "resumed routine not found in context",
    );
  }
  return resumed as Routine;
}

/** Fire: one run now, acting as the owner, optionally with text (fire.ts). */
async function fire(
  deps: RoutineControllerDeps,
  input: FireRoutineInput,
  ctx: HandlerContext,
): Promise<RoutineFireResult> {
  type FireInput = typeof RoutineCommandController.method.fire.input;
  const reqCtx = new RequestContext(
    RoutineCommandController.method.fire.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<FireInput>("routine-fire", deps.logger)
    .addStep(newAuthorizeStep(RoutineCommandController.method.fire, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractFireRoutineIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, RoutineSchema))
    .addStep(newValidateFireableStep())
    .addStep(
      newFireDirectRunStep({
        store: deps.store,
        runner: deps.runner,
        logger: deps.logger,
      }),
    )
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(FIRE_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("fire result not found in context"),
      "fire result not found in context",
    );
  }
  return result as RoutineFireResult;
}

/** Get — LoadTarget by id; NotFound when absent (get.go). */
async function get(
  deps: RoutineControllerDeps,
  routineId: RoutineId,
  ctx: HandlerContext,
): Promise<Routine> {
  type GetInput = typeof RoutineQueryController.method.get.input;
  const reqCtx = new RequestContext(
    RoutineQueryController.method.get.input,
    routineId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<GetInput>("routine-get", deps.logger)
    .addStep(
      newAuthorizeStep(RoutineQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, RoutineSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Routine;
}

/** GetByReference — the shared org+slug reference lookup (get_by_reference.go). */
async function getByReference(
  deps: RoutineControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Routine> {
  type RefInput = typeof RoutineQueryController.method.getByReference.input;
  const reqCtx = new RequestContext(
    RoutineQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<RefInput>("routine-get-by-reference", deps.logger)
    .addStep(
      newAuthorizeStep(
        RoutineQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, RoutineSchema))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(RoutineQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Routine;
}

const ROUTINE_LIST_KEY = "routineList";

/**
 * ListByAgent — one page of the routines whose agent_ref holds the
 * agent's id. A nonexistent agent yields an EMPTY LIST, not an error: "no
 * routines" is the useful answer for the operational surface either way.
 * The org filter is contract parity, not authorization: both editions
 * must answer an org-scoped request identically.
 */
async function listByAgent(
  deps: RoutineControllerDeps,
  req: ListRoutinesByAgentRequest,
  ctx: HandlerContext,
): Promise<RoutineList> {
  type ByAgentInput = typeof RoutineQueryController.method.listByAgent.input;
  const reqCtx = new RequestContext(
    RoutineQueryController.method.listByAgent.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ByAgentInput>("routine-get-by-agent", deps.logger)
    .addStep(
      newAuthorizeStep(
        RoutineQueryController.method.listByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadRoutinesByAgentStep(deps.store, deps.listReadScope))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(ROUTINE_LIST_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("routine list not found in context"),
      "routine list not found in context",
    );
  }
  return result as RoutineList;
}

function newLoadRoutinesByAgentStep(
  store: Store,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof RoutineQueryController.method.listByAgent.input> {
  return {
    name: "LoadRoutinesByAgent",
    async execute(
      ctx: RequestContext<
        typeof RoutineQueryController.method.listByAgent.input
      >,
    ): Promise<void> {
      const req = ctx.input;

      // A routine's agent_ref holds its agent's id (the index's `agent`
      // key), so a routine of an agent since deleted never lists under a
      // new agent of the same name.
      //
      // Org scope: a multi-org caller asking for one org's routines must
      // not see another org's routines of the same agent. (Routines are
      // same-org by invariant, so today this only excludes rows when the
      // requested org differs from the agent's — kept anyway for contract
      // parity with the sibling RPCs.) Both filters are indexed
      // predicates; the scope narrows the agent's routines last (the
      // scope is the last per-row predicate).
      ctx.set(
        ROUTINE_LIST_KEY,
        await readRoutinePage(store, listReadScope, ctx.callerIdentity, req, {
          query: {
            org: req.org,
            anyKey: [{ name: "agent", value: req.agentId }],
          },
          fingerprint: {
            lane: "routine.listByAgent",
            agentId: req.agentId,
            org: req.org,
          },
        }),
      );
    },
  };
}

/**
 * List — one page of the routines of an organization, filtered by
 * optional labels (AND semantics), newest first.
 */
async function list(
  deps: RoutineControllerDeps,
  req: ListRoutinesRequest,
  ctx: HandlerContext,
): Promise<RoutineList> {
  type ListInput = typeof RoutineQueryController.method.list.input;
  const reqCtx = new RequestContext(
    RoutineQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListInput>("routine-list", deps.logger)
    .addStep(
      newAuthorizeStep(RoutineQueryController.method.list, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgAndLabelsStep(deps.store, deps.listReadScope))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(ROUTINE_LIST_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("routine list not found in context"),
      "routine list not found in context",
    );
  }
  return result as RoutineList;
}

function newListByOrgAndLabelsStep(
  store: Store,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof RoutineQueryController.method.list.input> {
  return {
    name: "ListByOrgAndLabels",
    async execute(
      ctx: RequestContext<typeof RoutineQueryController.method.list.input>,
    ): Promise<void> {
      const req = ctx.input;
      // The org is an indexed predicate and the labels a per-row filter,
      // in both editions; the scope narrows the org's rows last (the scope
      // is the last per-row predicate).
      ctx.set(
        ROUTINE_LIST_KEY,
        await readRoutinePage(store, listReadScope, ctx.callerIdentity, req, {
          query: { org: req.org },
          fingerprint: { lane: "routine.list", org: req.org },
        }),
      );
    },
  };
}

/**
 * The two routine lanes' shared read: one page, the request's labels as
 * each row's keep (an exact AND match), the scope last, as a RoutineList.
 */
async function readRoutinePage(
  store: Store,
  listReadScope: ListReadScope | undefined,
  caller: CallerIdentity,
  request: ListPageRequest & { readonly labels: Readonly<Record<string, string>> },
  lane: {
    readonly query: ListIndexQuery<"agent">;
    readonly fingerprint: Readonly<Record<string, unknown>>;
  },
): Promise<RoutineList> {
  const page = await readListPage({
    store,
    declaration: routineListIndex,
    query: lane.query,
    request,
    fingerprint: listPageFingerprint({
      ...lane.fingerprint,
      labels: sortedLabels(request.labels),
    }),
    decode: decodeOrSkip(RoutineSchema),
    keep: (routine: Routine) =>
      matchesAllLabels(routine.metadata?.labels ?? {}, request.labels),
    scope: (routines) =>
      restrictListByReadScope(
        listReadScope,
        caller,
        ApiResourceKind.routine,
        routines,
        "",
      ),
    failure: "failed to list routines",
  });
  return create(RoutineListSchema, {
    entries: page.entries,
    nextPageToken: page.nextPageToken,
  });
}

/** ListFires — the fire-ledger surface (list_runs.go:44-61). */
async function listFires(
  deps: RoutineControllerDeps,
  req: ListRoutineFiresRequest,
  ctx: HandlerContext,
): Promise<RoutineFireList> {
  type ListFiresInput = typeof RoutineQueryController.method.listFires.input;
  const reqCtx = new RequestContext(
    RoutineQueryController.method.listFires.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListFiresInput>("routine-list-fires", deps.logger)
    .addStep(
      newAuthorizeStep(
        RoutineQueryController.method.listFires,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadRoutineForFiresStep(deps.store))
    .addStep(newListFiresFromLedgerStep(deps.store))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_FIRES_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("routine fire list not found in context"),
      "routine fire list not found in context",
    );
  }
  return result as RoutineFireList;
}
