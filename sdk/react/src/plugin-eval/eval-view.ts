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
 * starts, "waiting or running" while it runs, "not run" once it stopped.
 * A graded try a mock stopped reads "0.00 · aborted by <server>.<tool>:
 * <reason>", one with an error "<score> · <error>" (a failed scaffold reads
 * "0.00 · scaffold failed: …"). A case lists its plugin's MCP servers as
 * its tries saw them: mocked with their tools, or not started.
 * A comparison is "changed" when a case's score or difference reads
 * differently to two decimals, as its cells show them, or the case ran on
 * one side only. A phase, reason or try state
 * a newer server added reads in words, never as a bare number.
 *
 * The rules read an eval through narrow shapes, not the PluginEval message
 * alone, because an agent eval reuses them: its settings form shares the
 * run settings and their limits ({@link EvalRunSettings}), and each plugin
 * block of its status is a case list over the eval's targets and phase
 * ({@link EvalCaseSource}), rendered and compared as a plugin eval's cases
 * are. The allowed tools are checked against the API's own pattern, so a
 * name the server would refuse is named before the request. Pinned by
 * `__tests__/eval-view.test.ts`.
 */
import { ALLOW_TOOL_PATTERN } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import {
  PluginEvalAblation,
  type PluginEvalTarget,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
  type PluginEvalArm,
  type PluginEvalCase,
  type PluginEvalTry,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import {
  pluginEvalTargetLabel,
  type PluginEvalInput,
  type PluginEvalTargetInput,
} from "@stigmer/sdk";
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

/**
 * The settings every eval form has: which models, how many tries, the
 * cost limit and tries at once. A plugin eval's form adds the comparison
 * ({@link EvalFormSettings}); an agent eval's adds its plugins and tools.
 */
export interface EvalRunSettings {
  /**
   * Send no targets; `targets` is kept for when this is off. A plugin eval
   * then runs each case on its own `model`, an agent eval runs the agent
   * as it runs (its own engine and model).
   */
  readonly caseModels: boolean;
  readonly targets: readonly EvalFormTarget[];
  /** Tries per case, arm and target; 0 is each case's own `runs`. */
  readonly runs: number;
  readonly maxCostUsd: number;
  readonly concurrency: number;
}

/** The Run evals form's settings. */
export interface EvalFormSettings extends EvalRunSettings {
  /** Also run every case without the plugin, for the difference it makes. */
  readonly compare: boolean;
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
export function evalFormProblem(settings: EvalRunSettings): string | null {
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
    targets: evalTargetsOf(settings),
    runs: settings.runs,
    ablation: settings.compare
      ? PluginEvalAblation.with_without
      : PluginEvalAblation.none,
    maxCostUsd: settings.maxCostUsd,
    concurrency: settings.concurrency,
  };
}

/** The targets the settings send: none while `caseModels` is on, else each model picked. */
export function evalTargetsOf(
  settings: EvalRunSettings,
): PluginEvalTargetInput[] {
  return settings.caseModels
    ? []
    : settings.targets.map((target) => ({
        harness: toProtoHarness(target.harness),
        ...(target.modelName !== "" && { modelName: target.modelName }),
      }));
}

/** The most tools an eval's allowed list names. */
export const MAX_ALLOW_TOOLS = 64;

/** A tool name an eval may allow: the API's own rule, held once in the SDK. */
export { ALLOW_TOOL_PATTERN };

/**
 * The allowed tools a person typed, one per line or comma-separated; a
 * comma inside a specifier's parentheses, as in `Bash(git log, *)`, stays
 * part of the name. Blank entries are dropped.
 */
export function parseAllowTools(text: string): string[] {
  const tools: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "\n" || (char === "," && depth === 0)) {
      tools.push(current);
      current = "";
      if (char === "\n") depth = 0;
      continue;
    }
    current += char;
  }
  tools.push(current);
  return tools.map((tool) => tool.trim()).filter((tool) => tool !== "");
}

/** Why a list of allowed tools would be refused, in a sentence; `null` when it would not. */
export function allowToolsProblem(tools: readonly string[]): string | null {
  if (tools.length > MAX_ALLOW_TOOLS) {
    return `Name at most ${MAX_ALLOW_TOOLS} tools.`;
  }
  const bad = tools.find(
    (tool) => tool.length > 256 || !ALLOW_TOOL_PATTERN.test(tool),
  );
  return bad === undefined
    ? null
    : `'${bad}' is not a tool name: use Claude Code's names, as in Skill or Bash(npm test *), or MCP tools as mcp__<server>__<tool> or mcp__<server>__*.`;
}

/** The parts of an eval resource the list and its label read: a plugin eval or an agent eval. */
export interface EvalResourceLike {
  readonly metadata?: { readonly id: string };
  readonly status?: {
    readonly phase: PluginEvalPhase;
    readonly audit?: ApiResourceAudit;
  };
}

/** Whether an eval may still change: its view keeps asking, and editors may cancel it. */
export function isEvalActive(evalResource: EvalResourceLike | null): boolean {
  const phase = evalResource?.status?.phase ?? PluginEvalPhase.unspecified;
  return phase === PluginEvalPhase.pending || phase === PluginEvalPhase.running;
}

/**
 * How an eval is labelled where it is listed or headed: its plugin and
 * when it started, as "thermos · started 10/10/2026, 5:40:12 AM", or its
 * id when it carries no start. `formatTime` defaults to the reader's
 * locale.
 */
export function evalLabelOf(
  pluginEval: EvalResourceLike,
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

/** Why an eval stopped early, in words; empty when it did not. */
export function partialLabel(reason: PluginEvalPartialReason): string {
  switch (reason) {
    case PluginEvalPartialReason.cost_ceiling:
      return "cost limit reached";
    case PluginEvalPartialReason.cancelled:
      return "cancelled";
    case PluginEvalPartialReason.unspecified:
      return "";
    default: {
      // A reason a newer server added: the eval still stopped early.
      const unknown: never = reason;
      return typeof unknown === "number" ? "stopped early" : "";
    }
  }
}

/** One try, as a cell's link lists it. */
export interface EvalTryView {
  readonly arm: "with" | "without";
  readonly index: number;
  readonly runId: string;
  /** "1.00", "0.00 · aborted by tracker.create_issue: …", "not graded: platform busy", "waiting or running", "waiting", "not run". */
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
  /** The plugin's MCP servers as the tries saw them, as "plugin_kit_tracker mocked: create_issue, close_issue" or "plugin_kit_wiki not started: no mock". */
  readonly mocked: readonly string[];
  /** One cell per target, in the eval's target order. */
  readonly cells: readonly EvalCaseCell[];
}

/**
 * A list of cases with their results, as a results table reads it: a
 * plugin eval's cases, or one plugin's block of an agent eval, with the
 * targets the eval's spec names and the eval's phase (which says what a
 * try not finished is).
 */
export interface EvalCaseSource {
  readonly targets: readonly PluginEvalTarget[];
  readonly cases: readonly PluginEvalCase[];
  readonly phase: PluginEvalPhase;
}

/** A plugin eval's cases as a {@link EvalCaseSource}. */
export function evalCaseSourceOf(pluginEval: PluginEval): EvalCaseSource {
  return {
    targets: pluginEval.spec?.targets ?? [],
    cases: pluginEval.status?.cases ?? [],
    phase: pluginEval.status?.phase ?? PluginEvalPhase.unspecified,
  };
}

/** The targets an eval's table has a column for, in order. */
export function evalTargetLabelsOf(pluginEval: PluginEval): readonly string[] {
  return caseSourceTargetLabelsOf(evalCaseSourceOf(pluginEval));
}

/** The targets a case list's table has a column for: the spec's, then any a case adds, in order. */
export function caseSourceTargetLabelsOf(
  source: EvalCaseSource,
): readonly string[] {
  const labels: string[] = [];
  const note = (label: string): void => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const target of source.targets) note(pluginEvalTargetLabel(target));
  for (const evalCase of source.cases) {
    for (const caseTarget of evalCase.targets)
      note(pluginEvalTargetLabel(caseTarget.target));
  }
  return labels;
}

/** An eval's results, one row per case, one cell per target column. */
export function evalCaseRowsOf(pluginEval: PluginEval): readonly EvalCaseRow[] {
  return caseSourceRowsOf(evalCaseSourceOf(pluginEval));
}

/** A case list's results, one row per case, one cell per target column. */
export function caseSourceRowsOf(
  source: EvalCaseSource,
): readonly EvalCaseRow[] {
  const labels = caseSourceTargetLabelsOf(source);
  const unfinished = unfinishedTryLabel(source.phase);
  return source.cases.map((evalCase) => ({
    name: evalCase.caseName,
    notRun: evalCase.notRunReason,
    notes: evalCase.notes,
    mocked: evalCase.mockedServers.map((server) =>
      server.notStartedReason !== ""
        ? `${server.name} ${server.notStartedReason}`
        : `${server.name} mocked: ${server.tools.join(", ")}`,
    ),
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
    case PluginEvalTryState.graded: {
      const score = formatScore(attempt.score);
      if (attempt.aborted !== undefined) {
        const { server, tool, reason } = attempt.aborted;
        return `${score} · aborted by ${server}.${tool}: ${reason}`;
      }
      return attempt.error === "" ? score : `${score} · ${attempt.error}`;
    }
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
  return compareCaseSources(
    evalCaseSourceOf(before),
    evalCaseSourceOf(after),
  );
}

/**
 * Two case lists, case by case and target by target, `before` first, by
 * {@link compareEvals}'s rules: one plugin's cases in two agent evals, or
 * two plugin evals' cases.
 */
export function compareCaseSources(
  before: EvalCaseSource,
  after: EvalCaseSource,
): readonly EvalCompareRow[] {
  type Entry = { name: string; target: string; side: EvalCompareSide };
  const sides = (source: EvalCaseSource): Map<string, Entry> => {
    const map = new Map<string, Entry>();
    for (const row of caseSourceRowsOf(source)) {
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
      formatScore(a.side.score) !== formatScore(b.side.score) ||
      formatDelta(a.side.delta) !== formatDelta(b.side.delta),
  });
  return [
    ...[...now].map(([key, b]) => row(b, was.get(key), b)),
    ...[...was]
      .filter(([key]) => !now.has(key))
      .map(([, a]) => row(a, a, undefined)),
  ];
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
