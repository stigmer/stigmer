/**
 * Pure reads and writes behind an agent's Evals tab: the Run evals form's
 * settings and the create input they become, an eval's results as one
 * section per plugin the agent attaches, and two evals compared plugin by
 * plugin and case by case. Kept apart from the components so the rules
 * are unit-testable without React.
 *
 * An agent eval runs the eval cases of the plugins an agent attaches, on
 * the agent itself, with one arm: no run without the plugin and no
 * difference. Its form shares a plugin eval's run settings and their
 * limits (`../plugin-eval/eval-view.ts`), with no models meaning the agent
 * as it runs (its own engine and model), and adds which plugins run (every
 * one the agent attaches by default, sent as none, which the server reads
 * against the agent version it stamps), case filters, and the tools every
 * try may use. Each plugin's block is a plugin eval's case list over the eval's
 * targets and phase, so it renders and compares by the plugin eval's
 * rules. An eval is named by the agent version it ran, short, and when it
 * started; a plugin by its slug and its digest, short. A comparison marks a
 * plugin whose digest differs between the two evals, because its cases
 * then changed with it. Pinned by `__tests__/agent-eval-view.test.ts`.
 */
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEvalPlugin } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { AgentEvalInput } from "@stigmer/sdk";
import {
  DEFAULT_EVAL_FORM,
  allowToolsProblem,
  caseSourceRowsOf,
  caseSourceTargetLabelsOf,
  compareCaseSources,
  evalFormProblem,
  evalLabelOf,
  evalTargetsOf,
  type EvalCaseRow,
  type EvalCaseSource,
  type EvalCompareRow,
  type EvalRunSettings,
} from "../plugin-eval/eval-view.js";

/** The most tags a case filter names. */
export const MAX_CASE_TAGS = 32;

/** The agent eval form's settings. */
export interface AgentEvalFormSettings extends EvalRunSettings {
  /** The slugs of the plugins whose cases run; at least one. */
  readonly plugins: readonly string[];
  /** Runs only the cases whose name matches this glob, as in "review-*"; empty runs every case. */
  readonly caseGlob: string;
  /** Runs only the cases carrying one of these tags; empty runs every case. */
  readonly caseTags: readonly string[];
  /** Tools every try may use beyond each case's own list, in Claude Code's names. */
  readonly allowTools: readonly string[];
}

/**
 * The form's starting settings for an agent that attaches `plugins` (their
 * slugs): the agent as it runs, each case's own tries, $5, one at a time,
 * every plugin, every case, no extra tools.
 */
export function defaultAgentEvalForm(
  plugins: readonly string[],
): AgentEvalFormSettings {
  return {
    caseModels: DEFAULT_EVAL_FORM.caseModels,
    targets: DEFAULT_EVAL_FORM.targets,
    runs: DEFAULT_EVAL_FORM.runs,
    maxCostUsd: DEFAULT_EVAL_FORM.maxCostUsd,
    concurrency: DEFAULT_EVAL_FORM.concurrency,
    plugins,
    caseGlob: "",
    caseTags: [],
    allowTools: [],
  };
}

/** Why the settings cannot start an agent eval, in a sentence; `null` when they can. */
export function agentEvalFormProblem(
  settings: AgentEvalFormSettings,
): string | null {
  const shared = evalFormProblem(settings);
  if (shared !== null) return shared;
  if (settings.plugins.length === 0) {
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

/** The agent an eval is started for. */
export interface EvalAgentRef {
  readonly id: string;
  readonly org: string;
}

/**
 * The create input the form's settings become: unnamed, so the server
 * names it by its id, on the agent's current version. `attached` is the
 * agent's plugins' slugs: when every one is picked the input names none,
 * which runs every plugin the agent attaches.
 */
export function agentEvalInputOf(
  agent: EvalAgentRef,
  settings: AgentEvalFormSettings,
  attached: readonly string[],
): AgentEvalInput {
  const everyPlugin = attached.every((slug) => settings.plugins.includes(slug));
  return {
    name: "",
    org: agent.org,
    agentId: agent.id,
    plugins: everyPlugin
      ? []
      : attached.filter((slug) => settings.plugins.includes(slug)),
    targets: evalTargetsOf(settings),
    runs: settings.runs,
    maxCostUsd: settings.maxCostUsd,
    concurrency: settings.concurrency,
    caseGlob: settings.caseGlob.trim(),
    caseTags: [...settings.caseTags],
    allowTools: [...settings.allowTools],
  };
}

/** Case tags a person typed, comma-separated; blank entries dropped. */
export function parseCaseTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

/** The agent version an eval ran: the status's stamp, else the spec's (a tag or empty before create stamps it). */
export function agentEvalVersionOf(agentEval: AgentEval): string {
  const stamped = agentEval.status?.agentVersionHash ?? "";
  return stamped !== "" ? stamped : (agentEval.spec?.agentVersion ?? "");
}

/** A version hash as the tab shows it: its first 8 characters, or "current" when there is none. */
export function shortVersion(hash: string): string {
  return hash === "" ? "current" : hash.slice(0, 8);
}

/** A plugin digest as the tab shows it: its first 12 characters, or a dash. */
export function shortDigest(digest: string): string {
  return digest === "" ? "—" : digest.slice(0, 12);
}

/**
 * How an agent eval is labelled where it is listed or headed: the agent
 * version it ran and when it started, as "Version 1a2b3c4d · started
 * 10/10/2026, 5:40:12 AM". `formatTime` defaults to the reader's locale.
 */
export function agentEvalLabelOf(
  agentEval: AgentEval,
  formatTime?: (at: Date) => string,
): string {
  return evalLabelOf(
    agentEval,
    `Version ${shortVersion(agentEvalVersionOf(agentEval))}`,
    formatTime,
  );
}

/** One plugin's cases in an agent eval as a case list the results table reads. */
export function agentEvalCaseSourceOf(
  agentEval: AgentEval,
  plugin: AgentEvalPlugin,
): EvalCaseSource {
  return {
    targets: agentEval.spec?.targets ?? [],
    cases: plugin.cases,
    phase: agentEval.status?.phase ?? PluginEvalPhase.unspecified,
  };
}

/** One plugin the agent attaches, as an agent eval ran it. */
export interface AgentEvalPluginSection {
  readonly pluginId: string;
  readonly slug: string;
  /** The plugin version every try ran. */
  readonly digest: string;
  /** Why none of the plugin's cases ran; empty when they ran. */
  readonly notRun: string;
  /** The target columns of this plugin's table. */
  readonly labels: readonly string[];
  readonly rows: readonly EvalCaseRow[];
  readonly casesPassed: number;
  readonly casesTotal: number;
  readonly score: number | undefined;
}

/** An agent eval's results, one section per plugin in the agent's order. */
export function agentEvalSectionsOf(
  agentEval: AgentEval,
): readonly AgentEvalPluginSection[] {
  return (agentEval.status?.plugins ?? []).map((plugin) => {
    const source = agentEvalCaseSourceOf(agentEval, plugin);
    return {
      pluginId: plugin.pluginId,
      slug: plugin.pluginSlug,
      digest: plugin.pluginDigest,
      notRun: plugin.notRunReason,
      labels: caseSourceTargetLabelsOf(source),
      rows: caseSourceRowsOf(source),
      casesPassed: plugin.aggregates?.casesPassed ?? 0,
      casesTotal: plugin.aggregates?.casesTotal ?? 0,
      score: plugin.aggregates?.overallScore,
    };
  });
}

/** One plugin in two agent evals. */
export interface AgentEvalCompareSection {
  readonly slug: string;
  /** The plugin version in each eval; `null` when that eval did not have the plugin. */
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
  /** Both evals ran the plugin, at different versions: its cases may have changed with it. */
  readonly digestChanged: boolean;
  /** Why the plugin's cases did not run in each eval; empty when they ran. */
  readonly beforeNotRun: string;
  readonly afterNotRun: string;
  /** Its cases, compared by the plugin eval's rules (`compareCaseSources`). */
  readonly rows: readonly EvalCompareRow[];
}

/**
 * Two evals of an agent, plugin by plugin and case by case, `before`
 * first: how a new agent version is judged against the last. Plugins
 * follow `after`'s order, then the ones only `before` had; a plugin is
 * matched by its slug.
 */
export function compareAgentEvals(
  before: AgentEval,
  after: AgentEval,
): readonly AgentEvalCompareSection[] {
  const was = new Map(
    (before.status?.plugins ?? []).map((plugin) => [plugin.pluginSlug, plugin]),
  );
  const now = new Map(
    (after.status?.plugins ?? []).map((plugin) => [plugin.pluginSlug, plugin]),
  );
  const empty = (agentEval: AgentEval): EvalCaseSource => ({
    targets: agentEval.spec?.targets ?? [],
    cases: [],
    phase: agentEval.status?.phase ?? PluginEvalPhase.unspecified,
  });
  const section = (
    slug: string,
    a: AgentEvalPlugin | undefined,
    b: AgentEvalPlugin | undefined,
  ): AgentEvalCompareSection => ({
    slug,
    beforeDigest: a?.pluginDigest ?? null,
    afterDigest: b?.pluginDigest ?? null,
    digestChanged:
      a !== undefined && b !== undefined && a.pluginDigest !== b.pluginDigest,
    beforeNotRun: a?.notRunReason ?? "",
    afterNotRun: b?.notRunReason ?? "",
    rows: compareCaseSources(
      a === undefined ? empty(before) : agentEvalCaseSourceOf(before, a),
      b === undefined ? empty(after) : agentEvalCaseSourceOf(after, b),
    ),
  });
  return [
    ...[...now].map(([slug, b]) => section(slug, was.get(slug), b)),
    ...[...was]
      .filter(([slug]) => !now.has(slug))
      .map(([slug, a]) => section(slug, a, undefined)),
  ];
}
