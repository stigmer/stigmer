/**
 * Pure reads and writes behind a plugin's Evals tab: the Run evals form's
 * settings and the create input they become (unnamed: the server names an
 * eval by its id, so a person tells evals apart by their label, the plugin
 * and when the eval started), an eval's results as one row
 * per case with one cell per target (with and without the plugin, the
 * difference, pass^k, each try), and two evals compared case by case. Kept
 * apart from the components so the rules are unit-testable without React.
 *
 * The form starts as the CLI does with no `--model` and no `--runs`: no
 * targets and 0 tries, so each case's own `model` and `runs` apply (else
 * the platform's default model and three tries). Its limits are the API's
 * (one to six targets once the person picks models, 0 or 1 to 50 tries, a
 * cost limit above 0 and at most 1000 dollars, 1 to 8 tries at once); the
 * server checks them again. No server writes a try's `running` state, so a
 * try not finished reads by the eval's phase: "waiting" while the eval
 * starts, "waiting or running" while it runs, "not run" once it stopped. A comparison is "changed" when a case's score
 * or difference moved by a hundredth or more, or the case ran on one side
 * only, which is the precision the tab shows. A phase, reason or try state
 * a newer server added reads in words, never as a bare number. Pinned by
 * `__tests__/eval-view.test.ts`.
 */
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPhase,
  PluginEvalTryState,
  type PluginEvalArm,
  type PluginEvalTry,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { pluginEvalTargetLabel, type PluginEvalInput } from "@stigmer/sdk";
import { toProtoHarness, type HarnessOption } from "../models/harness.js";

/** The most targets an eval runs on. */
export const MAX_EVAL_TARGETS = 6;
/** The most tries per case, arm and target. */
export const MAX_EVAL_RUNS = 50;
/** The most tries running at once. */
export const MAX_EVAL_CONCURRENCY = 8;
/** The highest cost limit an eval accepts, in US dollars. */
export const MAX_EVAL_COST_USD = 1000;

/** One engine and model in the Run evals form; an empty model is the engine's default. */
export interface EvalFormTarget {
  readonly harness: HarnessOption;
  readonly modelName: string;
}

/** The Run evals form's settings. */
export interface EvalFormSettings {
  /** Run each case on its own `model`, sending no targets; `targets` is kept for when this is off. */
  readonly caseModels: boolean;
  readonly targets: readonly EvalFormTarget[];
  /** Tries per case, arm and target; 0 is each case's own `runs`. */
  readonly runs: number;
  /** Also run every case without the plugin, for the difference it makes. */
  readonly compare: boolean;
  readonly maxCostUsd: number;
  readonly concurrency: number;
}

/**
 * The form's starting settings: each case's own model and runs (one native
 * target on its default model ready for when the person picks models),
 * compared, $5, one at a time.
 */
export const DEFAULT_EVAL_FORM: EvalFormSettings = {
  caseModels: true,
  targets: [{ harness: "native", modelName: "" }],
  runs: 0,
  compare: true,
  maxCostUsd: 5,
  concurrency: 1,
};

/** Why the settings cannot start an eval, in a sentence; `null` when they can. */
export function evalFormProblem(settings: EvalFormSettings): string | null {
  if (
    !settings.caseModels &&
    (settings.targets.length === 0 ||
      settings.targets.length > MAX_EVAL_TARGETS)
  ) {
    return `Pick one to ${MAX_EVAL_TARGETS} models.`;
  }
  if (settings.runs !== 0 && !isWhole(settings.runs, 1, MAX_EVAL_RUNS)) {
    return `Tries per case must be a whole number from 1 to ${MAX_EVAL_RUNS}.`;
  }
  if (
    !Number.isFinite(settings.maxCostUsd) ||
    settings.maxCostUsd <= 0 ||
    settings.maxCostUsd > MAX_EVAL_COST_USD
  ) {
    return `The cost limit must be more than $0 and at most $${MAX_EVAL_COST_USD}.`;
  }
  if (!isWhole(settings.concurrency, 1, MAX_EVAL_CONCURRENCY)) {
    return `Tries at once must be a whole number from 1 to ${MAX_EVAL_CONCURRENCY}.`;
  }
  return null;
}

/** The plugin an eval is started for. */
export interface EvalPluginRef {
  readonly id: string;
  readonly org: string;
}

/** The create input the form's settings become; unnamed, so the server names it by its id. */
export function pluginEvalInputOf(
  plugin: EvalPluginRef,
  settings: EvalFormSettings,
): PluginEvalInput {
  return {
    name: "",
    org: plugin.org,
    pluginId: plugin.id,
    targets: settings.caseModels
      ? []
      : settings.targets.map((target) => ({
          harness: toProtoHarness(target.harness),
          ...(target.modelName !== "" && { modelName: target.modelName }),
        })),
    runs: settings.runs,
    ablation: settings.compare
      ? PluginEvalAblation.with_without
      : PluginEvalAblation.none,
    maxCostUsd: settings.maxCostUsd,
    concurrency: settings.concurrency,
  };
}

/** Whether an eval may still change: its view keeps asking, and editors may cancel it. */
export function isEvalActive(pluginEval: PluginEval | null): boolean {
  const phase = pluginEval?.status?.phase ?? PluginEvalPhase.unspecified;
  return phase === PluginEvalPhase.pending || phase === PluginEvalPhase.running;
}

/**
 * How an eval is labelled where it is listed or headed: its plugin and
 * when it started, as "thermos · started 10/10/2026, 5:40:12 AM", or its
 * id when it carries no start. `formatTime` defaults to the reader's
 * locale.
 */
export function evalLabelOf(
  pluginEval: PluginEval,
  pluginName: string,
  formatTime: (at: Date) => string = (at) => at.toLocaleString(),
): string {
  const createdAt = pluginEval.status?.audit?.specAudit?.createdAt;
  const when =
    createdAt === undefined
      ? (pluginEval.metadata?.id ?? "")
      : `started ${formatTime(timestampDate(createdAt))}`;
  return `${pluginName.trim() || "Eval"} · ${when}`;
}

/** An eval's phase, in words. */
export function phaseLabel(phase: PluginEvalPhase): string {
  switch (phase) {
    case PluginEvalPhase.pending:
      return "Starting";
    case PluginEvalPhase.running:
      return "Running";
    case PluginEvalPhase.completed:
      return "Completed";
    case PluginEvalPhase.partial:
      return "Partial";
    case PluginEvalPhase.failed:
      return "Failed";
    case PluginEvalPhase.unspecified:
      return "";
    default: {
      const unknown: never = phase;
      return `unknown phase ${String(unknown)}`;
    }
  }
}

/** One try, as a cell's link lists it. */
export interface EvalTryView {
  readonly arm: "with" | "without";
  readonly index: number;
  readonly runId: string;
  /** "1.00", "not graded: platform busy", "waiting or running", "waiting", "not run". */
  readonly summary: string;
}

/** One case on one target. */
export interface EvalCaseCell {
  readonly target: string;
  /** Why the case did not run on this target; empty when it ran. */
  readonly notRun: string;
  readonly withScore: number | undefined;
  readonly withoutScore: number | undefined;
  readonly delta: number | undefined;
  readonly passed: boolean;
  readonly passK: boolean;
  readonly tries: readonly EvalTryView[];
}

/** One case of an eval. */
export interface EvalCaseRow {
  readonly name: string;
  /** Why the case was not run, naming the feature; empty when it ran. */
  readonly notRun: string;
  readonly notes: readonly string[];
  /** One cell per target, in the eval's target order. */
  readonly cells: readonly EvalCaseCell[];
}

/** The targets an eval's table has a column for, in order. */
export function evalTargetLabelsOf(pluginEval: PluginEval): readonly string[] {
  const labels: string[] = [];
  const note = (label: string): void => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const target of pluginEval.spec?.targets ?? [])
    note(pluginEvalTargetLabel(target));
  for (const evalCase of pluginEval.status?.cases ?? []) {
    for (const caseTarget of evalCase.targets)
      note(pluginEvalTargetLabel(caseTarget.target));
  }
  return labels;
}

/** An eval's results, one row per case, one cell per target column. */
export function evalCaseRowsOf(pluginEval: PluginEval): readonly EvalCaseRow[] {
  const labels = evalTargetLabelsOf(pluginEval);
  const unfinished = unfinishedTryLabel(
    pluginEval.status?.phase ?? PluginEvalPhase.unspecified,
  );
  return (pluginEval.status?.cases ?? []).map((evalCase) => ({
    name: evalCase.caseName,
    notRun: evalCase.notRunReason,
    notes: evalCase.notes,
    cells:
      evalCase.notRunReason !== ""
        ? []
        : labels.flatMap((label) => {
            const result = evalCase.targets.find(
              (caseTarget) =>
                pluginEvalTargetLabel(caseTarget.target) === label,
            );
            if (result === undefined) return [];
            return [
              {
                target: label,
                notRun: result.notRunReason,
                withScore: result.withPlugin?.score,
                withoutScore: result.withoutPlugin?.score,
                delta: result.delta,
                passed: result.passed,
                passK: result.passK,
                tries: [
                  ...triesOf("with", result.withPlugin, unfinished),
                  ...triesOf("without", result.withoutPlugin, unfinished),
                ],
              },
            ];
          }),
  }));
}

function triesOf(
  arm: "with" | "without",
  tries: PluginEvalArm | undefined,
  unfinished: string,
): EvalTryView[] {
  return (tries?.tries ?? []).map((attempt) => ({
    arm,
    index: attempt.index,
    runId: attempt.runId,
    summary: trySummary(attempt, unfinished),
  }));
}

/**
 * What a try not finished is, read from its eval's phase: the server marks a
 * try only when it ends, so while the eval runs a pending try may be in
 * flight, and once the eval stopped it never ran.
 */
function unfinishedTryLabel(phase: PluginEvalPhase): string {
  switch (phase) {
    case PluginEvalPhase.running:
      return "waiting or running";
    case PluginEvalPhase.completed:
    case PluginEvalPhase.partial:
    case PluginEvalPhase.failed:
      return "not run";
    case PluginEvalPhase.pending:
    case PluginEvalPhase.unspecified:
      return "waiting";
    default: {
      // A phase a newer server added: say only what is known.
      const unknown: never = phase;
      return `not finished (phase ${String(unknown)})`;
    }
  }
}

function trySummary(attempt: PluginEvalTry, unfinished: string): string {
  switch (attempt.state) {
    case PluginEvalTryState.graded:
      return formatScore(attempt.score);
    case PluginEvalTryState.not_graded:
      return attempt.notGradedReason === ""
        ? "not graded"
        : `not graded: ${attempt.notGradedReason}`;
    case PluginEvalTryState.running:
      return "running";
    case PluginEvalTryState.pending:
    case PluginEvalTryState.unspecified:
      return unfinished;
    default: {
      const unknown: never = attempt.state;
      return `unknown state ${String(unknown)}`;
    }
  }
}

/** One side of a comparison: a case's score and difference on one target. */
export interface EvalCompareSide {
  readonly score: number | undefined;
  readonly delta: number | undefined;
}

/** One case on one target, in two evals. */
export interface EvalCompareRow {
  readonly name: string;
  readonly target: string;
  /** `null` when the case did not run there on that eval. */
  readonly before: EvalCompareSide | null;
  readonly after: EvalCompareSide | null;
  readonly changed: boolean;
}

/**
 * Two evals of a plugin, case by case and target by target, `before`
 * first: how a new version is judged against the last. Rows follow
 * `after`'s order, then the cases only `before` had.
 */
export function compareEvals(
  before: PluginEval,
  after: PluginEval,
): readonly EvalCompareRow[] {
  type Entry = { name: string; target: string; side: EvalCompareSide };
  const sides = (pluginEval: PluginEval): Map<string, Entry> => {
    const map = new Map<string, Entry>();
    for (const row of evalCaseRowsOf(pluginEval)) {
      for (const cell of row.cells) {
        if (cell.notRun !== "") continue;
        map.set(`${row.name}\u0000${cell.target}`, {
          name: row.name,
          target: cell.target,
          side: { score: cell.withScore, delta: cell.delta },
        });
      }
    }
    return map;
  };
  const was = sides(before);
  const now = sides(after);
  const row = (
    ref: Entry,
    a: Entry | undefined,
    b: Entry | undefined,
  ): EvalCompareRow => ({
    name: ref.name,
    target: ref.target,
    before: a?.side ?? null,
    after: b?.side ?? null,
    changed:
      a === undefined ||
      b === undefined ||
      moved(a.side.score, b.side.score) ||
      moved(a.side.delta, b.side.delta),
  });
  return [
    ...[...now].map(([key, b]) => row(b, was.get(key), b)),
    ...[...was]
      .filter(([key]) => !now.has(key))
      .map(([, a]) => row(a, a, undefined)),
  ];
}

function moved(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a !== b;
  return Math.abs(a - b) >= 0.005;
}

/** A score as the tab shows it: two decimals, or a dash when there is none. */
export function formatScore(score: number | undefined): string {
  return score === undefined ? "—" : score.toFixed(2);
}

/** A difference, signed: "+0.67", "-0.10", "0.00", or a dash. */
export function formatDelta(delta: number | undefined): string {
  if (delta === undefined) return "—";
  const fixed = delta.toFixed(2);
  return delta > 0 && fixed !== "0.00"
    ? `+${fixed}`
    : fixed === "-0.00"
      ? "0.00"
      : fixed;
}

/** Dollars to two places. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function isWhole(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
