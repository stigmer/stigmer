/**
 * Grading's Temporal wire identifiers. Every value is a byte-pinned wire
 * constant from its first commit: a workflow in flight across a release
 * is addressed by these exact strings, and a rename strands it.
 *
 * Imported by BOTH the workflow bundle and host code: no node built-ins,
 * no framework imports (the workflow-bundle import discipline,
 * temporal/README.md).
 */

/** The grading workflow's registered type: one completed run, graded. */
export const GRADE_RUN_WORKFLOW_TYPE = "stigmer/grading/grade-run";

/**
 * The workflow id of a run's grading, `grade-run/<run id>`. Started with a
 * reuse policy that refuses duplicates, so a run is graded once: a
 * completed run never completes again (domain/run/update-status.ts).
 */
export function gradeRunWorkflowId(runId: string): string {
  return `grade-run/${runId}`;
}

/** Grades the run with the run-health checks and records the score. */
export const GRADE_RUN_HEALTH_ACTIVITY_NAME =
  "stigmer/grading/grade-run-health";

/** Records a not-graded run-health score when grading failed. */
export const RECORD_NOT_GRADED_ACTIVITY_NAME =
  "stigmer/grading/record-not-graded";

/**
 * What a grading activity did. String-typed so the JSON data converter
 * records it stably; the values are recorded-history contract.
 */
export type GradeOutcome = "RECORDED" | "ALREADY_GRADED" | "RUN_GONE";

export const GRADE_RECORDED = "RECORDED" satisfies GradeOutcome;
export const GRADE_ALREADY_GRADED = "ALREADY_GRADED" satisfies GradeOutcome;
export const GRADE_RUN_GONE = "RUN_GONE" satisfies GradeOutcome;

/** The not-graded reason the workflow records when grading failed. */
export const GRADING_FAILED_REASON = "grading failed";

/** The activity surface the workflow proxies, keyed by the pinned names. */
export interface GradingActivities {
  [GRADE_RUN_HEALTH_ACTIVITY_NAME]: (runId: string) => Promise<GradeOutcome>;
  [RECORD_NOT_GRADED_ACTIVITY_NAME]: (
    runId: string,
    reason: string,
  ) => Promise<GradeOutcome>;
}

/**
 * The patch marker of the AI judge's branch in the grading workflow: an
 * execution started before the judge existed replays without it and ends
 * after run health, as it always did.
 */
export const GRADE_RUN_JUDGE_PATCH = "grade-run-judge";

/**
 * Decides whether the run's agent has AI grading on and the run is in its
 * sample, sets the grade's cap aside, and records the run as pending.
 */
export const PLAN_JUDGE_ACTIVITY_NAME = "stigmer/grading/plan-judge";

/** Creates the judge run, as the grading caller. */
export const START_JUDGE_ACTIVITY_NAME = "stigmer/grading/start-judge";

/** Reads whether the judge run has ended. */
export const POLL_JUDGE_ACTIVITY_NAME = "stigmer/grading/poll-judge";

/**
 * Records the judge's grade or the reason there is none, settles the
 * budget, and deletes the judge's session.
 */
export const RECORD_JUDGE_ACTIVITY_NAME = "stigmer/grading/record-judge";

/**
 * The failure type the start activity throws while the platform refuses
 * the judge run for capacity, so the workflow can tell "busy" from every
 * other failure once the activity's retries are spent.
 */
export const JUDGE_BUSY_FAILURE_TYPE = "JudgeBusy";

/** What a grade the planner set up carries to the later activities. */
export interface JudgeTicket {
  readonly evaluatorId: string;
  /** The judge's model; empty for the platform's default. */
  readonly modelName: string;
  /** The cap the planner set aside, given back when the grade settles. */
  readonly capUsd: number;
}

/**
 * The planner's answer: nothing to do (no evaluator, not sampled, a judge
 * run, already graded), already recorded (the limit refused the grade), or
 * a grade to run. String-tagged for the JSON data converter.
 */
export type JudgePlan =
  | { readonly kind: "skip" }
  | { readonly kind: "recorded" }
  | { readonly kind: "grade"; readonly ticket: JudgeTicket };

/**
 * Why a judge produced no verdict, as the workflow knows it; the record
 * activity turns each into the reason the person reads. Empty: the judge
 * run ended, and its own phase and answer decide.
 */
export type JudgeFailure =
  | ""
  | "busy"
  | "cannot-act"
  | "out-of-credit"
  | "not-started"
  | "not-finished";

/** The start activity's answer: the judge run, or a refusal no retry changes. */
export type JudgeStart =
  | { readonly kind: "started"; readonly judgeRunId: string }
  | { readonly kind: "refused"; readonly failure: JudgeFailure };

/** The judge's activity surface, keyed by the pinned names. */
export interface JudgeActivities {
  [PLAN_JUDGE_ACTIVITY_NAME]: (runId: string) => Promise<JudgePlan>;
  [START_JUDGE_ACTIVITY_NAME]: (
    runId: string,
    ticket: JudgeTicket,
  ) => Promise<JudgeStart>;
  [POLL_JUDGE_ACTIVITY_NAME]: (judgeRunId: string) => Promise<boolean>;
  [RECORD_JUDGE_ACTIVITY_NAME]: (
    runId: string,
    ticket: JudgeTicket,
    judgeRunId: string,
    failure: JudgeFailure,
  ) => Promise<GradeOutcome>;
}
