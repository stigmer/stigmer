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
 * The two per-agent reads (an agent's quality report and its flagged
 * scores) are in quality.ts; their chains are here beside the others.
 *
 * Proven by __tests__/score.test.ts, __tests__/quality.test.ts and
 * score.conformance.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreIdSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type {
  AgentQualityReport,
  GetAgentQualityReportRequest,
  ListFlaggedScoresByAgentRequest,
  ListScoresByRunRequest,
  ListScoresBySessionRequest,
  ScoreId,
  ScoreList,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { UpdateScoreInput } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  newCleanupGrantsStep,
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
import { newClaimNameStep, newReleaseNamesStep, releaseNameOnFailure } from "../../pipeline/steps/names.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { updateContext } from "../../pipeline/steps/update-input.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";
import {
  FLAGGED_SCORES_KEY,
  QUALITY_REPORT_KEY,
  type QualityLaneDeps,
  newListFlaggedScoresStep,
  newTallyAgentQualityStep,
  resolveQualityAgentTarget,
} from "./quality.js";
import {
  LIST_RESULT_KEY,
  newCheckScoreUniqueStep,
  newGuardScoreSourceStep,
  newInitializeScoreStateStep,
  newListScoresByRunStep,
  newListScoresBySessionStep,
  newLoadScoredRunStep,
  newResolveScoreDefaultsStep,
  newStampScoredRunStep,
  newValidateScoreUpdateStep,
  resolveScoreCreateTargets,
} from "./steps.js";

export interface ScoreControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam: the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /**
   * The composed credential binding: the persist and rename backstops
   * refuse a credential that does not reach the row's organization
   * (pipeline/steps/refuse-bound-elsewhere.ts).
   */
  readonly credentialBinding: CredentialBinding;
  /** The composed tuple-lifecycle driver; undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope; undefined = trusted local, nothing narrowed. */
  readonly listReadScope: ListReadScope | undefined;
  /** Today's clock for the per-agent reads' window; defaults to the wall clock. */
  readonly now?: () => Date;
}

/** Registers both score services on the router (routes stage). */
export function registerScoreServices(
  router: ConnectRouter,
  deps: ScoreControllerDeps,
): void {
  router.service(ScoreCommandController, {
    create: (score, ctx) => createScore(deps, score, ctx),
    update: (input, ctx) => updateScore(deps, input, ctx),
    delete: (id, ctx) => deleteScore(deps, id, ctx),
  });
  router.service(ScoreQueryController, {
    get: (id, ctx) => getScore(deps, id, ctx),
    listByRun: (req, ctx) => listByRun(deps, req, ctx),
    listBySession: (req, ctx) => listBySession(deps, req, ctx),
    getAgentQualityReport: (req, ctx) =>
      getAgentQualityReport(deps, req, ctx),
    listFlaggedByAgent: (req, ctx) => listFlaggedByAgent(deps, req, ctx),
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
    .addStep(newCheckScoreUniqueStep(deps.store, deps.logger))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newStampScoredRunStep())
    .addStep(newInitializeScoreStateStep())
    .addStep(newClaimNameStep(deps.store, ApiResourceKind.score))
    .addStep(newPersistStep(deps.store, deps.credentialBinding))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx)
    .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
  return reqCtx.newState;
}

/**
 * Update: a person changes the value and comment of their own feedback.
 * Authorize asks can_edit (the owner, while they can still see the run);
 * ValidateScoreUpdate refuses any other source and any other field.
 */
async function updateScore(
  deps: ScoreControllerDeps,
  input: UpdateScoreInput,
  ctx: HandlerContext,
): Promise<Score> {
  return runGuardedWrite(async () => {
    const reqCtx = updateContext(
      ScoreSchema,
      input,
      callerIdentityOf(ctx),
      kindOf(ctx),
    );
    await newPipeline<typeof ScoreSchema>("score-update", deps.logger)
      .addStep(
        newAuthorizeStep(ScoreCommandController.method.update, deps.authorizer,
        input,
      ),
      )
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep())
      .addStep(newValidateProtoStep({ of: "state" }))
      .addStep(newValidateScoreUpdateStep())
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newPersistStep(deps.store, deps.credentialBinding))
      .build()
      .execute(reqCtx);
    return reqCtx.newState;
  });
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
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.score))
    .addStep(
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  return chainResult<Score>(reqCtx.get(EXISTING_RESOURCE_KEY), "deleted score");
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

  return chainResult<Score>(reqCtx.get(TARGET_RESOURCE_KEY), "target score");
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
    .addStep(newListScoresByRunStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<ScoreList>(reqCtx.get(LIST_RESULT_KEY), "score list");
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
    .addStep(newListScoresBySessionStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return chainResult<ScoreList>(reqCtx.get(LIST_RESULT_KEY), "score list");
}

/**
 * GetAgentQualityReport: how one agent's runs in an organization were
 * graded (quality.ts). Authorize asks can_view on the organization, then
 * AuthorizeResolvedTarget can_view on the agent, before any row is read.
 */
async function getAgentQualityReport(
  deps: ScoreControllerDeps,
  req: GetAgentQualityReportRequest,
  ctx: HandlerContext,
): Promise<AgentQualityReport> {
  const input = ScoreQueryController.method.getAgentQualityReport.input;
  const reqCtx = new RequestContext(
    input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof input>("score-agent-quality-report", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScoreQueryController.method.getAgentQualityReport,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        resolveQualityAgentTarget,
      ),
    )
    .addStep(newTallyAgentQualityStep(qualityDepsOf(deps)))
    .build()
    .execute(reqCtx);
  return chainResult<AgentQualityReport>(
    reqCtx.get(QUALITY_REPORT_KEY),
    "agent quality report",
  );
}

/**
 * ListFlaggedByAgent: one page of the agent's failed grades the caller can
 * open (quality.ts), authorized as the report is.
 */
async function listFlaggedByAgent(
  deps: ScoreControllerDeps,
  req: ListFlaggedScoresByAgentRequest,
  ctx: HandlerContext,
): Promise<ScoreList> {
  const input = ScoreQueryController.method.listFlaggedByAgent.input;
  const reqCtx = new RequestContext(
    input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof input>("score-list-flagged-by-agent", deps.logger)
    .addStep(
      newAuthorizeStep(
        ScoreQueryController.method.listFlaggedByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        resolveQualityAgentTarget,
      ),
    )
    .addStep(newListFlaggedScoresStep(qualityDepsOf(deps)))
    .build()
    .execute(reqCtx);
  return chainResult<ScoreList>(
    reqCtx.get(FLAGGED_SCORES_KEY),
    "flagged score list",
  );
}

function qualityDepsOf(deps: ScoreControllerDeps): QualityLaneDeps {
  return {
    store: deps.store,
    logger: deps.logger,
    listReadScope: deps.listReadScope,
    now: deps.now ?? (() => new Date()),
  };
}

/**
 * What a chain left in its context for the handler to answer with. A
 * missing value is a chain built wrong (a step removed or reordered), so it
 * fails loudly as INTERNAL rather than answering with nothing.
 */
export function chainResult<T>(value: unknown, what: string): T {
  if (value === undefined) {
    throw internalError(
      new Error(`${what} not found in context`),
      `${what} not found in context`,
    );
  }
  return value as T;
}
