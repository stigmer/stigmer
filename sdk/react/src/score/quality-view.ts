/**
 * Pure reads over an agent's quality report and flagged runs for the
 * Quality tab: pass rates, the evaluator version each metric is read at,
 * the daily series the trend charts draw, the days the agent's version
 * changed, a flagged grade in words, and the latest finished eval run per
 * agent version. Kept apart from the components so the rules are
 * unit-testable without React.
 *
 * A rate never travels without its count: a pass rate is passed over
 * passed plus failed, and a tally with neither has no rate (`null`), not
 * 0%. Runs not graded, still pending, or where a rubric did not apply are
 * left out of both sides. Two versions of one evaluator's rules are never
 * added together: each metric is read at its current version, the first
 * tally of that metric in the report's total (the server lists the most
 * recently seen version first), and a day graded only under another
 * version is a gap in the series, not a point. Thumbs are the `feedback`
 * metric, up as passed and down as failed. Pinned by
 * `__tests__/quality-view.test.ts`.
 */
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunPhase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type {
  AgentQualityReport,
  MetricTally,
  QualitySummary,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { comparedPluginOf, evalRunVersionOf } from "../eval-run/eval-view.js";
import type { TrendPoint } from "../charts/trend-layout.js";
import { FEEDBACK_METRIC, JUDGE_METRIC, RUN_HEALTH_METRIC } from "./score-view.js";

/** The windows the Quality tab offers, in days. */
export const QUALITY_WINDOWS = [7, 30, 90] as const;

/** A window the Quality tab offers. */
export type QualityWindow = (typeof QUALITY_WINDOWS)[number];

/** The window the Quality tab opens on. */
export const DEFAULT_QUALITY_WINDOW: QualityWindow = 30;

/** A share that passed, with how many it counts. */
export interface PassRate {
  /** Passed over counted, 0 to 1. */
  readonly rate: number;
  /** How many were counted: passed plus failed. */
  readonly count: number;
}

/** The pass rate of `passed` against `failed`; `null` when neither counted anything. */
export function passRateOf(passed: number, failed: number): PassRate | null {
  const count = passed + failed;
  return count > 0 ? { rate: passed / count, count } : null;
}

/** A rate as a whole percent, as in "83%". */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** A rate with its count, as in "83% of 12", or a dash when there is none. */
export function formatPassRate(rate: PassRate | null): string {
  return rate === null ? "—" : `${formatPercent(rate.rate)} of ${rate.count}`;
}

/**
 * A metric's tally in a summary: at `evaluatorVersion` when given, else
 * the first, which is the most recently seen version; `null` when the
 * summary has none.
 */
export function metricTallyOf(
  summary: QualitySummary | undefined,
  metric: string,
  evaluatorVersion?: string,
): MetricTally | null {
  return (
    summary?.metrics.find(
      (tally) =>
        tally.metric === metric &&
        (evaluatorVersion === undefined ||
          tally.evaluatorVersion === evaluatorVersion),
    ) ?? null
  );
}

/** The evaluator version a metric is read at: its first tally's in the summary; `null` when it has none. */
export function currentEvaluatorVersionOf(
  summary: QualitySummary | undefined,
  metric: string,
): string | null {
  return metricTallyOf(summary, metric)?.evaluatorVersion ?? null;
}

/** Whether a metric was graded under more than one evaluator version in the summary. */
export function scoringRuleChangedIn(
  summary: QualitySummary | undefined,
  metric: string,
): boolean {
  return (
    (summary?.metrics.filter((tally) => tally.metric === metric).length ?? 0) > 1
  );
}

/** A metric's pass rate in a summary at one evaluator version. */
export function metricRateOf(
  summary: QualitySummary | undefined,
  metric: string,
  evaluatorVersion: string,
): PassRate | null {
  const tally = metricTallyOf(summary, metric, evaluatorVersion);
  return tally === null ? null : passRateOf(tally.passed, tally.failed);
}

/** One criterion's pass rate in a summary at one evaluator version of its metric. */
export function criterionRateOf(
  summary: QualitySummary | undefined,
  metric: string,
  evaluatorVersion: string,
  criterion: string,
): PassRate | null {
  const found = metricTallyOf(summary, metric, evaluatorVersion)?.criteria.find(
    (tally) => tally.name === criterion,
  );
  return found === undefined ? null : passRateOf(found.passed, found.failed);
}

/** The criteria a metric's tally names at one evaluator version, in the tally's order. */
export function criterionNamesOf(
  summary: QualitySummary | undefined,
  metric: string,
  evaluatorVersion: string,
): readonly string[] {
  return (
    metricTallyOf(summary, metric, evaluatorVersion)?.criteria.map(
      (tally) => tally.name,
    ) ?? []
  );
}

/**
 * A metric's daily pass rate at one evaluator version, oldest first, or one
 * criterion's when `criterion` is given. A day graded only under another
 * version of the metric is a gap (`null`); a day with no grade of the
 * metric, or with no rate at this version (every run not graded, or the
 * criterion not applicable), is left out, so the line joins across it.
 */
export function dailyRateSeries(
  report: AgentQualityReport,
  metric: string,
  evaluatorVersion: string,
  criterion?: string,
): readonly TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const day of report.days) {
    if (metricTallyOf(day.summary, metric) === null) continue;
    if (metricTallyOf(day.summary, metric, evaluatorVersion) === null) {
      points.push({ date: day.date, value: null, count: 0 });
      continue;
    }
    const rate =
      criterion === undefined
        ? metricRateOf(day.summary, metric, evaluatorVersion)
        : criterionRateOf(day.summary, metric, evaluatorVersion, criterion);
    if (rate !== null) {
      points.push({ date: day.date, value: rate.rate, count: rate.count });
    }
  }
  return points;
}

/** The runs graded each day, oldest first. */
export function dailyRunsSeries(
  report: AgentQualityReport,
): readonly TrendPoint[] {
  return report.days.map((day) => {
    const runs = day.summary?.runs ?? 0;
    return { date: day.date, value: runs, count: runs };
  });
}

/** A day an agent version was first seen in the window. */
export interface VersionChange {
  readonly date: string;
  /** The version's hash; empty for runs of an unversioned agent. */
  readonly agentVersionHash: string;
}

/**
 * The days the agent's version changed, oldest first: each version's first
 * day in the window, except the earliest, which is where the window
 * starts rather than a change. Two versions first seen on one day are one
 * change, named by the most recently seen one (the report lists it first).
 */
export function versionChangesOf(
  report: AgentQualityReport,
): readonly VersionChange[] {
  const firsts = [...report.versions]
    .filter((version) => version.firstDate !== "")
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate));
  const earliest = firsts[0]?.firstDate;
  const byDay = new Map<string, VersionChange>();
  for (const version of firsts) {
    if (version.firstDate === earliest || byDay.has(version.firstDate)) continue;
    byDay.set(version.firstDate, {
      date: version.firstDate,
      agentVersionHash: version.agentVersionHash,
    });
  }
  return [...byDay.values()];
}

/** The metrics a flagged grade can come from, in words. */
export function metricLabelOf(metric: string): string {
  switch (metric) {
    case RUN_HEALTH_METRIC:
      return "Run health";
    case JUDGE_METRIC:
      return "AI judge";
    case FEEDBACK_METRIC:
      return "Thumbs";
    default:
      return metric;
  }
}

/**
 * What failed in a flagged grade, in words: "thumbs down" for a person's
 * rating, else the names of the failed checks or rubrics, else the
 * metric's name. Never a criterion's reason or a rating's comment: those
 * can quote the conversation.
 */
export function flaggedWhatOf(score: Score): string {
  const metric = score.spec?.metric ?? "";
  if (metric === FEEDBACK_METRIC) return "thumbs down";
  const failed = (score.spec?.criteria ?? [])
    .filter((criterion) => criterion.result === CriterionResult.failed)
    .map((criterion) => criterion.name);
  return failed.length > 0 ? failed.join(", ") : metricLabelOf(metric);
}

/** Whether an eval run finished with results: completed, or stopped part way with the tries that ran. */
export function isFinishedEval(evalRun: EvalRun): boolean {
  const phase = evalRun.status?.phase ?? EvalRunPhase.unspecified;
  return phase === EvalRunPhase.completed || phase === EvalRunPhase.partial;
}

/**
 * Whether a finished eval run measures its agent version as it is: one
 * that compares a plugin the agent does not attach ran its with-plugin
 * tries on the agent plus that plugin, so its score is not the version's.
 */
export function measuresVersion(evalRun: EvalRun): boolean {
  return isFinishedEval(evalRun) && comparedPluginOf(evalRun)?.attached !== false;
}

/**
 * The latest finished eval run of each agent version that measures it
 * ({@link measuresVersion}), by version hash. `evals` is newest first, as
 * the agent's eval runs list pages them.
 */
export function latestFinishedEvalByVersion(
  evals: readonly EvalRun[],
): ReadonlyMap<string, EvalRun> {
  const latest = new Map<string, EvalRun>();
  for (const evalRun of evals) {
    if (!measuresVersion(evalRun)) continue;
    const version = evalRunVersionOf(evalRun);
    if (!latest.has(version)) latest.set(version, evalRun);
  }
  return latest;
}

/** An eval run's case pass rate; `null` when it graded no case. */
export function evalPassRateOf(evalRun: EvalRun): PassRate | null {
  const aggregates = evalRun.status?.aggregates;
  const passed = aggregates?.casesPassed ?? 0;
  const total = aggregates?.casesTotal ?? 0;
  return passRateOf(passed, total - passed);
}
