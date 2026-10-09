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
