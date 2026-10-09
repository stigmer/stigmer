/**
 * The AI judge's activities, run by the grading workflow after run health
 * (workflows/grade-run.ts): plan, start, poll, record. The judge is an
 * ordinary run of the runner's built-in judge (domain/score/judge/
 * judge-run.ts), so its billing, its credit refusal and its cost cap are
 * the run's own; what these activities add is the per-agent switch, the
 * sample, the monthly budget, and the score.
 *
 *   - plan: the run's agent has an enabled evaluator in the run's own
 *     organization (grading never reaches across organizations), the run
 *     is not itself a judge, it is in the sample (domain/score/judge/
 *     sampling.ts), and it has no judge verdict yet. The run is recorded
 *     as pending, then the grade's cap is set aside (domain/evaluator/
 *     budget.ts); a refusal there is recorded as "spending limit reached".
 *   - start: the judge run is created as the grading caller
 *     (extensions/grading-caller.ts) under a name fixed by the judged run,
 *     so a retry finds the run an earlier attempt created. A run is adopted
 *     only when it carries the judge label naming the judged run, which no
 *     client may write where reserved labels are guarded, and, when a
 *     caller was minted, was created by that same caller: a run a member
 *     named like a judge is never read as a verdict. A capacity
 *     refusal is thrown as JUDGE_BUSY_FAILURE_TYPE and retried by the
 *     workflow's policy for up to ten minutes; every other refusal is
 *     answered as the failure the record activity reports.
 *   - poll: whether the judge run has ended.
 *   - record: the verdict, read strictly (domain/score/judge/verdict.ts),
 *     or the reason there is none, replacing the pending score
 *     (domain/score/record.ts); a judge run still going is stopped; the
 *     budget is settled with what the judge spent; and last the judge's
 *     session is deleted, which deletes its run and releases its sandbox.
 *     A session the delete cannot remove is logged, never thrown, so a
 *     settled grade is not settled again by a retry.
 *
 * Every activity is safe to run again, as Temporal may: the plan keeps a
 * verdict already recorded, the start finds its run by name, the record
 * keeps a score of the same state, counting a kept grade by the stored
 * score, and finds a deleted session gone. Two writes are not keyed: a
 * reservation, and a settlement, each made once per attempt that commits
 * it. So the record settles after every step that can fail and before the
 * session's delete, which cannot fail it, and the budget's module header
 * states the one window left (a worker lost between a commit and the
 * activity's completion).
 *
 * Proven by __tests__/judge-activities.test.ts and the grade-run workflow
 * test.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { ApplicationFailure } from "@temporalio/common";

import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreState } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { reserve, settle } from "../../domain/evaluator/budget.js";
import type { GradeEnd } from "../../domain/evaluator/budget.js";
import { listAgentEvaluators } from "../../domain/evaluator/queries.js";
import { isActiveExecutionPhase, isTerminalExecutionPhase } from "../../domain/run/phases.js";
import { sessionIdOf } from "../../domain/run/target.js";
import {
  JUDGE_BUSY_REASON,
  JUDGE_CANNOT_ACT_REASON,
  JUDGE_COST_CAP_REASON,
  JUDGE_LIMIT_REACHED_REASON,
  JUDGE_NOT_FINISHED_REASON,
  JUDGE_NOT_STARTED_REASON,
  JUDGE_OUT_OF_CREDIT_REASON,
  JUDGE_RUN_FAILED_REASON,
  JUDGE_UNREADABLE_REASON,
} from "../../domain/score/constants.js";
import {
  GRADES_RUN_LABEL,
  PER_GRADE_CAP_USD,
  isJudgeRun,
  judgeRunName,
  judgeRunRequest,
} from "../../domain/score/judge/judge-run.js";
import {
  gradedJudgeScore,
  notGradedJudgeScore,
  pendingJudgeScore,
} from "../../domain/score/judge/judge-score.js";
import { VERDICT_SCHEMA, judgeMessage } from "../../domain/score/judge/rubrics.js";
import { isSampled } from "../../domain/score/judge/sampling.js";
import { subjectOf } from "../../domain/score/judge/subject.js";
import { readVerdict } from "../../domain/score/judge/verdict.js";
import type {
  JudgeRunCreator,
  JudgeSessionDeleter,
  ScoreDeleter,
  ScoreRecorder,
} from "../../domain/score/ports.js";
import {
  deleteScore,
  replaceUnlessGraded,
  sameWriterScore,
} from "../../domain/score/record.js";
import type { ScoreWriteDeps } from "../../domain/score/record.js";
import type { GradingCallerMint } from "../../extensions/grading-caller.js";
import { GradingCallerRefusedError } from "../../extensions/grading-caller.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  GRADE_ALREADY_GRADED,
  GRADE_RECORDED,
  GRADE_RUN_GONE,
  JUDGE_BUSY_FAILURE_TYPE,
  PLAN_JUDGE_ACTIVITY_NAME,
  POLL_JUDGE_ACTIVITY_NAME,
  RECORD_JUDGE_ACTIVITY_NAME,
  START_JUDGE_ACTIVITY_NAME,
} from "./names.js";
import type {
  GradeOutcome,
  JudgeActivities,
  JudgeFailure,
  JudgePlan,
  JudgeStart,
} from "./names.js";

/** The longest not-graded reason the record writes, as a criterion's reason is bounded. */
const REASON_MAX_LENGTH = 500;

export interface JudgeActivityDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly recorder: () => ScoreRecorder;
  readonly deleter: () => ScoreDeleter;
  readonly runs: () => JudgeRunCreator;
  readonly sessions: () => JudgeSessionDeleter;
  /** The composed grading caller; undefined = the judge acts as the server. */
  readonly gradingCaller: GradingCallerMint | undefined;
  /** The clock the budget's month is read from; tests pin it. */
  readonly now?: () => Date;
}

export function createJudgeActivities(deps: JudgeActivityDeps): JudgeActivities {
  const now = deps.now ?? (() => new Date());
  const writeDeps = (): ScoreWriteDeps => ({
    store: deps.store,
    logger: deps.logger,
    recorder: deps.recorder(),
    deleter: deps.deleter(),
  });

  return {
    [PLAN_JUDGE_ACTIVITY_NAME]: async (runId): Promise<JudgePlan> => {
      const run = await loadRun(deps.store, runId);
      if (
        run === undefined ||
        isJudgeRun(run) ||
        run.status?.phase !== RunPhase.RUN_COMPLETED
      ) {
        return { kind: "skip" };
      }
      const evaluator = await evaluatorOf(deps, run);
      if (
        evaluator === undefined ||
        evaluator.spec?.enabled !== true ||
        !isSampled(runId, evaluator.spec.sampleRate)
      ) {
        return { kind: "skip" };
      }
      const pending = pendingJudgeScore(run);
      const existing = await sameWriterScore(deps, pending);
      if (existing !== undefined && existing.status?.state !== ScoreState.pending) {
        return { kind: "skip" };
      }
      if ((await replaceUnlessGraded(writeDeps(), pending)) === "run-gone") {
        return { kind: "skip" };
      }

      const evaluatorId = evaluator.metadata?.id ?? "";
      const reservation = await reserve(
        deps.store,
        evaluatorId,
        now(),
        PER_GRADE_CAP_USD,
        JUDGE_LIMIT_REACHED_REASON,
      );
      if (reservation === "reserved") {
        return {
          kind: "grade",
          ticket: {
            evaluatorId,
            modelName: evaluator.spec.modelName,
            capUsd: PER_GRADE_CAP_USD,
          },
        };
      }
      if (reservation === "limit-reached") {
        await writeJudgeScore(
          deps,
          writeDeps(),
          notGradedJudgeScore(run, JUDGE_LIMIT_REACHED_REASON),
        );
        return { kind: "recorded" };
      }
      // "off": switched off or deleted between the read and the
      // reservation. The run was never graded, so its pending score goes.
      const written = await sameWriterScore(deps, pending);
      if (written?.status?.state === ScoreState.pending) {
        await deleteScore(deps.deleter(), written.metadata?.id ?? "");
      }
      return { kind: "skip" };
    },

    [START_JUDGE_ACTIVITY_NAME]: async (runId, ticket): Promise<JudgeStart> => {
      const run = await loadRun(deps.store, runId);
      if (run === undefined) {
        return { kind: "refused", failure: "not-started" };
      }
      const org = run.metadata?.org ?? "";
      let caller: CallerIdentity | undefined;
      if (deps.gradingCaller !== undefined) {
        try {
          caller = await deps.gradingCaller.mintGradingCaller(
            org,
            ticket.evaluatorId,
            runId,
          );
        } catch (error) {
          if (error instanceof GradingCallerRefusedError) {
            deps.logger.warn("grading cannot act for this evaluator", {
              runId,
              evaluatorId: ticket.evaluatorId,
              reason: error.message,
            });
            return { kind: "refused", failure: "cannot-act" };
          }
          throw error;
        }
      }
      const existing = await findJudgeRun(deps.store, runId, org, caller);
      if (existing !== undefined) {
        return { kind: "started", judgeRunId: existing };
      }

      const request = judgeRunRequest({
        judged: run,
        modelName: ticket.modelName,
        message: judgeMessage(subjectOf(run)),
        verdictSchema: VERDICT_SCHEMA,
      });
      try {
        const created = await deps.runs().create(request, caller);
        return { kind: "started", judgeRunId: created.metadata?.id ?? "" };
      } catch (error) {
        if (!(error instanceof ConnectError)) {
          throw error;
        }
        return startRefusal(deps, runId, org, caller, error);
      }
    },

    [POLL_JUDGE_ACTIVITY_NAME]: async (judgeRunId): Promise<boolean> => {
      const judge = await loadRun(deps.store, judgeRunId);
      return judge === undefined || isTerminalExecutionPhase(judge.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED);
    },

    [RECORD_JUDGE_ACTIVITY_NAME]: async (
      runId,
      ticket,
      judgeRunId,
      failure,
    ): Promise<GradeOutcome> => {
      const judge =
        judgeRunId === "" ? undefined : await loadRun(deps.store, judgeRunId);
      const spentUsd = judge?.status?.streamingUsage?.estimatedCostUsd ?? 0;

      if (judge !== undefined && isActiveExecutionPhase(judge.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
        await stopJudge(deps, judgeRunId);
      }

      const run = await loadRun(deps.store, runId);
      let outcome: GradeOutcome = GRADE_RUN_GONE;
      let end: GradeEnd = { kind: "gone" };
      if (run !== undefined) {
        const verdict = verdictScore(deps, run, judge, failure);
        outcome = await writeJudgeScore(deps, writeDeps(), verdict.score);
        end =
          outcome === GRADE_RUN_GONE
            ? { kind: "gone" }
            : outcome === GRADE_ALREADY_GRADED
              ? await storedEnd(deps, verdict.score)
              : verdict.end;
      }

      await settle(deps.store, ticket.evaluatorId, now(), ticket.capUsd, spentUsd, end);
      if (judge !== undefined) {
        await deleteJudgeSession(deps, judge);
      }
      return outcome;
    },
  };
}

/** The run's agent's evaluator in the run's own organization, if any. */
async function evaluatorOf(
  deps: JudgeActivityDeps,
  run: Run,
): Promise<Evaluator | undefined> {
  const agentId = run.status?.agentId ?? "";
  if (agentId === "") {
    return undefined;
  }
  const org = run.metadata?.org ?? "";
  const evaluators = await listAgentEvaluators(deps.store, deps.logger, agentId);
  return evaluators.find((evaluator) => evaluator.metadata?.org === org);
}

/**
 * The id of the judge run an earlier attempt created, found by its fixed
 * name and adopted only when it carries the judge label naming the judged
 * run and, when a caller was minted, was created by that caller (the
 * module header).
 */
async function findJudgeRun(
  store: Store,
  judgedRunId: string,
  org: string,
  caller: CallerIdentity | undefined,
): Promise<string | undefined> {
  const found = await findResourceBySlug(
    store,
    ApiResourceKind.run,
    RunSchema,
    judgeRunName(judgedRunId),
    org,
  );
  if (found === undefined || found.metadata?.labels[GRADES_RUN_LABEL] !== judgedRunId) {
    return undefined;
  }
  const creator = found.status?.audit?.specAudit?.createdBy?.id ?? "";
  if (caller !== undefined && creator !== caller.identityId) {
    return undefined;
  }
  return found.metadata.id;
}

/**
 * How a grade already recorded counts, read from the stored score: a retry
 * that finds its earlier attempt's grade counts what that attempt wrote,
 * not what it would conclude now (its judge run may be gone).
 */
async function storedEnd(
  deps: JudgeActivityDeps,
  score: ReturnType<typeof notGradedJudgeScore>,
): Promise<GradeEnd> {
  const stored = await sameWriterScore(deps, score);
  if (stored?.status?.state === ScoreState.graded) {
    return { kind: "graded" };
  }
  return { kind: "not-graded", reason: stored?.status?.notGradedReason ?? "" };
}

/**
 * The start's answer to a refused create. A capacity refusal is thrown for
 * the workflow's retry policy; a credit refusal is the hosted edition's
 * billing gate, whose every denial is FAILED_PRECONDITION naming credits;
 * a lost race finds the winner.
 */
async function startRefusal(
  deps: JudgeActivityDeps,
  runId: string,
  org: string,
  caller: CallerIdentity | undefined,
  error: ConnectError,
): Promise<JudgeStart> {
  switch (error.code) {
    case Code.AlreadyExists: {
      const winner = await findJudgeRun(deps.store, runId, org, caller);
      if (winner === undefined) {
        throw error;
      }
      return { kind: "started", judgeRunId: winner };
    }
    case Code.ResourceExhausted:
      throw ApplicationFailure.retryable(error.rawMessage, JUDGE_BUSY_FAILURE_TYPE);
    case Code.FailedPrecondition:
    case Code.PermissionDenied:
    case Code.NotFound:
    case Code.InvalidArgument:
    case Code.Unauthenticated: {
      const failure: JudgeFailure =
        error.code === Code.FailedPrecondition && /credit/i.test(error.rawMessage)
          ? "out-of-credit"
          : "not-started";
      deps.logger.warn("the judge run's create was refused", {
        runId,
        code: Code[error.code],
        reason: error.rawMessage,
      });
      return { kind: "refused", failure };
    }
    default:
      throw error;
  }
}

/** The score a finished or failed judge leaves, and how its grade counts. */
function verdictScore(
  deps: JudgeActivityDeps,
  run: Run,
  judge: Run | undefined,
  failure: JudgeFailure,
): { readonly score: ReturnType<typeof notGradedJudgeScore>; readonly end: GradeEnd } {
  const notGraded = (reason: string) => ({
    score: notGradedJudgeScore(run, reason),
    end: { kind: "not-graded", reason } as const,
  });
  if (failure !== "") {
    return notGraded(FAILURE_REASONS[failure]);
  }
  const phase = judge?.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  switch (phase) {
    case RunPhase.RUN_COMPLETED: {
      const reading = readVerdict(judge?.status?.structuredOutput);
      if (reading.kind === "refused") {
        deps.logger.warn("the judge's answer could not be read", {
          runId: run.metadata?.id ?? "",
          cause: reading.cause,
        });
        return notGraded(JUDGE_UNREADABLE_REASON);
      }
      return {
        score: gradedJudgeScore(
          run,
          reading.verdicts,
          judge?.status?.streamingUsage?.model ?? "",
        ),
        end: { kind: "graded" },
      };
    }
    case RunPhase.RUN_TERMINATED:
      return notGraded(JUDGE_COST_CAP_REASON);
    case RunPhase.RUN_FAILED:
    case RunPhase.RUN_CANCELLED: {
      const detail = judge?.status?.error ?? "";
      const reason =
        detail === "" ? JUDGE_RUN_FAILED_REASON : `${JUDGE_RUN_FAILED_REASON}: ${detail}`;
      return notGraded(reason.slice(0, REASON_MAX_LENGTH));
    }
    default:
      return notGraded(judge === undefined ? JUDGE_RUN_FAILED_REASON : JUDGE_NOT_FINISHED_REASON);
  }
}

/** The reason the person reads for each failure the workflow saw. */
const FAILURE_REASONS: Readonly<Record<Exclude<JudgeFailure, "">, string>> = {
  busy: JUDGE_BUSY_REASON,
  "cannot-act": JUDGE_CANNOT_ACT_REASON,
  "out-of-credit": JUDGE_OUT_OF_CREDIT_REASON,
  "not-started": JUDGE_NOT_STARTED_REASON,
  "not-finished": JUDGE_NOT_FINISHED_REASON,
};

/**
 * Writes a judge score over the pending one, then reads the run again: a
 * run deleted while its score was written has the score removed, so no
 * score outlives its run (the run-health record's rule, activities.ts).
 */
async function writeJudgeScore(
  deps: JudgeActivityDeps,
  write: ScoreWriteDeps,
  score: ReturnType<typeof notGradedJudgeScore>,
): Promise<GradeOutcome> {
  const result = await replaceUnlessGraded(write, score);
  if (result === "run-gone") {
    return GRADE_RUN_GONE;
  }
  if (result === "kept") {
    return GRADE_ALREADY_GRADED;
  }
  if ((await loadRun(deps.store, score.spec?.runId ?? "")) !== undefined) {
    return GRADE_RECORDED;
  }
  const written = await sameWriterScore(deps, score);
  if (written !== undefined) {
    await deleteScore(write.deleter, written.metadata?.id ?? "");
  }
  return GRADE_RUN_GONE;
}

/** Stops a judge run that outlived its budget; one already ended is fine. */
async function stopJudge(deps: JudgeActivityDeps, judgeRunId: string): Promise<void> {
  try {
    await deps.runs().terminate(judgeRunId, JUDGE_NOT_FINISHED_REASON);
  } catch (error) {
    if (error instanceof ConnectError && (error.code === Code.FailedPrecondition || error.code === Code.NotFound)) {
      deps.logger.warn("the judge run could not be stopped", {
        judgeRunId,
        reason: error.rawMessage,
      });
      return;
    }
    throw error;
  }
}

/**
 * Deletes the judge's session, which deletes its run and releases its
 * sandbox. A session already gone is fine. One the delete refuses (its run
 * still active where terminate cannot reach) or cannot reach (a store
 * fault) is left and logged, never thrown: the grade is recorded and
 * settled by then, and a retry would settle it again. Whoever the judge
 * acted as could already read the conversation it holds
 * (extensions/grading-caller.ts).
 */
async function deleteJudgeSession(deps: JudgeActivityDeps, judge: Run): Promise<void> {
  const sessionId = sessionIdOf(judge.spec);
  if (sessionId === "") {
    return;
  }
  try {
    await deps.sessions().delete(sessionId);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return;
    }
    deps.logger.error("the judge session could not be deleted; it is left", {
      sessionId,
      judgeRunId: judge.metadata?.id ?? "",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadRun(store: Store, runId: string): Promise<Run | undefined> {
  try {
    return await store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
