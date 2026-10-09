/**
 * Score domain constants: the measures M1 writes and the refusal copy the
 * create and update chains answer with. The copy is wire contract: the
 * console and the CLI show it as given, and the conformance suite pins
 * it.
 */

/** A person's thumbs on a run's final answer. */
export const FEEDBACK_METRIC = "feedback";

/** The platform's free checks on a completed run (checks/). */
export const RUN_HEALTH_METRIC = "run-health";

/** The refusal of a person's source from anyone but a first-party person. */
export const HUMAN_SOURCE_REFUSED_MESSAGE =
  "only a person can rate a run with their own sign-in or API key";

/** The refusal of a check's source from anyone but the server itself. */
export const CHECK_SOURCE_REFUSED_MESSAGE =
  "run-health scores are written by the platform's checks, never through the API";

/** The create lane's deny copy when the caller cannot see the run. */
export const SCORE_CREATE_DENIED_MESSAGE = "unauthorized to score run";

/** The refusal of a metric the source does not give. */
export const SCORE_METRIC_SOURCE_MISMATCH_MESSAGE = `a person gives the metric "${FEEDBACK_METRIC}" (score_source_human) and the platform's checks give "${RUN_HEALTH_METRIC}" (score_source_check)`;

/** The refusal of a comment on a score no person gave. */
export const SCORE_COMMENT_HUMAN_ONLY_MESSAGE =
  "spec.comment is accepted on a person's feedback only";

/** The refusal of criteria on a person's feedback. */
export const SCORE_CRITERIA_NOT_HUMAN_MESSAGE =
  "spec.criteria is written by the platform's checks, never on a person's feedback";

/** The refusal of a person's feedback with no thumbs. */
export const FEEDBACK_VALUE_REQUIRED_MESSAGE =
  "feedback needs a value: spec.passed true for thumbs up, false for thumbs down";

/** The refusal of a score on a run that has not completed. */
export function runNotCompletedMessage(runId: string): string {
  return `run ${runId} has not completed; only a completed run is scored`;
}

/** The refusal of an organization that is not the run's. */
export function scoreOrgMismatchMessage(runOrg: string): string {
  return `metadata.org must be the run's organization (${runOrg})`;
}

/** The refusal of a second rating of one run by one person. */
export function feedbackExistsMessage(scoreId: string): string {
  return `you already rated this run (score ${scoreId}); update that score to change it`;
}

/** The refusal of a second run-health score from one version of the checks. */
export function runHealthExistsMessage(scoreId: string): string {
  return `this run already has a run-health score from these checks (score ${scoreId})`;
}

/** The refusal of an update to a score no person gave. */
export const SCORE_UPDATE_HUMAN_ONLY_MESSAGE =
  "only a person's feedback can be changed; a check's verdict is final";

/** The refusal of an update that changes anything but the value and comment. */
export const SCORE_UPDATE_FIELDS_MESSAGE =
  "only spec.passed and spec.comment of a person's feedback can change";

/** The not-graded reason when a run's grading could not start. */
export const GRADING_NOT_STARTED_REASON = "grading could not start";
