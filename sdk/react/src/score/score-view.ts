/**
 * Pure reads over a run's scores for the console: the run-health score and
 * its flags, and the viewer's own feedback. Kept apart from the components
 * so the rules are unit-testable without React.
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

/** The measure a person's thumbs are recorded under. */
export const FEEDBACK_SCORE_NAME = "feedback";

/** The measure the platform's free checks are recorded under. */
export const RUN_HEALTH_SCORE_NAME = "run-health";

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
      score.spec?.name === RUN_HEALTH_SCORE_NAME &&
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
      score.spec?.name !== FEEDBACK_SCORE_NAME ||
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
