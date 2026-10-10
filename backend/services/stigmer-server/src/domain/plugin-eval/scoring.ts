/**
 * A plugin eval's arithmetic, as Claude Code's plugin-eval format defines
 * it, plus pass^k, which is Stigmer's. Pure: the try's grader verdicts and
 * the eval's status in, numbers out, so the case workflow's record and the
 * suite workflow's fold compute the same thing whenever they run.
 *
 *   - Which graders score (`scoringOf`). In a two-arm eval, a grader that
 *     cannot pass without the plugin is excluded from the score in both
 *     arms and reported as an indicator: every `tool_used` grader whose
 *     tool is `Skill`, and every grader marked `arm: with-only`. When every
 *     grader of a case would be excluded, all score instead, since nothing
 *     would be left; `arm: both` forces a grader to score; with ablation
 *     `none` nothing is excluded. Mock-call graders are excluded by the
 *     format too, but a case using them is not run yet.
 *   - A try's score: the weighted share of its scored graders that passed.
 *     A try passes when every scored grader passed, which is a score of 1,
 *     since weights are positive.
 *   - An arm's score: the mean over its graded tries. A try that was not
 *     graded (a platform failure) is left out of every mean and named on
 *     the try, never counted as a zero.
 *   - A case and target: `delta` is the with-plugin score minus the
 *     without-plugin score when both exist; `passed` is a with-plugin score
 *     at or above the threshold (1 by default); `pass_k` is every
 *     with-plugin try graded and scoring 1; perfect runs are the graded
 *     tries in which every scored grader passed.
 *   - The suite: `overall_score` is the mean of the cases' with-plugin
 *     scores (a case's own being the mean over its targets),
 *     `cases_passed` the cases that passed on every target they ran on,
 *     `cases_total` the cases that ran on at least one target (a target
 *     ran when at least one of its with-plugin tries was graded: a case
 *     whose finished with-plugin tries were all not graded, platform
 *     failures, is left out of both counts whatever its without-plugin
 *     tries did, as a try not graded is left out of every mean),
 *     `mean_delta` the mean of the cases' deltas where one exists, and
 *     `cases_not_run` the cases listed but not run.
 *
 * Proven by __tests__/scoring.test.ts (a hand-computed suite: weights,
 * indicators, `arm: both`, the delta, pass^k).
 */
import type { EvalGrader } from "@stigmer/plugin-package";
import type {
  PluginEvalArm,
  PluginEvalCaseTarget,
  PluginEvalStatus,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { PluginEvalTryState } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { create } from "@bufbuild/protobuf";
import { PluginEvalAggregatesSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";

/** The threshold a case needs when the eval names none. */
export const DEFAULT_THRESHOLD = 1;

/** Slack for comparing a computed share with 1 or a threshold. */
const EPSILON = 1e-9;

/** How one grader counts in a try's score. */
export interface GraderScoring {
  readonly weight: number;
  /** False for an indicator: reported, not counted. */
  readonly scored: boolean;
}

/** Whether the format excludes `grader` from a two-arm score (the module header). */
function excludedInTwoArms(grader: EvalGrader): boolean {
  if (grader.arm === "both") {
    return false;
  }
  if (grader.arm === "with-only") {
    return true;
  }
  return grader.check.type === "tool_used" && grader.check.tool === "Skill";
}

/** How each grader of a case counts, in the eval's arm mode. */
export function scoringOf(
  graders: ReadonlyArray<EvalGrader>,
  twoArms: boolean,
): GraderScoring[] {
  const excluded = graders.map(
    (grader) => twoArms && excludedInTwoArms(grader),
  );
  const allExcluded = excluded.length > 0 && excluded.every(Boolean);
  return graders.map((grader, index) => ({
    weight: grader.weight,
    scored: allExcluded || !(excluded[index] ?? false),
  }));
}

/** A try's score: the weighted share of its scored graders that passed. */
export function tryScore(
  passed: ReadonlyArray<boolean>,
  scoring: ReadonlyArray<GraderScoring>,
): number {
  let total = 0;
  let earned = 0;
  scoring.forEach((grader, index) => {
    if (!grader.scored) {
      return;
    }
    total += grader.weight;
    if (passed[index] === true) {
      earned += grader.weight;
    }
  });
  return total > 0 ? earned / total : 0;
}

/** Whether every scored grader passed. */
export function everyScoredPassed(
  passed: ReadonlyArray<boolean>,
  scoring: ReadonlyArray<GraderScoring>,
): boolean {
  return scoring.every(
    (grader, index) => !grader.scored || passed[index] === true,
  );
}

/** One arm's summary from its tries. */
export function summarizeArm(arm: PluginEvalArm): void {
  const graded = arm.tries.filter(
    (attempt) => attempt.state === PluginEvalTryState.graded,
  );
  arm.gradedTries = graded.length;
  arm.perfectRuns = graded.filter(
    (attempt) => attempt.score >= 1 - EPSILON,
  ).length;
  arm.score =
    graded.length === 0
      ? undefined
      : mean(graded.map((attempt) => attempt.score));
}

/** One case and target's summary from its arms. */
export function summarizeTarget(
  target: PluginEvalCaseTarget,
  threshold: number,
): void {
  if (target.withPlugin !== undefined) {
    summarizeArm(target.withPlugin);
  }
  if (target.withoutPlugin !== undefined) {
    summarizeArm(target.withoutPlugin);
  }
  const withScore = target.withPlugin?.score;
  const withoutScore = target.withoutPlugin?.score;
  target.delta =
    withScore !== undefined && withoutScore !== undefined
      ? withScore - withoutScore
      : undefined;
  target.passed = withScore !== undefined && withScore >= threshold - EPSILON;
  const tries = target.withPlugin?.tries ?? [];
  target.passK =
    tries.length > 0 &&
    tries.every(
      (attempt) =>
        attempt.state === PluginEvalTryState.graded &&
        attempt.score >= 1 - EPSILON,
    );
}

/**
 * Recomputes every summary of `status` from its tries, in place: each
 * arm, case and target, the suite's aggregates, the cost and the count of
 * finished tries. `threshold` is the eval's (DEFAULT_THRESHOLD when unset).
 */
export function recomputeStatus(
  status: PluginEvalStatus,
  threshold: number,
): void {
  const caseScores: number[] = [];
  const caseDeltas: number[] = [];
  let casesPassed = 0;
  let casesTotal = 0;
  let casesNotRun = 0;
  let cost = 0;
  let finished = 0;

  for (const evalCase of status.cases) {
    const ran =
      evalCase.notRunReason === ""
        ? evalCase.targets.filter((target) => target.notRunReason === "")
        : [];
    for (const target of evalCase.targets) {
      summarizeTarget(target, threshold);
      for (const arm of [target.withPlugin, target.withoutPlugin]) {
        for (const attempt of arm?.tries ?? []) {
          cost += attempt.costUsd;
          if (
            attempt.state === PluginEvalTryState.graded ||
            attempt.state === PluginEvalTryState.not_graded
          ) {
            finished++;
          }
        }
      }
    }
    if (ran.length === 0) {
      casesNotRun++;
      continue;
    }
    // A target none of whose with-plugin tries was graded (the cost
    // ceiling, credit or a cancel stopped the eval first, none has finished
    // yet, or every one that finished was a platform failure) is not one
    // the case ran on, whatever its without-plugin tries did, since only
    // the with-plugin arm decides a pass; a case with no such target is
    // not one that failed either.
    const tried = ran.filter(hasGradedWithPluginTry);
    if (tried.length === 0) {
      continue;
    }
    casesTotal++;
    if (tried.every((target) => target.passed)) {
      casesPassed++;
    }
    const withScores = definedOf(tried.map((target) => target.withPlugin?.score));
    if (withScores.length > 0) {
      caseScores.push(mean(withScores));
    }
    const deltas = definedOf(tried.map((target) => target.delta));
    if (deltas.length > 0) {
      caseDeltas.push(mean(deltas));
    }
  }

  status.aggregates = create(PluginEvalAggregatesSchema, {
    overallScore: caseScores.length === 0 ? 0 : mean(caseScores),
    casesPassed,
    casesTotal,
    meanDelta: caseDeltas.length === 0 ? undefined : mean(caseDeltas),
    casesNotRun,
  });
  status.costUsd = cost;
  status.triesFinished = finished;
}

/** Whether any with-plugin try of `target` was graded. */
function hasGradedWithPluginTry(target: PluginEvalCaseTarget): boolean {
  return (target.withPlugin?.tries ?? []).some(
    (attempt) => attempt.state === PluginEvalTryState.graded,
  );
}

function definedOf(values: ReadonlyArray<number | undefined>): number[] {
  return values.filter((value): value is number => value !== undefined);
}

function mean(values: ReadonlyArray<number>): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
