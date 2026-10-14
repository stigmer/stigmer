/**
 * The case workflow's activities (workflows/run-case.ts): start a try,
 * poll and stop runs, grade the try, run its votes, record its score; and
 * the spend activity both workflows read a try's cost through.
 *
 *   - start-try: the try's session, then its run (domain/eval-run/
 *     try-run.ts, arm.ts), the run capped at the budget the suite workflow
 *     hands the try (its share of what the eval run has left), both as the
 *     eval run's caller, minted per try (extensions/eval-run-caller.ts;
 *     none composed: the server).
 *     Every attempt first looks for the run an earlier one created (the
 *     eval's label and the try's run name), before it mints the caller, so
 *     a start whose answer was lost is adopted, never created twice nor
 *     left going behind a refused mint, whatever attempt number Temporal
 *     reports; should it find two (a start that raced its own
 *     retry), it adopts the earliest created and stops the other. The
 *     session's create and the run's are refused alike: a capacity
 *     refusal is thrown as EVAL_RUN_BUSY_FAILURE_TYPE for the
 *     workflow's thirty minutes of retries; any other refusal is the
 *     try's not-graded reason in its own words (an organization with no
 *     key for the target's model reads admission's FAILED_PRECONDITION
 *     copy on each try); a session left by a refused run is deleted. A
 *     caller the seam refuses is "cannot-act", with the refusal's own
 *     not-graded reason when it names one. On an eval run of a plugin, a
 *     try whose plugin has moved past the stamped digest is not started:
 *     the eval run evaluates the plugin as installed when it was created,
 *     so it would grade a newer plugin against its suite
 *     (PLUGIN_UPDATED_REASON). Every other try runs the agent at its
 *     stamped version (none on an eval run of a plugin) with every plugin
 *     listed at its stamped digest, the same session in both arms, the
 *     without arm's run leaving out the compared plugin (context.ts
 *     attachmentOf), whatever moved since; the other plugins' servers are
 *     off (otherServersOf). An agent's default target names no model.
 *   - poll-run, stop-run: whether a run is still waiting for a runner,
 *     running (with its start stamp), or ended; stop one, a run already
 *     ended or gone being fine. A stop the run's lifecycle refuses is
 *     read against the run's phase: a paused run, or one waiting for
 *     approval, is not stopped, and the refusal is thrown.
 *   - grade-try: the try's trace (domain/score/eval/trace.ts, read from the
 *     try's session events and the files on its run), every code
 *     grader (domain/eval-run/graders/), and for each AI-graded check
 *     either the verdict its evidence already decides (a missing file, a
 *     binary one) or the rubric its votes answer. An AI-graded indicator
 *     (a check the two-arm comparison does not score) casts no votes in
 *     the without-plugin arm: it is not graded there, on its criterion
 *     only. The run's own failure is named ("timed out after 300s" when
 *     the workflow stopped it), and the try is graded on what it
 *     produced. A run its own cap stopped at its share of the eval's
 *     spending limit (its estimated cost within a cent of the try's
 *     budget) is not graded, every check "stopped at its share of the
 *     eval's spending limit", and asks no votes: the spend policy and the
 *     concurrency never move a score. A run a lower cap stopped
 *     (its agent's own, its profile's) is graded as a stopped run.
 *   - start-vote, read-vote, delete-vote: one vote of an AI-graded check, a
 *     judge run in its own session (graders/llm.ts), adopted on a retry
 *     through the run list index's `grades` key; read strictly from the
 *     vote run's `stigmer.agent.structured_output` event
 *     (domain/session/events/run-events.ts) and stopped if still going; then its session deleted, as the AI judge's grading
 *     deletes its own. The read deletes nothing, so a read retried after
 *     its answer was lost reads the same vote and cost again; the delete
 *     is its own step, and a vote or session already gone is deleted. A
 *     delete that fails is thrown, for the activity's retries and then the
 *     workflow, which then leaves that vote's cost to the spend read: the
 *     vote's run is still stored. (A refused run's session, by contrast,
 *     is deleted on a best effort, its failure logged.)
 *   - try-spend: what a try's run and its stored votes spent, found by
 *     the eval's label (the run list index's `eval_run` key) and the
 *     try's run name, for the workflows to count a try whose own workflow
 *     could not report it.
 *   - record-score: the votes tallied, the try scored
 *     (domain/eval-run/scoring.ts), and its Score written on the run
 *     (domain/eval-run/score-writer.ts). A scored grader left not graded
 *     leaves the try not graded with that reason; an indicator left not
 *     graded is reported on its own criterion only, since it counts toward
 *     no score.
 *
 * Proven by __tests__/case-activities.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { ApplicationFailure } from "@temporalio/common";
import { Context } from "@temporalio/activity";

import { parseTryStop } from "@stigmer/eval-runtime";
import type { EvalGrader } from "@stigmer/plugin-package";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { gradeChecks } from "../../domain/eval-run/graders/grade.js";
import {
  describeVoteAnswer,
  isJudgedGrader,
  readVote,
  referenceTranscript,
  rubricText,
  tallyVotes,
  voteEvidence,
  voteMessage,
  voteRubricName,
  voteSchema,
} from "../../domain/eval-run/graders/llm.js";
import { patternsFor } from "../../domain/eval-run/graders/patterns.js";
import type { PatternRunner } from "../../domain/eval-run/graders/patterns.js";
import type { GraderVerdict } from "../../domain/eval-run/graders/verdict.js";
import { isNotGraded } from "../../domain/eval-run/graders/verdict.js";
import {
  gradedEvalScore,
  notGradedEvalScore,
  stoppedEvalScore,
  writeEvalScore,
} from "../../domain/eval-run/score-writer.js";
import { scoringOf, tryScore } from "../../domain/eval-run/scoring.js";
import {
  tryRunName,
  pluginServersOf,
  tryRunRequest,
  trySessionRequest,
  voteRunRequest,
  voteSessionRequest,
} from "../../domain/eval-run/try-run.js";
import { agentExecutionListIndex } from "../../domain/run/list-index.js";
import {
  isActiveExecutionPhase,
  isTerminalExecutionPhase,
} from "../../domain/run/phases.js";
import { sessionIdOf } from "../../domain/run/target.js";
import {
  JUDGE_COST_CAP_REASON,
  JUDGE_NOT_FINISHED_REASON,
  JUDGE_RUN_FAILED_REASON,
  JUDGE_UNREADABLE_REASON,
} from "../../domain/score/constants.js";
import type { EvalTrace } from "../../domain/score/eval/trace.js";
import { evalTraceOf } from "../../domain/score/eval/trace.js";
import {
  runTranscriptOf,
  structuredOutputOf,
} from "../../domain/session/events/run-events.js";
import { GRADES_RUN_LABEL } from "../../domain/score/judge/judge-run.js";
import type {
  JudgeSessionDeleter,
  ScoreDeleter,
  ScoreRecorder,
} from "../../domain/score/ports.js";
import type { EvalRunCallerMint } from "../../extensions/eval-run-caller.js";
import { EvalRunCallerRefusedError } from "../../extensions/eval-run-caller.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { Store } from "../../store/interface.js";
import type { EvalCaseSource, EvalContextLoader } from "./context.js";
import {
  attachmentOf,
  cellOf,
  loadOrUndefined,
  loadRun,
  otherServersOf,
  pluginNameOf,
  sourceOf,
  specOf,
  wantedFilesOf,
} from "./context.js";
import {
  CANNOT_ACT_REASON,
  DELETE_VOTE_ACTIVITY_NAME,
  GRADE_TRY_ACTIVITY_NAME,
  EVAL_RUN_BUSY_FAILURE_TYPE,
  PLUGIN_UPDATED_REASON,
  POLL_RUN_ACTIVITY_NAME,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
  TRY_NOT_STARTED_REASON,
  TRY_SPENDING_SHARE_REASON,
  TRY_SPEND_ACTIVITY_NAME,
} from "./names.js";
import type {
  CaseActivities,
  CaseInput,
  RunPoll,
  SpendActivities,
  TryGrade,
  TryResult,
  TrySpend,
  TryStart,
  TryStopped,
  VoteRead,
  VoteStart,
  WireOutcome,
} from "./names.js";
import type { EvalRunTryLane } from "./ports.js";

/** The longest refusal a try quotes, as a criterion's reason is bounded. */
const REASON_MAX_LENGTH = 500;

/** The not-graded reason of a try whose run or eval went while it was graded. */
export const TRY_GONE_REASON = "the try's run was deleted";

/** The not-graded reason of a try whose eval no longer plans it. */
export const TRY_UNPLANNED_REASON = "the eval no longer plans this try";

/**
 * The not-graded reason of an AI-graded indicator in the without-plugin
 * arm: it scores in neither arm, so its votes are not spent where the
 * plugin is absent.
 */
export const INDICATOR_NOT_JUDGED_WITHOUT_PLUGIN_REASON =
  "an indicator is not judged without the plugin";

/** The reason a file read fails on an install with no artifact storage. */
const NO_ARTIFACT_STORAGE = "this install has no artifact storage";

export interface CaseActivityDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly contexts: EvalContextLoader;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly tries: () => EvalRunTryLane;
  /** A vote's (or a refused try's) session delete, as the server. */
  readonly sessions: () => JudgeSessionDeleter;
  readonly recorder: () => ScoreRecorder;
  readonly deleter: () => ScoreDeleter;
  /** The run artifact store's read, for offloaded file bodies; undefined when none is configured. */
  readonly readArtifact:
    | ((storageKey: string) => Promise<Uint8Array>)
    | undefined;
  /** The composed caller; undefined = tries act as the server. */
  readonly evalRunCaller: EvalRunCallerMint | undefined;
  readonly patterns: PatternRunner;
  /** The activity's attempt number; tests pin it. */
  readonly attempt?: () => number;
}

export function createCaseActivities(deps: CaseActivityDeps): CaseActivities {
  const attempt = deps.attempt ?? (() => Context.current().info.attempt);

  /** The caller for one try or vote, or the not-graded reason when the seam refuses. */
  const mint = async (
    org: string,
    evalId: string,
  ): Promise<CallerIdentity | undefined | { readonly cannotAct: string }> => {
    if (deps.evalRunCaller === undefined) {
      return undefined;
    }
    try {
      return await deps.evalRunCaller.mintEvalRunCaller(org, evalId);
    } catch (error) {
      if (error instanceof EvalRunCallerRefusedError) {
        deps.logger.warn("the eval cannot act for anyone", {
          evalId,
          reason: error.message,
        });
        return { cannotAct: error.notGradedReason ?? CANNOT_ACT_REASON };
      }
      throw error;
    }
  };

  /** The try's trace, in Claude Code's names. */
  const traceOf = async (
    source: EvalCaseSource,
    run: Run,
    graders: ReadonlyArray<EvalGrader>,
    harness: Harness,
  ): Promise<EvalTrace> =>
    evalTraceOf(await runTranscriptOf(deps.store, run), {
      pluginName: pluginNameOf(source.plugin),
      harness,
      wantedFiles: wantedFilesOf(graders),
      skillNames: new Map((source.plugin.status?.skills ?? []).map((skill) => [skill.path, skill.name])),
      readArtifact:
        deps.readArtifact ??
        (() => Promise.reject(new Error(NO_ARTIFACT_STORAGE))),
    });

  return {
    [START_TRY_ACTIVITY_NAME]: async (input): Promise<TryStart> => {
      const context = await deps.contexts(input.evalId);
      const cell =
        context === undefined
          ? undefined
          : cellOf(context, input.caseIndex, input.targetIndex);
      const source = context === undefined ? undefined : sourceOf(context, input.caseIndex);
      if (context === undefined || cell === undefined || source === undefined) {
        return {
          kind: "refused",
          failure: "not-started",
          reason: TRY_UNPLANNED_REASON,
        };
      }
      const name = tryRunName(input.evalId, input);
      const [earlier, ...extra] = await findLabelledRuns(
        deps.store,
        input.evalId,
        name,
      );
      for (const run of extra) {
        await stopRun(deps, run.metadata?.id ?? "", EXTRA_TRY_RUN_REASON);
      }
      if (earlier !== undefined) {
        return {
          kind: "started",
          sessionId: sessionIdOf(earlier.spec),
          runId: earlier.metadata?.id ?? "",
        };
      }
      const caller = await mint(input.org, input.evalId);
      if (caller !== undefined && "cannotAct" in caller) {
        return {
          kind: "refused",
          failure: "cannot-act",
          reason: caller.cannotAct,
        };
      }
      const spec = specOf(context);
      if (spec === undefined) {
        return {
          kind: "refused",
          failure: "not-started",
          reason: TRY_UNPLANNED_REASON,
        };
      }
      if (context.agent === undefined && (await pluginMoved(deps.store, source))) {
        return {
          kind: "refused",
          failure: "not-started",
          reason: PLUGIN_UPDATED_REASON,
        };
      }
      const attachment = attachmentOf(context, input.arm);
      let session;
      try {
        session = await deps.tries().createSession(
          trySessionRequest({
            org: input.org,
            evalId: input.evalId,
            cell: input,
            attempt: attempt(),
            caseName: cell.evalCase.name,
            harness: cell.target.target.harness,
            attachment,
          }),
          caller,
        );
      } catch (error) {
        if (!(error instanceof ConnectError)) {
          throw error;
        }
        return refusalOf(deps, input.evalId, error);
      }
      const sessionId = session.metadata?.id ?? "";
      const request = tryRunRequest({
        org: input.org,
        evalId: input.evalId,
        cell: input,
        sessionId,
        evalCase: cell.evalCase,
        spec,
        modelName: cell.target.runsAgentModel === true ? "" : cell.target.target.modelName,
        budgetUsd: input.budgetUsd,
        pluginServers: pluginServersOf(source.plugin),
        otherServers: otherServersOf(context, input.caseIndex),
        attachment,
        source: {
          pluginId: source.plugin.metadata?.id ?? "",
          pluginName: source.plugin.metadata?.name ?? "",
          digest: source.digest,
          suiteDir: source.suite.dir,
        },
      });
      try {
        const created = await deps.tries().createRun(request, caller);
        return {
          kind: "started",
          sessionId,
          runId: created.metadata?.id ?? "",
        };
      } catch (error) {
        if (!(error instanceof ConnectError)) {
          throw error;
        }
        await deleteSession(deps, sessionId);
        return refusalOf(deps, input.evalId, error);
      }
    },

    [POLL_RUN_ACTIVITY_NAME]: async (runId): Promise<RunPoll> =>
      runPollOf(await loadRun(deps.store, runId)),

    [STOP_RUN_ACTIVITY_NAME]: async (runId, reason): Promise<void> => {
      await stopRun(deps, runId, reason);
    },

    [GRADE_TRY_ACTIVITY_NAME]: async (
      input,
      runId,
      timedOut,
    ): Promise<TryGrade> => {
      const context = await deps.contexts(input.evalId);
      const cell =
        context === undefined
          ? undefined
          : cellOf(context, input.caseIndex, input.targetIndex);
      const source = context === undefined ? undefined : sourceOf(context, input.caseIndex);
      const run = await loadRun(deps.store, runId);
      if (context === undefined || cell === undefined || source === undefined || run === undefined) {
        return {
          outcomes: [{ notGraded: TRY_GONE_REASON }],
          error: "",
          costUsd: 0,
          durationSeconds: 0,
        };
      }
      const graders = cell.evalCase.graders;
      const stopped = timedOut ? undefined : caseStopOf(run);
      if (stopped !== undefined) {
        return {
          outcomes: graders.map(() => ({ notGraded: stoppedWhy(stopped) })),
          stopped,
          error: "",
          costUsd: run.status?.streamingUsage?.estimatedCostUsd ?? 0,
          durationSeconds: durationOf(run),
        };
      }
      if (!timedOut && stoppedAtItsShare(run, input.budgetUsd)) {
        return {
          outcomes: graders.map(() => ({ notGraded: TRY_SPENDING_SHARE_REASON })),
          error: runErrorOf(run, timedOut, input.timeoutSeconds),
          costUsd: run.status?.streamingUsage?.estimatedCostUsd ?? 0,
          durationSeconds: durationOf(run),
        };
      }
      const trace = await traceOf(
        source,
        run,
        graders,
        cell.target.target.harness,
      );
      const checked = await gradeChecks(
        graders,
        trace,
        patternsFor(deps.patterns, input.evalId),
      );
      const scoring = scoringOf(graders, context.twoArms);
      const outcomes: WireOutcome[] = checked.map((outcome, index) => {
        const grader = graders[index];
        if (
          outcome !== "votes" ||
          grader === undefined ||
          !isJudgedGrader(grader)
        ) {
          return outcome === "votes" ? { notGraded: TRY_GONE_REASON } : outcome;
        }
        if (input.arm === "without" && scoring[index]?.scored === false) {
          return { notGraded: INDICATOR_NOT_JUDGED_WITHOUT_PLUGIN_REASON };
        }
        const evidence = voteEvidence(grader.check, trace);
        if (!("text" in evidence)) {
          return evidence;
        }
        if (grader.check.type === "baseline") {
          const reference = referenceTranscript(
            source.files,
            cell.evalCase.dir,
            grader.check.baselineFile,
          );
          if (!("text" in reference)) {
            return reference;
          }
        }
        return { votes: voteRubricName(grader) };
      });
      return {
        outcomes,
        error: runErrorOf(run, timedOut, input.timeoutSeconds),
        costUsd: run.status?.streamingUsage?.estimatedCostUsd ?? 0,
        durationSeconds: durationOf(run),
      };
    },

    [START_VOTE_ACTIVITY_NAME]: async (
      input,
      runId,
      graderIndex,
      voteIndex,
    ): Promise<VoteStart> => {
      const context = await deps.contexts(input.evalId);
      const cell =
        context === undefined
          ? undefined
          : cellOf(context, input.caseIndex, input.targetIndex);
      const grader = cell?.evalCase.graders[graderIndex];
      const source = context === undefined ? undefined : sourceOf(context, input.caseIndex);
      const run = await loadRun(deps.store, runId);
      if (
        context === undefined ||
        cell === undefined ||
        source === undefined ||
        grader === undefined ||
        run === undefined ||
        !isJudgedGrader(grader)
      ) {
        return { kind: "failed", reason: TRY_GONE_REASON };
      }
      const existing = await findVoteRun(
        deps.store,
        input.org,
        runId,
        graderIndex,
        voteIndex,
      );
      if (existing !== undefined) {
        return { kind: "started", voteRunId: existing };
      }
      const trace = await traceOf(
        source,
        run,
        cell.evalCase.graders,
        cell.target.target.harness,
      );
      const evidence = voteEvidence(grader.check, trace);
      if (!("text" in evidence)) {
        return {
          kind: "failed",
          reason:
            "notGraded" in evidence ? evidence.notGraded : evidence.reason,
        };
      }
      let reference: string | undefined;
      if (grader.check.type === "baseline") {
        const rendered = referenceTranscript(
          source.files,
          cell.evalCase.dir,
          grader.check.baselineFile,
        );
        if (!("text" in rendered)) {
          return { kind: "failed", reason: rendered.notGraded };
        }
        reference = rendered.text;
      }
      const caller = await mint(input.org, input.evalId);
      if (caller !== undefined && "cannotAct" in caller) {
        return { kind: "failed", reason: caller.cannotAct };
      }
      const rubric = voteRubricName(grader);
      let session;
      try {
        session = await deps.tries().createSession(
          voteSessionRequest({
            org: input.org,
            evalId: input.evalId,
            tryRunId: runId,
            graderIndex,
            voteIndex,
            attempt: attempt(),
          }),
          caller,
        );
      } catch (error) {
        if (!(error instanceof ConnectError)) {
          throw error;
        }
        return voteRefusalOf(refusalOf(deps, input.evalId, error));
      }
      const sessionId = session.metadata?.id ?? "";
      const request = voteRunRequest({
        org: input.org,
        evalId: input.evalId,
        tryRunId: runId,
        sessionId,
        graderIndex,
        voteIndex,
        judgeModel: specOf(context)?.judgeModel ?? "",
        message: voteMessage({
          rubric,
          check: grader.check,
          evidenceLabel: evidence.label,
          evidence: evidence.text,
          ...(reference === undefined ? {} : { reference }),
        }),
        schema: voteSchema(rubric, rubricText(grader.check)),
      });
      try {
        const created = await deps.tries().createRun(request, caller);
        return { kind: "started", voteRunId: created.metadata?.id ?? "" };
      } catch (error) {
        if (!(error instanceof ConnectError)) {
          throw error;
        }
        await deleteSession(deps, sessionId);
        return voteRefusalOf(refusalOf(deps, input.evalId, error));
      }
    },

    [READ_VOTE_ACTIVITY_NAME]: async (voteRunId, rubric): Promise<VoteRead> => {
      const vote = await loadRun(deps.store, voteRunId);
      if (vote === undefined) {
        return {
          vote: { kind: "failed", reason: JUDGE_RUN_FAILED_REASON },
          costUsd: 0,
        };
      }
      const phase = vote.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
      if (isActiveExecutionPhase(phase)) {
        await stopRun(deps, voteRunId, JUDGE_NOT_FINISHED_REASON);
      }
      const costUsd = vote.status?.streamingUsage?.estimatedCostUsd ?? 0;
      let read: VoteRead["vote"];
      switch (phase) {
        case RunPhase.RUN_COMPLETED: {
          const answer = await structuredOutputOf(deps.store, vote);
          const reading = readVote(answer, rubric);
          if ("refused" in reading) {
            deps.logger.warn("a vote's answer could not be read", {
              voteRunId,
              cause: reading.refused,
              answer: describeVoteAnswer(answer, rubric),
            });
            read = { kind: "failed", reason: JUDGE_UNREADABLE_REASON };
          } else {
            read = {
              kind: "vote",
              passed: reading.passed,
              reason: reading.reason,
            };
          }
          break;
        }
        case RunPhase.RUN_TERMINATED:
          read = { kind: "failed", reason: JUDGE_COST_CAP_REASON };
          break;
        case RunPhase.RUN_FAILED:
        case RunPhase.RUN_CANCELLED:
          read = { kind: "failed", reason: JUDGE_RUN_FAILED_REASON };
          break;
        default:
          read = { kind: "failed", reason: JUDGE_NOT_FINISHED_REASON };
      }
      return { vote: read, costUsd };
    },

    [DELETE_VOTE_ACTIVITY_NAME]: async (voteRunId): Promise<void> => {
      const vote = await loadRun(deps.store, voteRunId);
      const sessionId = vote === undefined ? "" : sessionIdOf(vote.spec);
      if (sessionId === "") {
        return;
      }
      try {
        await deps.sessions().delete(sessionId);
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return;
        }
        throw error;
      }
    },

    [RECORD_SCORE_ACTIVITY_NAME]: async (
      input,
      started,
      grade,
      votes,
    ): Promise<TryResult> => {
      const context = await deps.contexts(input.evalId);
      const cell =
        context === undefined
          ? undefined
          : cellOf(context, input.caseIndex, input.targetIndex);
      const source = context === undefined ? undefined : sourceOf(context, input.caseIndex);
      const base = {
        sessionId: started.sessionId,
        runId: started.runId,
        error: grade.error,
        costUsd: grade.costUsd,
        durationSeconds: grade.durationSeconds,
      };
      if (context === undefined || cell === undefined || source === undefined) {
        return {
          ...base,
          state: "not-graded",
          score: 0,
          notGradedReason: TRY_GONE_REASON,
        };
      }
      const graders = cell.evalCase.graders;
      const run = await loadRun(deps.store, started.runId);
      if (grade.stopped !== undefined) {
        const { stopped } = grade;
        if (run !== undefined) {
          await writeScore(deps, run, () =>
            stoppedEvalScore(run, source.digest, graders, stoppedWhy(stopped)),
          );
        }
        return {
          ...base,
          state: "graded",
          score: 0,
          notGradedReason: "",
          ...(stopped.kind === "scaffold-failed"
            ? { error: `scaffold failed: ${stopped.detail}` }
            : { aborted: { server: stopped.server, tool: stopped.tool, reason: stopped.reason } }),
        };
      }
      const verdicts: GraderVerdict[] = graders.map((_, index) => {
        const outcome = grade.outcomes[index];
        if (outcome === undefined) {
          return { notGraded: TRY_GONE_REASON };
        }
        return "votes" in outcome ? tallyVotes(votes[index] ?? []) : outcome;
      });
      const scoring = scoringOf(graders, context.twoArms);
      // An indicator counts toward no score, so one left not graded is
      // reported on its own criterion and never voids the try.
      const failed = verdicts.find(
        (verdict, index): verdict is { readonly notGraded: string } =>
          isNotGraded(verdict) && scoring[index]?.scored !== false,
      );
      if (failed !== undefined) {
        if (run !== undefined) {
          await writeScore(deps, run, () =>
            notGradedEvalScore(run, source.digest, failed.notGraded),
          );
        }
        return {
          ...base,
          state: "not-graded",
          score: 0,
          notGradedReason: failed.notGraded,
        };
      }
      const score = tryScore(
        verdicts.map((verdict) => !isNotGraded(verdict) && verdict.passed),
        scoring,
      );
      if (run !== undefined) {
        await writeScore(deps, run, () =>
          gradedEvalScore(run, source.digest, {
            graders,
            scoring,
            verdicts,
          }),
        );
      }
      return {
        ...base,
        state: "graded",
        score,
        notGradedReason: "",
      };
    },
  };
}

/** A vote's answer to a refused create: failed with the refusal's reason. */
function voteRefusalOf(
  refusal: Extract<TryStart, { kind: "refused" }>,
): VoteStart {
  return { kind: "failed", reason: refusal.reason };
}

/**
 * The start's answer to a refused create, of the session or the run (the
 * module header). A capacity refusal is thrown for the workflow's retry
 * policy.
 */
function refusalOf(
  deps: CaseActivityDeps,
  evalId: string,
  error: ConnectError,
): Extract<TryStart, { kind: "refused" }> {
  switch (error.code) {
    case Code.ResourceExhausted:
      throw ApplicationFailure.retryable(
        error.rawMessage,
        EVAL_RUN_BUSY_FAILURE_TYPE,
      );
    case Code.FailedPrecondition:
    case Code.PermissionDenied:
    case Code.NotFound:
    case Code.InvalidArgument:
    case Code.Unauthenticated: {
      deps.logger.warn("an eval run's try was refused", {
        evalId,
        code: Code[error.code],
        reason: error.rawMessage,
      });
      const reason =
        error.rawMessage === "" ? TRY_NOT_STARTED_REASON : error.rawMessage;
      return {
        kind: "refused",
        failure: "not-started",
        reason: reason.slice(0, REASON_MAX_LENGTH),
      };
    }
    default:
      throw error;
  }
}

/**
 * The spend activity (names.ts TRY_SPEND_ACTIVITY_NAME): the try's run by
 * the eval's label and its run name, its estimated cost, and the cost of
 * each of its votes still stored (a vote that was read has had its session,
 * and so its run, deleted, and its cost was reported with the try). No run
 * found is no spend.
 */
export function createSpendActivities(deps: {
  readonly store: Store;
}): SpendActivities {
  return {
    [TRY_SPEND_ACTIVITY_NAME]: async (evalId, cell): Promise<TrySpend> => {
      const [run] = await findLabelledRuns(
        deps.store,
        evalId,
        tryRunName(evalId, cell),
      );
      if (run === undefined) {
        return { sessionId: "", runId: "", costUsd: 0 };
      }
      const runId = run.metadata?.id ?? "";
      const rows = await deps.store.queryResources(agentExecutionListIndex, {
        org: run.metadata?.org ?? "",
        anyKey: [{ name: "grades", value: runId }],
      });
      let costUsd = run.status?.streamingUsage?.estimatedCostUsd ?? 0;
      for (const row of rows) {
        const vote = fromBinary(RunSchema, row.data);
        if (vote.metadata?.labels[GRADES_RUN_LABEL] === runId) {
          costUsd += vote.status?.streamingUsage?.estimatedCostUsd ?? 0;
        }
      }
      return { sessionId: sessionIdOf(run.spec), runId, costUsd };
    },
  };
}

/** The reason start-try stops a second run of the same try with. */
const EXTRA_TRY_RUN_REASON = "a second run of the same try";

/**
 * The runs earlier attempts of a try's start created, by label and name,
 * the earliest created first (its id breaking a tie), so the start's
 * adoption and every spend read pick the same one. More than one is a
 * start that raced its own retry; start-try stops the rest. The eval's
 * runs are read through the run list index's `eval_run` key, so only
 * they are decoded, never every run of the platform.
 */
/** Whether a plugin's head has moved past the digest the eval run stamped for it; a plugin gone has moved. */
async function pluginMoved(store: Store, source: EvalCaseSource): Promise<boolean> {
  const head = await loadOrUndefined(store, ApiResourceKind.plugin, source.plugin.metadata?.id ?? "", PluginSchema);
  return (head?.status?.digest ?? "") !== source.digest;
}

async function findLabelledRuns(
  store: Store,
  evalId: string,
  name: string,
): Promise<Run[]> {
  const rows = await store.queryResources(agentExecutionListIndex, {
    anyKey: [{ name: "eval_run", value: evalId }],
  });
  const runs = rows
    .map((row) => fromBinary(RunSchema, row.data))
    .filter((run) => run.metadata?.name === name);
  const createdMs = (run: Run): number => {
    const at = run.status?.audit?.specAudit?.createdAt;
    return at === undefined ? 0 : timestampMs(at);
  };
  return runs.sort(
    (a, b) =>
      createdMs(a) - createdMs(b) ||
      (a.metadata?.id ?? "").localeCompare(b.metadata?.id ?? ""),
  );
}

/** The vote run an earlier attempt created, through the run list index's `grades` key. */
async function findVoteRun(
  store: Store,
  org: string,
  tryRunId: string,
  graderIndex: number,
  voteIndex: number,
): Promise<string | undefined> {
  const name = voteRunRequest({
    org,
    evalId: "",
    tryRunId,
    sessionId: "",
    graderIndex,
    voteIndex,
    judgeModel: "",
    message: "",
    schema: {},
  }).metadata?.name;
  const rows = await store.queryResources(agentExecutionListIndex, {
    org,
    anyKey: [{ name: "grades", value: tryRunId }],
  });
  for (const row of rows) {
    const found = fromBinary(RunSchema, row.data);
    if (
      found.metadata?.name === name &&
      found.metadata?.labels[GRADES_RUN_LABEL] === tryRunId
    ) {
      return row.id;
    }
  }
  return undefined;
}

/**
 * Stops a run; one already ended or gone is fine. The run's lifecycle
 * refuses a stop with FailedPrecondition both for a run that has ended and
 * for one paused or waiting for approval, so the refusal is read against
 * the run's phase: ended or gone is stopped, anything else is a stop that
 * failed, thrown for the caller's not-stopped path.
 */
async function stopRun(
  deps: CaseActivityDeps,
  runId: string,
  reason: string,
): Promise<void> {
  try {
    await deps.tries().terminateRun(runId, reason);
  } catch (error) {
    if (!(error instanceof ConnectError)) {
      throw error;
    }
    if (error.code === Code.NotFound) {
      return;
    }
    if (error.code === Code.FailedPrecondition) {
      const run = await loadRun(deps.store, runId);
      if (
        run === undefined ||
        isTerminalExecutionPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)
      ) {
        return;
      }
    }
    throw error;
  }
}

/** Deletes a session; a delete that fails is logged and the session left, never thrown. */
async function deleteSession(
  deps: CaseActivityDeps,
  sessionId: string,
): Promise<void> {
  if (sessionId === "") {
    return;
  }
  try {
    await deps.sessions().delete(sessionId);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return;
    }
    deps.logger.error(
      "an eval run's session could not be deleted; it is left",
      {
        sessionId,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/** Writes the try's Score when its run has ended; a score the run cannot take is logged. */
async function writeScore(
  deps: CaseActivityDeps,
  run: Run,
  build: () => ReturnType<typeof gradedEvalScore>,
): Promise<void> {
  if (
    !isTerminalExecutionPhase(
      run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
    )
  ) {
    deps.logger.warn(
      "a try's run has not ended; its score is kept on the eval only",
      {
        runId: run.metadata?.id ?? "",
      },
    );
    return;
  }
  await writeEvalScore(
    {
      store: deps.store,
      logger: deps.logger,
      recorder: deps.recorder(),
      deleter: deps.deleter(),
    },
    build(),
  );
}

/** How far under the try's budget a capped run's estimated cost may stop and still be the budget's stop. */
const SHARE_MARGIN_USD = 0.01;

/**
 * Whether the try's own budget stopped the run: a cost-cap stop (the try
 * stop the runner writes and `@stigmer/eval-runtime` `parseTryStop` reads,
 * the one way a run tells that stop from the platform's others, since its
 * status names no termination reason) with the run's estimated cost within a cent of
 * `budgetUsd`, or, for a budget no larger than that cent (the floor), at
 * the budget itself. The run's cap is the tightest of its layers, so a
 * stop below the budget was a lower cap's (the agent's own, its
 * profile's).
 */
function stoppedAtItsShare(run: Run, budgetUsd: number): boolean {
  const reached =
    budgetUsd > SHARE_MARGIN_USD ? budgetUsd - SHARE_MARGIN_USD : budgetUsd;
  return (
    run.status?.phase === RunPhase.RUN_TERMINATED &&
    parseTryStop(run.status.error ?? "")?.kind === "cost-limit" &&
    (run.status.streamingUsage?.estimatedCostUsd ?? 0) >= reached
  );
}

/**
 * The stop a try's case made, when the run carries one: the scaffold failed
 * before the engine started, or a mock stopped the run (the runner writes
 * the sentence, `@stigmer/eval-runtime` `formatTryStop`). A cost-limit stop
 * is the budget's, read by `stoppedAtItsShare`.
 */
function caseStopOf(run: Run): TryStopped | undefined {
  const stop = parseTryStop(run.status?.error ?? "");
  switch (stop?.kind) {
    case "scaffold-failed":
      return { kind: "scaffold-failed", detail: stop.detail };
    case "mock-aborted":
      return { kind: "mock-aborted", server: stop.server, tool: stop.tool, reason: stop.reason };
    case "cost-limit":
    case undefined:
      return undefined;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = stop;
      return exhausted;
    }
  }
}

/** Why a stopped try's graders were not checked, as each criterion says it. */
function stoppedWhy(stopped: TryStopped): string {
  return stopped.kind === "scaffold-failed" ? "the scaffold failed" : `aborted by ${stopped.server}.${stopped.tool}`;
}

/** The run's own failure, in the format's words (the module header). */
function runErrorOf(
  run: Run,
  timedOut: boolean,
  timeoutSeconds: number,
): string {
  if (timedOut) {
    return `timed out after ${timeoutSeconds}s`;
  }
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (phase === RunPhase.RUN_COMPLETED) {
    return "";
  }
  const detail = (run.status?.error ?? "").slice(0, REASON_MAX_LENGTH);
  if (detail !== "") {
    return detail;
  }
  switch (phase) {
    case RunPhase.RUN_TERMINATED:
      return "the run was stopped before it finished";
    case RunPhase.RUN_FAILED:
      return "the run failed";
    case RunPhase.RUN_CANCELLED:
      return "the run was cancelled";
    default:
      return "the run did not finish";
  }
}

/**
 * A run's progress (names.ts RunPoll): ended once its phase is terminal or
 * it is gone; pending while it is pending (or carries no phase yet) with
 * no start stamp, since no runner has taken it; running otherwise.
 */
function runPollOf(run: Run | undefined): RunPoll {
  if (run === undefined) {
    return { phase: "ended", startedAtMs: 0 };
  }
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  const stamp = Date.parse(run.status?.startedAt ?? "");
  const startedAtMs = Number.isNaN(stamp) ? 0 : stamp;
  if (isTerminalExecutionPhase(phase)) {
    return { phase: "ended", startedAtMs };
  }
  const waiting =
    phase === RunPhase.RUN_PENDING || phase === RunPhase.RUN_PHASE_UNSPECIFIED;
  return { phase: waiting && startedAtMs === 0 ? "pending" : "running", startedAtMs };
}

/** How long the run ran, from its start and end stamps; 0 when either is missing. */
function durationOf(run: Run): number {
  const started = Date.parse(run.status?.startedAt ?? "");
  const ended = Date.parse(run.status?.completedAt ?? "");
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) {
    return 0;
  }
  return (ended - started) / 1000;
}
