/**
 * Pure reads over a run's scores for the console: the run-health score and
 * its flags, the AI judge's verdict, a plugin eval's checks on one of its
 * tries, and the viewer's own feedback. Kept apart from the components so
 * the rules are unit-testable without React.
 *
 * The viewer's feedback is found by the score's creator stamp, compared to
 * the viewer's identity account id and its identity-provider subject (the
 * stamp is one or the other depending on how the server authenticates, the
 * rule `useLocalSessionWorker` applies to a session's creator). When
 * neither matches, the rating control still works: the server answers a
 * second rating with SCORE_EXISTS and the existing score's id, and the
 * control updates that score instead.
 */
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";

/** The metric a person's thumbs are recorded under. */
export const FEEDBACK_METRIC = "feedback";

/** The metric the platform's free checks are recorded under. */
export const RUN_HEALTH_METRIC = "run-health";

/** The metric an AI judge's verdict is recorded under. */
export const JUDGE_METRIC = "judge";

/** The refusal reason the server answers a second rating with. */
export const SCORE_EXISTS_REASON = "SCORE_EXISTS";

/** One failed check of a run, as the health chip lists it. */
export interface RunHealthFlag {
  readonly name: string;
  readonly reason: string;
}

/** What the health chip shows for one run. */
export type RunHealthView =
  | { readonly kind: "pending" }
  | { readonly kind: "not-graded"; readonly reason: string }
  | { readonly kind: "healthy" }
  | { readonly kind: "flagged"; readonly flags: readonly RunHealthFlag[] };

/** The run's run-health score, the newest when several versions graded it. */
export function runHealthScoreOf(scores: readonly Score[]): Score | undefined {
  return scores.find(
    (score) =>
      score.spec?.metric === RUN_HEALTH_METRIC &&
      score.spec.source === ScoreSource.check,
  );
}

/** The health chip's view of a run's scores. */
export function runHealthViewOf(scores: readonly Score[]): RunHealthView {
  const score = runHealthScoreOf(scores);
  if (score === undefined) {
    return { kind: "pending" };
  }
  if (score.status?.state === ScoreState.not_graded) {
    return { kind: "not-graded", reason: score.status.notGradedReason };
  }
  const flags = (score.spec?.criteria ?? [])
    .filter((criterion) => criterion.result === CriterionResult.failed)
    .map((criterion) => ({ name: criterion.name, reason: criterion.reason }));
  return flags.length === 0 ? { kind: "healthy" } : { kind: "flagged", flags };
}

/** One rubric of a judge's verdict, as the judge chip lists it. */
export interface JudgeCriterion {
  readonly name: string;
  readonly result: CriterionResult;
  readonly reason: string;
}

/**
 * What the judge chip shows for one run: nothing (the run's agent has no AI
 * grading, or the run was not in the sample), grading in progress, not
 * graded with a reason, or the verdict with each rubric's reason and the
 * model that gave it.
 */
export type JudgeView =
  | { readonly kind: "none" }
  | { readonly kind: "grading" }
  | { readonly kind: "not-graded"; readonly reason: string }
  | {
      readonly kind: "graded";
      readonly passed: boolean;
      readonly failed: number;
      readonly criteria: readonly JudgeCriterion[];
      readonly model: string;
    };

/** The run's judge score, the newest when several rubric versions graded it. */
export function judgeScoreOf(scores: readonly Score[]): Score | undefined {
  return scores.find(
    (score) =>
      score.spec?.metric === JUDGE_METRIC &&
      score.spec.source === ScoreSource.judge,
  );
}

/** Whether a score is a judge's grade still in progress. */
export function isPendingJudgeScore(score: Score): boolean {
  return (
    score.spec?.source === ScoreSource.judge &&
    score.status?.state === ScoreState.pending
  );
}

/** The judge chip's view of a run's scores. */
export function judgeViewOf(scores: readonly Score[]): JudgeView {
  const score = judgeScoreOf(scores);
  if (score === undefined) {
    return { kind: "none" };
  }
  switch (score.status?.state) {
    case ScoreState.pending:
      return { kind: "grading" };
    case ScoreState.not_graded:
      return { kind: "not-graded", reason: score.status.notGradedReason };
    default:
      break;
  }
  const criteria = (score.spec?.criteria ?? []).map((criterion) => ({
    name: criterion.name,
    result: criterion.result,
    reason: criterion.reason,
  }));
  return {
    kind: "graded",
    passed: thumbsOf(score) === true,
    failed: criteria.filter(
      (criterion) => criterion.result === CriterionResult.failed,
    ).length,
    criteria,
    model: score.spec?.judgeModel ?? "",
  };
}

/** The metric a plugin eval's checks on one try are recorded under. */
export const EVAL_METRIC = "eval";

/**
 * What the eval chip shows for one run: nothing (the run is not a plugin
 * eval's try, or it was not graded yet), not graded with a reason, or the
 * verdict with each check's result and reason. A check reported only as an
 * indicator (the plugin's skill fired) is not applicable and does not count
 * as a failure.
 */
export type EvalView =
  | { readonly kind: "none" }
  | { readonly kind: "not-graded"; readonly reason: string }
  | {
      readonly kind: "graded";
      readonly passed: boolean;
      readonly failed: number;
      readonly criteria: readonly JudgeCriterion[];
    };

/** The run's plugin-eval score, the newest when several graded it. */
export function evalScoreOf(scores: readonly Score[]): Score | undefined {
  return scores.find(
    (score) =>
      score.spec?.metric === EVAL_METRIC &&
      score.spec.source === ScoreSource.eval,
  );
}

/** The eval chip's view of a run's scores. */
export function evalViewOf(scores: readonly Score[]): EvalView {
  const score = evalScoreOf(scores);
  if (score === undefined || score.status?.state === ScoreState.pending) {
    return { kind: "none" };
  }
  if (score.status?.state === ScoreState.not_graded) {
    return { kind: "not-graded", reason: score.status.notGradedReason };
  }
  const criteria = (score.spec?.criteria ?? []).map((criterion) => ({
    name: criterion.name,
    result: criterion.result,
    reason: criterion.reason,
  }));
  return {
    kind: "graded",
    passed: thumbsOf(score) === true,
    failed: criteria.filter(
      (criterion) => criterion.result === CriterionResult.failed,
    ).length,
    criteria,
  };
}

/**
 * The first reason a grader gave for failing the run: the AI judge's, else
 * the plugin eval's; empty when neither failed it. It seeds the FAIL line
 * of a test case made from the run.
 */
export function failingReasonOf(scores: readonly Score[]): string {
  for (const score of [judgeScoreOf(scores), evalScoreOf(scores)]) {
    const failed = (score?.spec?.criteria ?? []).find(
      (criterion) =>
        criterion.result === CriterionResult.failed && criterion.reason !== "",
    );
    if (failed !== undefined) return failed.reason;
  }
  return "";
}

/** The identity a creator stamp may name: an account id or an IdP subject. */
export interface ViewerIdentity {
  readonly accountId: string;
  readonly subject: string;
}

/** The viewer's own feedback on the run, when the stamp names them. */
export function viewerFeedbackOf(
  scores: readonly Score[],
  viewer: ViewerIdentity | null,
): Score | undefined {
  if (viewer === null) {
    return undefined;
  }
  return scores.find((score) => {
    if (
      score.spec?.metric !== FEEDBACK_METRIC ||
      score.spec.source !== ScoreSource.human
    ) {
      return false;
    }
    const stamp = score.status?.audit?.specAudit?.createdBy?.id ?? "";
    return (
      stamp !== "" && (stamp === viewer.accountId || stamp === viewer.subject)
    );
  });
}

/** The thumbs a feedback score carries, or `undefined` when it has none. */
export function thumbsOf(score: Score | undefined): boolean | undefined {
  return score?.spec?.value.case === "passed"
    ? score.spec.value.value
    : undefined;
}

/** Groups a session's scores by the run they grade, newest first per run. */
export function scoresByRun(
  scores: readonly Score[],
): ReadonlyMap<string, readonly Score[]> {
  const byRun = new Map<string, Score[]>();
  for (const score of scores) {
    const runId = score.spec?.runId ?? "";
    if (runId === "") continue;
    const list = byRun.get(runId);
    if (list === undefined) {
      byRun.set(runId, [score]);
    } else {
      list.push(score);
    }
  }
  return byRun;
}
