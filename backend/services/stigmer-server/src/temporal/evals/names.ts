/**
 * Plugin evals' Temporal wire identifiers. Every value is a byte-pinned
 * wire constant from its first commit: a workflow in flight across a
 * release is addressed by these exact strings, and a rename strands it.
 *
 * Imported by BOTH the workflow bundle and host code: no node built-ins,
 * no framework imports (the workflow-bundle import discipline,
 * temporal/README.md).
 */

/** The suite workflow's registered type: one PluginEval, run whole. */
export const RUN_PLUGIN_EVAL_WORKFLOW_TYPE = "stigmer/evals/run-plugin-eval";

/**
 * The suite workflow's id, `plugin-eval/<eval id>`. Create starts it under
 * this id, so a retried start finds the workflow already running.
 */
export function runPluginEvalWorkflowId(evalId: string): string {
  return `plugin-eval/${evalId}`;
}

/** The suite workflow's input: the eval to run. */
export interface RunPluginEvalInput {
  readonly evalId: string;
}

/** The case workflow's registered type: one try, started, polled, graded. */
export const RUN_CASE_WORKFLOW_TYPE = "stigmer/evals/run-case";

/**
 * A try's workflow id, unique per eval and cell:
 * `plugin-eval/<eval id>/<case index>/<target index>/<arm>/<try index>`.
 */
export function runCaseWorkflowId(
  evalId: string,
  caseIndex: number,
  targetIndex: number,
  arm: "with" | "without",
  tryIndex: number,
): string {
  return `plugin-eval/${evalId}/${caseIndex}/${targetIndex}/${arm}/${tryIndex}`;
}

/**
 * Reads the eval and its suite, plans the matrix, and writes the status
 * skeleton (every case, target and try, each not-run reason).
 */
export const LOAD_SUITE_ACTIVITY_NAME = "stigmer/evals/load-suite";

/** Folds one finished try into the eval's status and recomputes its scores. */
export const RECORD_TRY_ACTIVITY_NAME = "stigmer/evals/record-try";

/** Ends the eval: completed, or partial with its reason. */
export const FINISH_EVAL_ACTIVITY_NAME = "stigmer/evals/finish-eval";

/** Creates a try's session and run, as the eval's caller. */
export const START_TRY_ACTIVITY_NAME = "stigmer/evals/start-try";

/** Reads whether a run (a try's or a vote's) has ended. */
export const POLL_RUN_ACTIVITY_NAME = "stigmer/evals/poll-run";

/** Stops a run that outlived its time. */
export const STOP_RUN_ACTIVITY_NAME = "stigmer/evals/stop-run";

/** Runs the code graders over the try's trace and prepares the AI-graded ones. */
export const GRADE_TRY_ACTIVITY_NAME = "stigmer/evals/grade-try";

/** Creates one vote of an AI-graded check, as the eval's caller. */
export const START_VOTE_ACTIVITY_NAME = "stigmer/evals/start-vote";

/** Reads one vote, stops it if still going, and deletes its session. */
export const READ_VOTE_ACTIVITY_NAME = "stigmer/evals/read-vote";

/** Scores the try and writes its Score on the try's run. */
export const RECORD_SCORE_ACTIVITY_NAME = "stigmer/evals/record-score";

/**
 * Reads what a try's run spent, with any of its votes still stored, found
 * by the eval's label and the try's run name: the cost of a try whose own
 * workflow could not report it (a grading that failed, a stop that failed,
 * a case workflow that failed outright).
 */
export const TRY_SPEND_ACTIVITY_NAME = "stigmer/evals/try-spend";

/**
 * The failure type a start activity throws while the platform refuses a
 * try or a vote for capacity, so the workflow tells "busy" from every
 * other failure once the retries are spent.
 */
export const PLUGIN_EVAL_BUSY_FAILURE_TYPE = "PluginEvalBusy";

/** The not-graded reasons the workflows give without an activity. */
export const PLATFORM_BUSY_REASON = "platform busy";
export const OUT_OF_CREDIT_REASON = "out of credit";
export const CANNOT_ACT_REASON =
  "the eval cannot act for anyone in this organization";
export const TRY_NOT_STARTED_REASON = "the try could not start";
export const GRADING_FAILED_REASON = "grading failed";
export const TRY_FAILED_REASON = "the try could not be run";
export const TRY_NOT_STOPPED_REASON = "the try's run could not be stopped";

/** The failed eval's error when the suite workflow could not plan it (its load past every retry). */
export const EVAL_NOT_PLANNED_ERROR = "the eval could not be planned";

/** The failed eval's error when a finished try could not be recorded past every retry. */
export const TRY_NOT_RECORDED_ERROR = "a try's result could not be recorded";

/**
 * The not-graded reason of a try that would have started after the
 * plugin's version moved: the with-plugin arm runs the plugin as installed
 * now, so the try would grade a newer plugin against the eval's suite.
 */
export const PLUGIN_UPDATED_REASON = "the plugin was updated during the eval";

/** The case note an eval carries once one of the case's tries met an updated plugin. */
export const PLUGIN_UPDATED_NOTE =
  "the plugin was updated during the eval: the tries that would have started after the update are not graded";

/** One try the suite runs: its cell, and how long it may take. */
export interface SuiteCell {
  readonly caseIndex: number;
  readonly targetIndex: number;
  readonly arm: "with" | "without";
  readonly tryIndex: number;
  readonly timeoutSeconds: number;
}

/** What the load answers: the cells to run, or nothing (the eval is gone, failed or ended). */
export type SuitePlan =
  | {
      readonly kind: "run";
      readonly org: string;
      readonly cells: ReadonlyArray<SuiteCell>;
      readonly maxCostUsd: number;
      readonly concurrency: number;
    }
  | { readonly kind: "stop" };

/** Why an eval stopped early, in the workflow's words. */
export type SuiteStop = "cost_ceiling" | "out_of_credit" | "cancelled";

/** How the eval ends; failed when one of the suite workflow's own steps could not be done. */
export type SuiteEnd =
  | { readonly phase: "completed" }
  | { readonly phase: "partial"; readonly reason: SuiteStop }
  | { readonly phase: "failed"; readonly error: string };

/**
 * The least a try's run is capped at. A run's cap of 0 means no cap
 * (run/v1/invocation.proto `max_cost_usd`), so what is left of the eval's
 * budget is never passed below this.
 */
export const TRY_MIN_BUDGET_USD = 0.01;

/** The case workflow's input: one try of one eval. */
export interface CaseInput extends SuiteCell {
  readonly evalId: string;
  readonly org: string;
  /**
   * The try's run's spending cap: the eval's `max_cost_usd` less what its
   * finished tries spent when this one started, at least
   * TRY_MIN_BUDGET_USD. Set by the suite workflow, so a replay passes the
   * same.
   */
  readonly budgetUsd: number;
}

/** What a try's run spent, as the spend activity found it; empty ids when no run was found. */
export interface TrySpend {
  readonly sessionId: string;
  readonly runId: string;
  readonly costUsd: number;
}

/** Why a try did not start. */
export type TryFailure = "out-of-credit" | "cannot-act" | "not-started";

/** The start's answer. */
export type TryStart =
  | {
      readonly kind: "started";
      readonly sessionId: string;
      readonly runId: string;
    }
  | {
      readonly kind: "refused";
      readonly failure: TryFailure;
      readonly reason: string;
    };

/** A grader's verdict on the wire: passed or failed with a reason, or not graded. */
export type WireVerdict =
  | { readonly passed: boolean; readonly reason: string }
  | { readonly notGraded: string };

/** A grader's outcome after the code graders ran: a verdict, or votes to take. */
export type WireOutcome = WireVerdict | { readonly votes: string };

/** What grading the try's run found. */
export interface TryGrade {
  /** One per grader, in order; `votes` names the rubric the AI-graded ones answer. */
  readonly outcomes: ReadonlyArray<WireOutcome>;
  /** The run's own failure, as "timed out after 300s"; empty when it completed. */
  readonly error: string;
  readonly costUsd: number;
  readonly durationSeconds: number;
}

/** A vote's start. */
export type VoteStart =
  | { readonly kind: "started"; readonly voteRunId: string }
  | { readonly kind: "failed"; readonly reason: string };

/** One vote as read, with what it spent. */
export interface VoteRead {
  readonly vote:
    | {
        readonly kind: "vote";
        readonly passed: boolean;
        readonly reason: string;
      }
    | { readonly kind: "failed"; readonly reason: string };
  readonly costUsd: number;
}

/** One grader's result, as the try reports it to the suite. */
export interface GraderResult {
  readonly name: string;
  readonly scored: boolean;
  readonly verdict: WireVerdict;
}

/** A try's result, which the suite folds into the eval's status. */
export interface TryResult {
  readonly sessionId: string;
  readonly runId: string;
  readonly state: "graded" | "not-graded";
  readonly score: number;
  readonly notGradedReason: string;
  readonly error: string;
  readonly costUsd: number;
  readonly durationSeconds: number;
  readonly graderResults: ReadonlyArray<GraderResult>;
  /** The organization's credit refused the try: the suite stops starting tries. */
  readonly outOfCredit: boolean;
}

/**
 * A try's result as the record activity takes it: everything the status
 * holds, without the grader results it never reads, so the suite
 * workflow's history carries them once (the child's result), not twice.
 */
export type RecordedTry = Omit<TryResult, "graderResults">;

/** The suite workflow's activities, keyed by the pinned names. */
export interface SuiteActivities {
  [LOAD_SUITE_ACTIVITY_NAME]: (evalId: string) => Promise<SuitePlan>;
  [RECORD_TRY_ACTIVITY_NAME]: (
    evalId: string,
    cell: SuiteCell,
    result: RecordedTry,
  ) => Promise<void>;
  [FINISH_EVAL_ACTIVITY_NAME]: (evalId: string, end: SuiteEnd) => Promise<void>;
}

/** The spend activity, which both workflows call. */
export interface SpendActivities {
  [TRY_SPEND_ACTIVITY_NAME]: (
    evalId: string,
    cell: Pick<SuiteCell, "caseIndex" | "targetIndex" | "arm" | "tryIndex">,
  ) => Promise<TrySpend>;
}

/** The case workflow's activities, keyed by the pinned names. */
export interface CaseActivities {
  [START_TRY_ACTIVITY_NAME]: (input: CaseInput) => Promise<TryStart>;
  [POLL_RUN_ACTIVITY_NAME]: (runId: string) => Promise<boolean>;
  [STOP_RUN_ACTIVITY_NAME]: (runId: string, reason: string) => Promise<void>;
  [GRADE_TRY_ACTIVITY_NAME]: (
    input: CaseInput,
    runId: string,
    timedOut: boolean,
  ) => Promise<TryGrade>;
  [START_VOTE_ACTIVITY_NAME]: (
    input: CaseInput,
    runId: string,
    graderIndex: number,
    voteIndex: number,
  ) => Promise<VoteStart>;
  [READ_VOTE_ACTIVITY_NAME]: (
    voteRunId: string,
    rubric: string,
  ) => Promise<VoteRead>;
  [RECORD_SCORE_ACTIVITY_NAME]: (
    input: CaseInput,
    started: { readonly sessionId: string; readonly runId: string },
    grade: TryGrade,
    /** Per grader, in order: the votes of an AI-graded check, empty for the others. */
    votes: ReadonlyArray<ReadonlyArray<VoteRead["vote"]>>,
  ) => Promise<TryResult>;
}
