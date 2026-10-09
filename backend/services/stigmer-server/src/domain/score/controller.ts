/**
 * Score controller: the grades of a finished run, a person's thumbs and
 * the platform's free run-health checks, served on both editions.
 *
 * A score is a child of its run (kind_meta: scope PARENT through
 * spec.run_id): whoever can view the run views its scores, and nothing is
 * granted on a score itself. The person who rates owns the rating through
 * the row's creator stamp and alone edits it; the server's checks write
 * through the in-process lane as `internal` (boot/inprocess.ts), so every
 * write, the server's included, runs the whole chain.
 *
 * No apply RPC: nobody authors a score manifest. Not search-indexed: a
 * comment is a person's words about a conversation, and search results
 * are org-visible, so no IndexSearch or DeleteSearchIndex step appears in
 * this domain.
 *
 * Proven by __tests__/score.test.ts and score.conformance.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreIdSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type {
  ListScoresByRunRequest,
  ListScoresBySessionRequest,
  ScoreId,
  ScoreList,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newAuthorizeResolvedTargetStep } from "../../pipeline/steps/authorize-resolved-target.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import {
  LIST_RESULT_KEY,
  newCheckScoreUniqueStep,
  newGuardScoreSourceStep,
  newInitializeScoreStateStep,
  newListScoresByRunStep,
  newListScoresBySessionStep,
  newLoadScoredRunStep,
  newResolveScoreDefaultsStep,
  newValidateScoreUpdateStep,
  resolveScoreCreateTargets,
} from "./steps.js";

export interface ScoreControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam: the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver; undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
}

/** Registers both score services on the router (routes stage). */
export function registerScoreServices(
  router: ConnectRouter,
  deps: ScoreControllerDeps,
): void {
  router.service(ScoreCommandController, {
    create: (score, ctx) => createScore(deps, score, ctx),
    update: (score, ctx) => updateScore(deps, score, ctx),
    delete: (id, ctx) => deleteScore(deps, id, ctx),
  });
  router.service(ScoreQueryController, {
    get: (id, ctx) => getScore(deps, id, ctx),
    listByRun: (req, ctx) => listByRun(deps, req, ctx),
    listBySession: (req, ctx) => listBySession(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create: a score on a completed run. GuardScoreSource decides who may
 * give the source, AuthorizeResolvedTarget asks can_view on the run
 * before it is read, and every rule about the run runs after both
 * (steps.ts). InitializeScoreState runs after BuildNewState so the status
 * wipe cannot undo it.
 */
async function createScore(
  deps: ScoreControllerDeps,
  score: Score,
  ctx: HandlerContext,
): Promise<Score> {
  const reqCtx = new RequestContext(
    ScoreSchema,
    score,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScoreSchema>("score-create", deps.logger)
    .addStep(
      newAuthorizeStep(ScoreCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newGuardScoreSourceStep())
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        resolveScoreCreateTargets,
      ),
    )
    .addStep(newLoadScoredRunStep(deps.store))
    .addStep(newResolveScoreDefaultsStep())
    .addStep(newCheckScoreUniqueStep(deps.store))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newInitializeScoreStateStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update: a person changes the value and comment of their own feedback.
 * Authorize asks can_edit (the owner, while they can still see the run);
 * ValidateScoreUpdate refuses any other source and any other field.
 */
async function updateScore(
  deps: ScoreControllerDeps,
  score: Score,
  ctx: HandlerContext,
): Promise<Score> {
  const reqCtx = new RequestContext(
    ScoreSchema,
    score,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScoreSchema>("score-update", deps.logger)
    .addStep(
      newAuthorizeStep(ScoreCommandController.method.update, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newValidateScoreUpdateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Delete: the rater removes their rating, or the run's owner any score on
 * the run (can_delete). The run's own delete and its session's cascade
 * reach this chain through the in-process deleter (cascade.ts), so a
 * score's access goes with its row however it is removed.
 */
async function deleteScore(
  deps: ScoreControllerDeps,
  id: ScoreId,
  ctx: HandlerContext,
): Promise<Score> {
  const reqCtx = new RequestContext(
    ScoreIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScoreIdSchema>("score-delete", deps.logger)
    .addStep(
      newAuthorizeStep(ScoreCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ScoreSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted score not found in context"),
      "deleted score not found in context",
    );
  }
  return deleted as Score;
}

/** Get: can_view on the score, which is can_view on its run. */
async function getScore(
  deps: ScoreControllerDeps,
  id: ScoreId,
  ctx: HandlerContext,
): Promise<Score> {
  const reqCtx = new RequestContext(
    ScoreIdSchema,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ScoreIdSchema>("score-get", deps.logger)
    .addStep(newAuthorizeStep(ScoreQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadTargetStep(deps.store, ScoreSchema))
    .build()
    .execute(reqCtx);

  const target = reqCtx.get(TARGET_RESOURCE_KEY);
  if (target === undefined) {
    throw internalError(
      new Error("target score not found in context"),
      "target score not found in context",
    );
  }
  return target as Score;
}

/** ListByRun: every score of a run; Authorize asks can_view on the run. */
async function listByRun(
  deps: ScoreControllerDeps,
  req: ListScoresByRunRequest,
  ctx: HandlerContext,
): Promise<ScoreList> {
  const input = ScoreQueryController.method.listByRun.input;
  const reqCtx = new RequestContext(
    input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof input>("score-list-by-run", deps.logger)
    .addStep(
      newAuthorizeStep(ScoreQueryController.method.listByRun, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListScoresByRunStep(deps.store))
    .build()
    .execute(reqCtx);
  return listResultOf(reqCtx.get(LIST_RESULT_KEY));
}

/**
 * ListBySession: every score of every run in a session; Authorize asks
 * can_view on the session.
 */
async function listBySession(
  deps: ScoreControllerDeps,
  req: ListScoresBySessionRequest,
  ctx: HandlerContext,
): Promise<ScoreList> {
  const input = ScoreQueryController.method.listBySession.input;
  const reqCtx = new RequestContext(
    input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof input>("score-list-by-session", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScoreQueryController.method.listBySession,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListScoresBySessionStep(deps.store))
    .build()
    .execute(reqCtx);
  return listResultOf(reqCtx.get(LIST_RESULT_KEY));
}

function listResultOf(result: unknown): ScoreList {
  if (result === undefined) {
    throw internalError(
      new Error("score list not found in context"),
      "score list not found in context",
    );
  }
  return result as ScoreList;
}
