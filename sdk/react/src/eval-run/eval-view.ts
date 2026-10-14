/**
 * Pure reads and writes behind the Evals tab of an agent and of a plugin:
 * the Run evals form's settings and the create input they become
 * (unnamed: the server names an eval run by its id, so a person tells eval
 * runs apart by their label: the plugin or the agent version, and when it
 * started), an eval run's results as one section per plugin whose cases
 * ran, each one row per case with one cell per target (with and without
 * the compared plugin, the difference, pass^k, each try), and two eval
 * runs compared plugin by plugin and case by case. Kept apart from the
 * components so the rules are unit-testable without React.
 *
 * The form starts as the CLI does with no `--model` and no `--runs`: no
 * targets and 0 tries, so each case's own `model` and `runs` apply (else
 * the platform's default model and three tries), and on an agent, the
 * agent as it runs (its own engine and model). Its limits are the API's
 * (one to six targets once the person picks models, 0 or 1 to 50 tries, a
 * cost limit above 0 and at most 1000 dollars, 1 to 8 tries at once); the
 * server checks them again. On an agent the form also picks the plugin
 * compared (none by default), whose cases run (the compared plugin's when
 * one is picked, else every plugin the agent attaches, sent as none, which
 * the server reads against the agent version it stamps), the case filters
 * and the tools every try may use; the allowed tools are checked against
 * the API's own pattern, so a name the server would refuse is named before
 * the request.
 *
 * No server writes a try's `running` state, so a try not finished reads by
 * the eval run's phase: "waiting" while it starts, "waiting or running"
 * while it runs, "not run" once it stopped. A graded try a mock stopped
 * reads "0.00 · aborted by <server>.<tool>: <reason>", one with an error
 * "<score> · <error>" (a failed scaffold reads "0.00 · scaffold failed:
 * …"). A case lists its plugin's MCP servers as its tries saw them: mocked
 * with their tools, or not started. A comparison is "changed" when a
 * case's score or difference reads differently to two decimals, as its
 * cells show them, or the case ran on one side only; it marks a plugin
 * whose digest differs between the two eval runs, because its cases then
 * changed with it. A phase, reason or try state a newer server added reads
 * in words, never as a bare number. Pinned by `__tests__/eval-view.test.ts`
 * and `__tests__/agent-eval-view.test.ts`.
 */
import { ALLOW_TOOL_PATTERN } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import {
  EvalRunAblation,
  type EvalRunTarget,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTryState,
  type EvalRunArm,
  type EvalRunCase,
  type EvalRunPlugin,
  type EvalRunTry,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import {
  evalRunTargetLabel,
  type EvalRunInput,
  type EvalRunTargetInput,
} from "@stigmer/sdk";
import { toProtoHarness, type HarnessOption } from "../models/harness.js";

/** The most targets an eval run runs on. */
export const MAX_EVAL_TARGETS = 6;
/** The most tries per case, arm and target. */
export const MAX_EVAL_RUNS = 50;
/** The most tries running at once. */
export const MAX_EVAL_CONCURRENCY = 8;
/** The highest cost limit an eval run accepts, in US dollars. */
export const MAX_EVAL_COST_USD = 1000;

/** One engine and model in the Run evals form; an empty model is the engine's default. */
export interface EvalFormTarget {
  readonly harness: HarnessOption;
  readonly modelName: string;
}

/** The settings the Run evals form shares on an agent and on a plugin: which models, how many tries, the cost limit and tries at once. */
export interface EvalRunSettings {
  /**
   * Send no targets; `targets` is kept for when this is off. On a plugin
   * each case then runs on its own `model`; on an agent, the agent runs as
   * it runs (its own engine and model).
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
  /**
   * Also run every case without the plugin compared (on a plugin, the
   * plugin itself), for the difference it makes.
   */
  readonly compare: boolean;
  /** On an agent: the id of the plugin each case runs with and without; empty compares none. */
  readonly comparedPluginId: string;
  /** On an agent: the slugs of the plugins whose cases run; at least one. */
  readonly caseSources: readonly string[];
  /** Runs only the cases whose name matches this glob, as in "review-*"; empty runs every case. */
  readonly caseGlob: string;
  /** Runs only the cases carrying one of these tags; empty runs every case. */
  readonly caseTags: readonly string[];
  /** Tools every try may use beyond each case's own list, in Claude Code's names. */
  readonly allowTools: readonly string[];
}

/**
 * The form's starting settings: each case's own model and runs (one native
 * target on its default model ready for when the person picks models),
 * compared, $5, one at a time, every case, no extra tools. On an agent,
 * {@link evalFormForAgent} adds whose cases run.
 */
export const DEFAULT_EVAL_FORM: EvalFormSettings = {
  caseModels: true,
  targets: [{ harness: "native", modelName: "" }],
  runs: 0,
  compare: true,
  maxCostUsd: 5,
  concurrency: 1,
  comparedPluginId: "",
  caseSources: [],
  caseGlob: "",
  caseTags: [],
  allowTools: [],
};

/** The form's starting settings on an agent whose cases come from `caseSources` (plugin slugs): no plugin compared. */
export function evalFormForAgent(caseSources: readonly string[]): EvalFormSettings {
  return { ...DEFAULT_EVAL_FORM, caseSources };
}

/** The most tags a case filter names. */
export const MAX_CASE_TAGS = 32;

/** Why the settings cannot start an eval run, in a sentence; `null` when they can. */
export function evalFormProblem(
  settings: EvalFormSettings,
  subject: EvalSubjectKind,
): string | null {
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
  if (subject === "agent" && settings.caseSources.length === 0) {
    return "Pick at least one plugin whose cases run.";
  }
  if (settings.caseGlob.length > 256) {
    return "The case name pattern is longer than 256 characters.";
  }
  if (settings.caseTags.length > MAX_CASE_TAGS) {
    return `Name at most ${MAX_CASE_TAGS} tags.`;
  }
  if (settings.caseTags.some((tag) => tag.length > 64)) {
    return "A tag is longer than 64 characters.";
  }
  return allowToolsProblem(settings.allowTools);
}

/** What an eval run is about. */
export type EvalSubjectKind = "agent" | "plugin";

/** The agent or plugin an eval run is started for. */
export interface EvalSubjectRef {
  readonly kind: EvalSubjectKind;
  readonly id: string;
  readonly org: string;
}

/**
 * The create input the form's settings become: unnamed, so the server
 * names it by its id; on a plugin, its current version; on an agent, its
 * current version, with the plugin compared when one is picked. Whose
 * cases run is sent as none when it is `defaultCaseSources` (the compared
 * plugin's, else every attached one's), which the server reads the same
 * way against the agent version it stamps; else each by its slug in the
 * agent's organization.
 */
export function evalRunInputOf(
  subject: EvalSubjectRef,
  settings: EvalFormSettings,
  defaultCaseSources: readonly string[] = [],
): EvalRunInput {
  const ablation = settings.compare
    ? EvalRunAblation.with_without
    : EvalRunAblation.none;
  const shared = {
    name: "",
    org: subject.org,
    targets: evalTargetsOf(settings),
    runs: settings.runs,
    maxCostUsd: settings.maxCostUsd,
    concurrency: settings.concurrency,
    caseGlob: settings.caseGlob.trim(),
    caseTags: [...settings.caseTags],
    allowTools: [...settings.allowTools],
  };
  if (subject.kind === "plugin") {
    return { ...shared, pluginId: subject.id, ablation };
  }
  const sameSources =
    settings.caseSources.length === defaultCaseSources.length &&
    defaultCaseSources.every((slug) => settings.caseSources.includes(slug));
  return {
    ...shared,
    agentId: subject.id,
    cases: sameSources
      ? []
      : settings.caseSources.map((slug) => ({
          plugin: { org: subject.org, slug },
        })),
    ...(settings.comparedPluginId !== "" && {
      comparedPluginId: settings.comparedPluginId,
      ablation,
    }),
  };
}

/** Case tags a person typed, comma-separated; blank entries dropped. */
export function parseCaseTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

/** The targets the settings send: none while `caseModels` is on, else each model picked. */
export function evalTargetsOf(
  settings: EvalRunSettings,
): EvalRunTargetInput[] {
  return settings.caseModels
    ? []
    : settings.targets.map((target) => ({
        harness: toProtoHarness(target.harness),
        ...(target.modelName !== "" && { modelName: target.modelName }),
      }));
}

/** The most tools an eval run's allowed list names. */
export const MAX_ALLOW_TOOLS = 64;

/** A tool name an eval run may allow: the API's own rule, held once in the SDK. */
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

/** The parts of an eval run the list's polling reads. */
export interface EvalResourceLike {
  readonly metadata?: { readonly id: string };
  readonly status?: {
    readonly phase: EvalRunPhase;
    readonly audit?: ApiResourceAudit;
  };
}

/** Whether an eval run may still change: its view keeps asking, and editors may cancel it. */
export function isEvalActive(evalResource: EvalResourceLike | null): boolean {
  const phase = evalResource?.status?.phase ?? EvalRunPhase.unspecified;
  return phase === EvalRunPhase.pending || phase === EvalRunPhase.running;
}

/** Whether an eval run is about an agent. */
export function isAboutAgent(evalRun: EvalRun): boolean {
  return evalRun.spec?.subject.case === "agentId";
}

/** The agent version an eval run ran: the status's stamp, else the spec's (a tag or empty before create stamps it); empty on a plugin. */
export function evalRunVersionOf(evalRun: EvalRun): string {
  const stamped = evalRun.status?.agentVersionHash ?? "";
  return stamped !== "" ? stamped : (evalRun.spec?.agentVersion ?? "");
}

/** A version hash as the tab shows it: its first 8 characters, or "current" when there is none. */
export function shortVersion(hash: string): string {
  return hash === "" ? "current" : hash.slice(0, 8);
}

/** A plugin digest as the tab shows it: its first 12 characters, or a dash. */
export function shortDigest(digest: string): string {
  return digest === "" ? "—" : digest.slice(0, 12);
}

/** The plugin an eval run about an agent compares, as its status lists it; undefined when it compares none. */
export function comparedPluginOf(evalRun: EvalRun): EvalRunPlugin | undefined {
  if (!isAboutAgent(evalRun)) return undefined;
  return (evalRun.status?.plugins ?? []).find((plugin) => plugin.compared);
}

/**
 * How an eval run is labelled where it is listed or headed, with when it
 * started (its id when it carries no start): on a plugin, by the plugin's
 * name, as "thermos · started 10/10/2026, 5:40:12 AM"; on an agent, by the
 * version it ran and the plugin it compared, as "Version 1a2b3c4d with and
 * without refund-policy · started …". `formatTime` defaults to the
 * reader's locale.
 */
export function evalRunLabelOf(
  evalRun: EvalRun,
  pluginName = "",
  formatTime: (at: Date) => string = (at) => at.toLocaleString(),
): string {
  const createdAt = evalRun.status?.audit?.specAudit?.createdAt;
  const when =
    createdAt === undefined
      ? (evalRun.metadata?.id ?? "")
      : `started ${formatTime(timestampDate(createdAt))}`;
  if (!isAboutAgent(evalRun)) {
    return `${pluginName.trim() || "Eval run"} · ${when}`;
  }
  const compared = comparedPluginOf(evalRun);
  const version = `Version ${shortVersion(evalRunVersionOf(evalRun))}`;
  const comparing =
    compared === undefined
      ? ""
      : evalRun.spec?.ablation === EvalRunAblation.none
        ? ` with ${compared.pluginSlug}`
        : ` with and without ${compared.pluginSlug}`;
  return `${version}${comparing} · ${when}`;
}

/** An eval run's phase, in words. */
export function phaseLabel(phase: EvalRunPhase): string {
  switch (phase) {
    case EvalRunPhase.pending:
      return "Starting";
    case EvalRunPhase.running:
      return "Running";
    case EvalRunPhase.completed:
      return "Completed";
    case EvalRunPhase.partial:
      return "Partial";
    case EvalRunPhase.failed:
      return "Failed";
    case EvalRunPhase.unspecified:
      return "";
    default: {
      const unknown: never = phase;
      return `unknown phase ${String(unknown)}`;
    }
  }
}

/** Why an eval run stopped early, in words; empty when it did not. */
export function partialLabel(reason: EvalRunPartialReason): string {
  switch (reason) {
    case EvalRunPartialReason.cost_ceiling:
      return "cost limit reached";
    case EvalRunPartialReason.cancelled:
      return "cancelled";
    case EvalRunPartialReason.unspecified:
      return "";
    default: {
      // A reason a newer server added: the eval run still stopped early.
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

/** One case of an eval run. */
export interface EvalCaseRow {
  readonly name: string;
  /** Why the case was not run, naming the feature; empty when it ran. */
  readonly notRun: string;
  readonly notes: readonly string[];
  /** The plugin's MCP servers as the tries saw them, as "plugin_kit_tracker mocked: create_issue, close_issue" or "plugin_kit_wiki not started: no mock". */
  readonly mocked: readonly string[];
  /** One cell per target, in the eval run's target order. */
  readonly cells: readonly EvalCaseCell[];
}

/**
 * A list of cases with their results, as a results table reads it: one
 * plugin's block of an eval run, with the targets the eval run's spec
 * names and its phase (which says what a try not finished is).
 */
export interface EvalCaseSource {
  readonly targets: readonly EvalRunTarget[];
  readonly cases: readonly EvalRunCase[];
  readonly phase: EvalRunPhase;
}

/** One plugin's cases in an eval run as a case list the results table reads. */
export function evalCaseSourceOf(
  evalRun: EvalRun,
  plugin: EvalRunPlugin,
): EvalCaseSource {
  return {
    targets: evalRun.spec?.targets ?? [],
    cases: plugin.cases,
    phase: evalRun.status?.phase ?? EvalRunPhase.unspecified,
  };
}

/** The targets a case list's table has a column for: the spec's, then any a case adds, in order. */
export function caseSourceTargetLabelsOf(
  source: EvalCaseSource,
): readonly string[] {
  const labels: string[] = [];
  const note = (label: string): void => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const target of source.targets) note(evalRunTargetLabel(target));
  for (const evalCase of source.cases) {
    for (const caseTarget of evalCase.targets)
      note(evalRunTargetLabel(caseTarget.target));
  }
  return labels;
}

/** One plugin a try loaded, as an eval run ran it. */
export interface EvalRunPluginSection {
  readonly pluginId: string;
  readonly slug: string;
  /** The plugin version every try ran. */
  readonly digest: string;
  /** Whether the agent attaches it; false on an eval run about a plugin. */
  readonly attached: boolean;
  /** Whether each case ran with and without it. */
  readonly compared: boolean;
  /** Why none of the plugin's cases ran; empty when they ran. */
  readonly notRun: string;
  /** The target columns of this plugin's table. */
  readonly labels: readonly string[];
  readonly rows: readonly EvalCaseRow[];
  readonly casesPassed: number;
  readonly casesTotal: number;
  readonly score: number | undefined;
  readonly meanDelta: number | undefined;
}

/** An eval run's results, one section per plugin a try loaded, in the eval run's order. */
export function evalRunSectionsOf(
  evalRun: EvalRun,
): readonly EvalRunPluginSection[] {
  return (evalRun.status?.plugins ?? []).map((plugin) => {
    const source = evalCaseSourceOf(evalRun, plugin);
    return {
      pluginId: plugin.pluginId,
      slug: plugin.pluginSlug,
      digest: plugin.pluginDigest,
      attached: plugin.attached,
      compared: plugin.compared,
      notRun: plugin.notRunReason,
      labels: caseSourceTargetLabelsOf(source),
      rows: caseSourceRowsOf(source),
      casesPassed: plugin.aggregates?.casesPassed ?? 0,
      casesTotal: plugin.aggregates?.casesTotal ?? 0,
      score: plugin.aggregates?.overallScore,
      meanDelta: plugin.aggregates?.meanDelta,
    };
  });
}

/** Whether each case of an eval run ran with and without a plugin. */
export function isComparing(evalRun: EvalRun): boolean {
  const spec = evalRun.spec;
  const compared =
    spec?.subject.case === "pluginId" || (spec?.comparedPluginId ?? "") !== "";
  return compared && spec?.ablation !== EvalRunAblation.none;
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
                evalRunTargetLabel(caseTarget.target) === label,
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
  tries: EvalRunArm | undefined,
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
 * What a try not finished is, read from its eval run's phase: the server
 * marks a try only when it ends, so while the eval run runs a pending try
 * may be in flight, and once it stopped it never ran.
 */
function unfinishedTryLabel(phase: EvalRunPhase): string {
  switch (phase) {
    case EvalRunPhase.running:
      return "waiting or running";
    case EvalRunPhase.completed:
    case EvalRunPhase.partial:
    case EvalRunPhase.failed:
      return "not run";
    case EvalRunPhase.pending:
    case EvalRunPhase.unspecified:
      return "waiting";
    default: {
      // A phase a newer server added: say only what is known.
      const unknown: never = phase;
      return `not finished (phase ${String(unknown)})`;
    }
  }
}

function trySummary(attempt: EvalRunTry, unfinished: string): string {
  switch (attempt.state) {
    case EvalRunTryState.graded: {
      const score = formatScore(attempt.score);
      if (attempt.aborted !== undefined) {
        const { server, tool, reason } = attempt.aborted;
        return `${score} · aborted by ${server}.${tool}: ${reason}`;
      }
      return attempt.error === "" ? score : `${score} · ${attempt.error}`;
    }
    case EvalRunTryState.not_graded:
      return attempt.notGradedReason === ""
        ? "not graded"
        : `not graded: ${attempt.notGradedReason}`;
    case EvalRunTryState.running:
      return "running";
    case EvalRunTryState.pending:
    case EvalRunTryState.unspecified:
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

/** One case on one target, in two eval runs. */
export interface EvalCompareRow {
  readonly name: string;
  readonly target: string;
  /** `null` when the case did not run there on that eval run. */
  readonly before: EvalCompareSide | null;
  readonly after: EvalCompareSide | null;
  readonly changed: boolean;
}

/** One plugin in two eval runs. */
export interface EvalRunCompareSection {
  readonly slug: string;
  /** The plugin version in each eval run; `null` when that eval run did not have the plugin. */
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
  /** Both eval runs ran the plugin, at different versions: its cases may have changed with it. */
  readonly digestChanged: boolean;
  /** Why the plugin's cases did not run in each eval run; empty when they ran. */
  readonly beforeNotRun: string;
  readonly afterNotRun: string;
  /** Its cases, compared by {@link compareCaseSources}. */
  readonly rows: readonly EvalCompareRow[];
}

/**
 * Two eval runs, plugin by plugin and case by case, `before` first: how a
 * new version (of the agent, or of the plugin) is judged against the last.
 * Plugins follow `after`'s order, then the ones only `before` had; a
 * plugin is matched by its slug.
 */
export function compareEvalRuns(
  before: EvalRun,
  after: EvalRun,
): readonly EvalRunCompareSection[] {
  const was = new Map(
    (before.status?.plugins ?? []).map((plugin) => [plugin.pluginSlug, plugin]),
  );
  const now = new Map(
    (after.status?.plugins ?? []).map((plugin) => [plugin.pluginSlug, plugin]),
  );
  const empty = (evalRun: EvalRun): EvalCaseSource => ({
    targets: evalRun.spec?.targets ?? [],
    cases: [],
    phase: evalRun.status?.phase ?? EvalRunPhase.unspecified,
  });
  const section = (
    slug: string,
    a: EvalRunPlugin | undefined,
    b: EvalRunPlugin | undefined,
  ): EvalRunCompareSection => ({
    slug,
    beforeDigest: a?.pluginDigest ?? null,
    afterDigest: b?.pluginDigest ?? null,
    digestChanged:
      a !== undefined && b !== undefined && a.pluginDigest !== b.pluginDigest,
    beforeNotRun: a?.notRunReason ?? "",
    afterNotRun: b?.notRunReason ?? "",
    rows: compareCaseSources(
      a === undefined ? empty(before) : evalCaseSourceOf(before, a),
      b === undefined ? empty(after) : evalCaseSourceOf(after, b),
    ),
  });
  return [
    ...[...now].map(([slug, b]) => section(slug, was.get(slug), b)),
    ...[...was]
      .filter(([slug]) => !now.has(slug))
      .map(([slug, a]) => section(slug, a, undefined)),
  ];
}

/**
 * Two case lists, case by case and target by target, `before` first: one
 * plugin's cases in two eval runs. Rows follow `after`'s order, then the
 * cases only `before` had.
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
