/**
 * Score domain steps: who may give which source, the run a score grades,
 * the fields the server owns, one rating per person, and the state a
 * score is stored in.
 *
 * The create chain asks its questions in the anti-probing order memory's
 * does (memory/steps.ts): the source guard first (who), then can_view on
 * the run named in spec.run_id (where), and only then is the run read, so
 * a caller who cannot see a run learns nothing from this lane that the
 * run's own `get` would not tell them. Every rule about the run (its
 * phase, its organization) runs after that question.
 *
 * Status has one writer, the create chain: the state is derived from
 * whether a value was given, and the not-graded reason is accepted from
 * the server's own grading code alone (InitializeScoreState). A person's
 * update changes the value and comment of their own feedback and nothing
 * else (ValidateScoreUpdate).
 *
 * Proven by __tests__/score.test.ts and score.conformance.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type {
  ListScoresByRunRequestSchema,
  ListScoresBySessionRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ScoreListSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ScoreStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  isFirstPartyHumanOperator,
  isServerComposedRequest,
} from "../../extensions/identity.js";
import {
  alreadyExistsWithReasonError,
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import {
  assignServerId,
  auditActorFor,
  generateId,
} from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  CHECK_SOURCE_REFUSED_MESSAGE,
  FEEDBACK_SCORE_NAME,
  FEEDBACK_VALUE_REQUIRED_MESSAGE,
  HUMAN_SOURCE_REFUSED_MESSAGE,
  RUN_HEALTH_SCORE_NAME,
  SCORE_COMMENT_HUMAN_ONLY_MESSAGE,
  SCORE_CRITERIA_NOT_HUMAN_MESSAGE,
  SCORE_CREATE_DENIED_MESSAGE,
  SCORE_NAME_SOURCE_MISMATCH_MESSAGE,
  SCORE_UPDATE_FIELDS_MESSAGE,
  SCORE_UPDATE_HUMAN_ONLY_MESSAGE,
  feedbackExistsMessage,
  runHealthExistsMessage,
  runNotCompletedMessage,
  scoreOrgMismatchMessage,
} from "./constants.js";
import { sessionIdOf } from "../run/target.js";
import { listRunScores, listSessionScores } from "./queries.js";

/** Context key for a list lane's result. */
export const LIST_RESULT_KEY = "listResult";

/** Context key for the run a create grades, stashed by LoadScoredRun. */
export const SCORED_RUN_KEY = "scoredRun";

/**
 * Context key for the not-graded reason the server's grading code carried
 * on its create, read before BuildNewState discards the request's status.
 */
const NOT_GRADED_REASON_KEY = "notGradedReason";

/** The refusal reason a client keys on to switch from create to update. */
export const SCORE_EXISTS_REASON = "SCORE_EXISTS";

/**
 * GuardScoreSource: an allow-list over who may give which source, failing
 * closed for any source or caller it does not name.
 *
 *   - score_source_human only from a first-party person
 *     (`isFirstPartyHumanOperator`, extensions/identity.ts): their sign-in
 *     or their own API key. A rating made with a person's own key is that
 *     person's rating. An integrator's end user (a PlatformClient token),
 *     a runner, a machine account and the server itself are refused: none
 *     is a person who can own a rating.
 *   - score_source_check only from the server itself (the `internal`
 *     class only the in-process transport mints), because a check's
 *     verdict is the platform's claim about a run, never a caller's.
 */
export function newGuardScoreSourceStep(): PipelineStep<typeof ScoreSchema> {
  return {
    name: "GuardScoreSource",
    execute(ctx: RequestContext<typeof ScoreSchema>): void {
      const source = ctx.newState.spec?.source ?? ScoreSource.unspecified;
      const caller = ctx.callerIdentity;
      switch (source) {
        case ScoreSource.human:
          if (!isFirstPartyHumanOperator(caller)) {
            throw permissionDeniedError(HUMAN_SOURCE_REFUSED_MESSAGE);
          }
          return;
        case ScoreSource.check:
          if (caller.callerClass !== "internal") {
            throw permissionDeniedError(CHECK_SOURCE_REFUSED_MESSAGE);
          }
          return;
        case ScoreSource.unspecified:
          throw invalidArgumentError("spec.source is required");
        default: {
          const unknown: never = source;
          throw invalidArgumentError(`unknown spec.source ${String(unknown)}`);
        }
      }
    },
  };
}

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * after GuardScoreSource and BEFORE the run is read: can_view on the run
 * named in spec.run_id. The RPC is is_skip_authorization because the
 * target is that run, not the request's own id (command.proto). A
 * server-composed request asks nothing: the entry-point request already
 * passed, and the grading code acts for the platform.
 */
export function resolveScoreCreateTargets(
  ctx: RequestContext<typeof ScoreSchema>,
): ReadonlyArray<AuthorizationTarget> {
  if (isServerComposedRequest(ctx.callerIdentity)) {
    return [];
  }
  return [
    {
      permission: IamPermission.can_view,
      resourceKind: ApiResourceKind.run,
      resourceId: ctx.newState.spec?.runId ?? "",
      deniedMessage: SCORE_CREATE_DENIED_MESSAGE,
    },
  ];
}

/**
 * LoadScoredRun: reads the run named in spec.run_id and stashes it under
 * SCORED_RUN_KEY. The generic LoadTarget step cannot serve: it reads the
 * request's own id under the request's own kind (load-target.ts).
 */
export function newLoadScoredRunStep(
  store: Store,
): PipelineStep<typeof ScoreSchema> {
  return {
    name: "LoadScoredRun",
    async execute(ctx: RequestContext<typeof ScoreSchema>): Promise<void> {
      const runId = ctx.newState.spec?.runId ?? "";
      let run: Run;
      try {
        run = await store.getResource(ApiResourceKind.run, runId, RunSchema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Run", runId);
        }
        throw internalError(error, "failed to load the run to score");
      }
      ctx.set(SCORED_RUN_KEY, run);
    },
  };
}

function scoredRunOf(ctx: RequestContext<typeof ScoreSchema>): Run {
  const run = ctx.get(SCORED_RUN_KEY) as Run | undefined;
  if (run === undefined) {
    throw internalError(
      new Error("scored run not found in context"),
      "scored run not found in context",
    );
  }
  return run;
}

/**
 * ResolveScoreDefaults: the server claiming the fields it owns and the
 * rules that tie a score to its run, before anything persists.
 *
 *  1. metadata.org is required and must be the run's organization: the
 *     request names it so the deleting-organization interceptor covers the
 *     lane, and a score lives where its run does.
 *  2. The run must be completed. A completed run never changes phase again
 *     (update-status.ts ignores a phase change on a terminal run), so a
 *     score is never stale against its run.
 *  3. The name must agree with the source: `feedback` from a person,
 *     `run-health` from the checks. A comment is a person's only, a
 *     person's feedback always carries thumbs and never criteria.
 *  4. spec.session_id is the run's, whatever the request carried.
 *  5. The id is minted here so an unnamed score is named by its id.
 *  6. A not-graded reason carried by the server's grading code is kept
 *     for InitializeScoreState, before BuildNewState discards the
 *     request's status; only a check's create carries one, and only the
 *     server gives a check (GuardScoreSource).
 */
export function newResolveScoreDefaultsStep(): PipelineStep<
  typeof ScoreSchema
> {
  return {
    name: "ResolveScoreDefaults",
    execute(ctx: RequestContext<typeof ScoreSchema>): void {
      const score = ctx.newState;
      const metadata = score.metadata;
      const spec = score.spec;
      if (metadata === undefined || metadata.org === "") {
        throw invalidArgumentError("metadata.org is required for a score");
      }
      if (spec === undefined) {
        throw internalError(
          new Error("score spec is nil"),
          "score spec is nil",
        );
      }
      const run = scoredRunOf(ctx);
      const runOrg = run.metadata?.org ?? "";
      if (metadata.org !== runOrg) {
        throw failedPreconditionError(scoreOrgMismatchMessage(runOrg));
      }
      if (run.status?.phase !== RunPhase.RUN_COMPLETED) {
        throw failedPreconditionError(runNotCompletedMessage(spec.runId));
      }

      const human = spec.source === ScoreSource.human;
      const expectedName = human ? FEEDBACK_SCORE_NAME : RUN_HEALTH_SCORE_NAME;
      if (spec.name !== expectedName) {
        throw invalidArgumentError(SCORE_NAME_SOURCE_MISMATCH_MESSAGE);
      }
      if (!human && spec.comment !== "") {
        throw invalidArgumentError(SCORE_COMMENT_HUMAN_ONLY_MESSAGE);
      }
      if (human && spec.value.case === undefined) {
        throw invalidArgumentError(FEEDBACK_VALUE_REQUIRED_MESSAGE);
      }
      if (human && spec.criteria.length > 0) {
        throw invalidArgumentError(SCORE_CRITERIA_NOT_HUMAN_MESSAGE);
      }

      spec.sessionId = sessionIdOf(run.spec);

      assignServerId(ctx, generateId("scr"));
      if (metadata.name === "" && metadata.slug === "") {
        metadata.name = metadata.id;
      }

      if (!human && spec.value.case === undefined) {
        ctx.set(NOT_GRADED_REASON_KEY, score.status?.notGradedReason ?? "");
      }
    },
  };
}

/**
 * CheckScoreUnique: one rating per person per run, and one run-health
 * score per run per version of the checks. A second rating is refused
 * with ALREADY_EXISTS carrying SCORE_EXISTS and the existing score's id,
 * so a client switches to update without parsing text. The rule is read
 * before the write, as every slug in the platform is (duplicate.ts): a
 * double click can race it, which the console prevents by disabling the
 * buttons while a write is in flight.
 */
export function newCheckScoreUniqueStep(
  store: Store,
): PipelineStep<typeof ScoreSchema> {
  return {
    name: "CheckScoreUnique",
    async execute(ctx: RequestContext<typeof ScoreSchema>): Promise<void> {
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        throw internalError(
          new Error("score spec is nil"),
          "score spec is nil",
        );
      }
      let existing: Score[];
      try {
        existing = await listRunScores(store, spec.runId);
      } catch (error) {
        throw internalError(error, "failed to read the run's scores");
      }
      const caller = auditActorFor(ctx.callerIdentity).id;
      for (const score of existing) {
        const other = score.spec;
        if (other === undefined || other.name !== spec.name) {
          continue;
        }
        const id = score.metadata?.id ?? "";
        if (
          spec.source === ScoreSource.human &&
          other.source === ScoreSource.human &&
          creatorOf(score) === caller
        ) {
          throw alreadyExistsWithReasonError(feedbackExistsMessage(id), {
            reason: SCORE_EXISTS_REASON,
            metadata: { score_id: id },
          });
        }
        if (
          spec.source === ScoreSource.check &&
          other.source === ScoreSource.check &&
          other.evaluatorVersion === spec.evaluatorVersion
        ) {
          throw alreadyExistsWithReasonError(runHealthExistsMessage(id), {
            reason: SCORE_EXISTS_REASON,
            metadata: { score_id: id },
          });
        }
      }
    },
  };
}

/** The creator stamp of a stored score. */
function creatorOf(score: Score): string {
  return score.status?.audit?.specAudit?.createdBy?.id ?? "";
}

/**
 * InitializeScoreState: stamps the state after BuildNewState wiped the
 * request's status. A score with a value is graded; a score without one is
 * not graded, with the reason the server's grading code carried
 * (ResolveScoreDefaults point 6). A failed grade is never a failing
 * value: an error read as a zero corrupts every average over scores.
 */
export function newInitializeScoreStateStep(): PipelineStep<
  typeof ScoreSchema
> {
  return {
    name: "InitializeScoreState",
    execute(ctx: RequestContext<typeof ScoreSchema>): void {
      const score = ctx.newState;
      if (score.status === undefined) {
        score.status = create(ScoreStatusSchema, {});
      }
      if (score.spec?.value.case !== undefined) {
        score.status.state = ScoreState.graded;
        score.status.notGradedReason = "";
        return;
      }
      score.status.state = ScoreState.not_graded;
      score.status.notGradedReason =
        (ctx.get(NOT_GRADED_REASON_KEY) as string | undefined) ?? "";
    },
  };
}

/**
 * ValidateScoreUpdate: only a person's feedback changes, and only its
 * value and comment. Refusing every other source here is what keeps a
 * check's verdict final even where the open-source edition derives an
 * owner for it from the operator's stamp (derived-tuples.ts). The
 * feedback still needs thumbs after the edit.
 *
 * Runs after LoadExisting and BuildUpdateState, which keeps the status
 * (state, audit) the create stamped.
 */
export function newValidateScoreUpdateStep(): PipelineStep<typeof ScoreSchema> {
  return {
    name: "ValidateScoreUpdate",
    execute(ctx: RequestContext<typeof ScoreSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Score | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing score not found in context"),
          "existing score not found in context",
        );
      }
      const before = existing.spec;
      const after = ctx.newState.spec;
      if (before === undefined || before.source !== ScoreSource.human) {
        throw failedPreconditionError(SCORE_UPDATE_HUMAN_ONLY_MESSAGE);
      }
      if (
        after === undefined ||
        after.runId !== before.runId ||
        after.sessionId !== before.sessionId ||
        after.name !== before.name ||
        after.source !== before.source ||
        after.evaluatorVersion !== before.evaluatorVersion ||
        after.criteria.length !== 0
      ) {
        throw failedPreconditionError(SCORE_UPDATE_FIELDS_MESSAGE);
      }
      if (after.value.case === undefined) {
        throw invalidArgumentError(FEEDBACK_VALUE_REQUIRED_MESSAGE);
      }
    },
  };
}

/**
 * ListScoresByRun: every score of the run, newest first. The Authorize
 * step already asked can_view on the run, and a score's visibility is its
 * run's, so no row is filtered by caller.
 */
export function newListScoresByRunStep(
  store: Store,
): PipelineStep<typeof ListScoresByRunRequestSchema> {
  return {
    name: "ListScoresByRun",
    async execute(
      ctx: RequestContext<typeof ListScoresByRunRequestSchema>,
    ): Promise<void> {
      let scores: Score[];
      try {
        scores = await listRunScores(store, ctx.input.runId);
      } catch (error) {
        throw internalError(error, "failed to list the run's scores");
      }
      ctx.set(
        LIST_RESULT_KEY,
        create(ScoreListSchema, { totalCount: scores.length, items: scores }),
      );
    },
  };
}

/**
 * ListScoresBySession: every score of every run in the session, newest
 * first. The Authorize step already asked can_view on the session, and a
 * run's visibility is its session's, so no row is filtered by caller.
 */
export function newListScoresBySessionStep(
  store: Store,
): PipelineStep<typeof ListScoresBySessionRequestSchema> {
  return {
    name: "ListScoresBySession",
    async execute(
      ctx: RequestContext<typeof ListScoresBySessionRequestSchema>,
    ): Promise<void> {
      let scores: Score[];
      try {
        scores = await listSessionScores(store, ctx.input.sessionId);
      } catch (error) {
        throw internalError(error, "failed to list the session's scores");
      }
      ctx.set(
        LIST_RESULT_KEY,
        create(ScoreListSchema, { totalCount: scores.length, items: scores }),
      );
    },
  };
}
