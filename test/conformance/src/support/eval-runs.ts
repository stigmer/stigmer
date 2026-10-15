// Eval-run fixtures, the eval-run follower and the eval-run lanes' contract
// copy for the conformance suites.
// Domain: conformance support.
//
// An EvalRun runs test cases on an agent, or a plugin's own cases on the
// built-in assistant, optionally with and without a plugin. The cases are
// a plugin's `evals/` cases, in Claude Code's plugin-eval format: a case
// directory holding a `prompt.md` (and a `case.yaml` for the `context.*`
// fields), with its graders under `graders/<name>.md`. The fixtures here
// write that layout into a plugin fixture map (support/plugins.ts), so a
// suite pushes it through the real install and the server reads the suite
// from the stored archive, as it does for every eval run. The cases are
// written as an author writes them (YAML frontmatter, a Markdown body),
// never as the server's parsed shape, so a reader change that stops
// accepting the documented layout fails here.
//
// An eval run about an agent needs an agent that lists installed plugins:
// `createAgentWith` saves one, its delete deferred after the plugins' (the
// tracker runs in reverse, so the agent goes before the plugins it lists
// and every eval run made after it goes before the agent). `makeEvalRun`
// defaults to the smallest eval run: one try per case, one try at a time,
// within ten dollars, with and without the plugin compared, and on an
// agent the agent as it runs (no targets, so a try names no model).
//
// The follower polls an eval run by id until a condition holds (its
// terminal phase, a running phase, a try started), failing loudly with
// what it last saw once its budget is spent; `triesOf` walks the status in
// plugin, case, target and arm order. The copy constants are cross-edition
// contract strings, byte-pinned in the server (domain/eval-run/constants.ts,
// the case workflow's reasons in temporal/evals/names.ts, the score
// writer's indicator reason) and asserted over the wire.
//
// Pinned by support/__tests__/eval-runs.test.ts: the layout reads back
// through the library's own suite reader, the eval run's defaults, the
// agent fixture, the follower's polling and failure message, the tries
// walk, the copy, and the cleanup's order.
import { dump } from "js-yaml";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type {
  EvalRun,
  EvalRunSchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { EvalRunTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type {
  EvalRunArm,
  EvalRunTry,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { EvalRunPhase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import { makeAgent, type AgentSpecOptions } from "./agents";
import type { InitShape } from "./init-shape";
import {
  claudePlugin,
  pluginArchive,
  withFile,
  type PluginFixture,
} from "./plugins";

export const EVAL_RUN_API_VERSION = "agentic.stigmer.ai/v1";
export const EVAL_RUN_KIND = "EvalRun";

/** The reserved label on a try's session and run (domain/eval-run/constants.ts). */
export const EVAL_RUN_LABEL = "stigmer.ai/eval-run";

/** The metric of the Score each try's run carries. */
export const EVAL_METRIC = "eval";

/** The reason prefix of a grader the two-arm comparison does not score. */
export const INDICATOR_ONLY_REASON = "indicator only";

// ─── Contract copy (byte-pinned in the server) ─────────────────────────────

export const EVAL_RUN_AGENT_DENIED_MESSAGE = "unauthorized to run evals of agent";

export const EVAL_RUN_PLUGIN_DENIED_MESSAGE = "unauthorized to run evals of plugin";

export const EVAL_RUN_COMPARED_DENIED_MESSAGE = "unauthorized to compare a plugin you cannot view";

export function evalRunOrgMismatchMessage(subject: "agent" | "plugin", org: string): string {
  return `metadata.org must be the ${subject}'s organization (${org})`;
}

export function evalRunNotCurrentVersionMessage(current: string): string {
  return `an eval run evaluates the plugin's current version (${current}); evaluating an earlier version is not supported yet`;
}

export function evalRunNoCasesMessage(dir: string): string {
  return `this plugin version has no eval cases: add a case directory under ${dir}/ holding a prompt.md or a case.yaml`;
}

export const EVAL_RUN_NO_CASE_SOURCES_MESSAGE =
  "this agent version attaches no plugin, and the eval run compares none and names no eval: run an eval with --eval, attach a plugin with eval cases, or compare one with --plugin";

export const EVAL_RUN_NO_CASES_MESSAGE =
  "none of the plugins whose cases this eval run runs has eval cases at the version it runs";

export function evalRunUnloadedCaseSourceMessage(plugin: string): string {
  return (
    `spec.cases names plugin '${plugin}', which this agent version does not attach and the eval run does not compare: ` +
    "a case runs with the plugin it was written for"
  );
}

/** The refusal of an Eval case source that is not there or that the creator cannot view: one sentence for both. */
export function evalRunUnreadableEvalMessage(name: string): string {
  return `spec.cases names eval '${name}', which is not an eval of the agent's organization you can view`;
}

export function evalRunTooLargeMessage(cases: number, tries: number): string {
  return (
    `this eval run would run ${cases} case${cases === 1 ? "" : "s"} and ${tries} tr${tries === 1 ? "y" : "ies"}; ` +
    "an eval run runs at most 200 cases and 1000 tries: " +
    "narrow it with case_glob or case_tags, or lower runs or targets"
  );
}

export function evalRunActiveDeleteMessage(evalRunId: string): string {
  return `eval run ${evalRunId} is still running: cancel it first, then delete it`;
}

export function evalRunActiveOnSubjectDeleteMessage(subject: "agent" | "plugin", evalRunId: string): string {
  return `this ${subject} has a running eval run (${evalRunId}): cancel it first, then delete the ${subject}`;
}

export function evalRunOtherPluginToolMessage(entry: string, server: string): string {
  return `allow_tools entry '${entry}' names MCP server '${server}', which is none of the plugins a try loads`;
}

export function evalRunUnknownServerToolMessage(entry: string, server: string): string {
  return `allow_tools entry '${entry}' names MCP server '${server}', which is none of the servers the agent or its subagents write`;
}

/** The not-run reason of a plugin whose cases the eval run does not select. */
export const PLUGIN_NOT_SELECTED_REASON = "not selected";

/** The not-run reason of a plugin with no eval cases at the version a try runs. */
export const PLUGIN_NO_CASES_REASON = "no eval cases at this version";

/** A failed eval run's error when its workflow could not start: a fixed sentence, the cause only logged. */
export const EVAL_RUN_NOT_STARTED_ERROR = "the eval run's workflow could not be started";

/** A case that uses a feature Stigmer does not run yet. */
export function unsupportedFeatureReason(feature: string): string {
  return `not run: ${feature}`;
}

/** A target whose engine cannot run one of the case's features (domain/eval-run/matrix.ts). */
export function engineUnsupportedReason(engine: string, feature: string): string {
  return `not run on ${engine}: ${feature}`;
}

/** A plugin MCP server a case leaves unmocked (domain/eval-run/try-run.ts). */
export const NOT_STARTED_NO_MOCK = "not started: no mock";

/** A try its own share of the eval's spending limit stopped: not graded. */
export const SPENDING_SHARE_REASON = "stopped at its share of the eval's spending limit";

/** A try the case workflow stopped at its deadline. */
export function timedOutError(seconds: number): string {
  return `timed out after ${seconds}s`;
}

// ─── The suite layout ──────────────────────────────────────────────────────

/** One `graders/<name>.md`: its frontmatter (`type` and options) and its body. */
export interface EvalGraderFixture {
  readonly name: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** The rubric of an `llm` grader; empty for the code graders. */
  readonly body?: string;
}

/** One case directory, as an author writes it. */
export interface EvalCaseFixture {
  /** The directory's name, which is also the case's name. */
  readonly name: string;
  /** The prompt sent to the agent: `prompt.md`'s body. */
  readonly prompt: string;
  /** `prompt.md`'s frontmatter (runs, max_turns, allowed_tools, ...). */
  readonly frontmatter?: Readonly<Record<string, unknown>>;
  readonly graders: readonly EvalGraderFixture[];
  /** A `case.yaml` beside the prompt, for the `context.*` fields; it needs `schema_version` and `name`. */
  readonly caseYaml?: Readonly<Record<string, unknown>>;
  /** Other files in the case directory, relative to it. */
  readonly files?: Readonly<Record<string, string>>;
}

function markdown(
  frontmatter: Readonly<Record<string, unknown>>,
  body: string,
): string {
  const fields = Object.keys(frontmatter).length === 0 ? "" : dump(frontmatter);
  return `---\n${fields}---\n\n${body}\n`;
}

/** The files of one case, by plugin-relative path; `dir` empty puts the case at the root, as a pushed Eval holds it. */
export function evalCaseFiles(
  evalCase: EvalCaseFixture,
  dir = "evals",
): Map<string, string> {
  const root = dir === "" ? evalCase.name : `${dir}/${evalCase.name}`;
  const files = new Map<string, string>();
  files.set(
    `${root}/prompt.md`,
    markdown(evalCase.frontmatter ?? {}, evalCase.prompt),
  );
  if (evalCase.caseYaml !== undefined) {
    files.set(`${root}/case.yaml`, dump(evalCase.caseYaml));
  }
  for (const grader of evalCase.graders) {
    files.set(
      `${root}/graders/${grader.name}.md`,
      markdown(grader.frontmatter, grader.body ?? ""),
    );
  }
  for (const [path, content] of Object.entries(evalCase.files ?? {})) {
    files.set(`${root}/${path}`, content);
  }
  return files;
}

/** `fixture` with `cases` written under its eval directory. */
export function withEvalCases(
  fixture: PluginFixture,
  cases: readonly EvalCaseFixture[],
  dir = "evals",
): PluginFixture {
  let out = fixture;
  for (const evalCase of cases) {
    for (const [path, content] of evalCaseFiles(evalCase, dir)) {
      out = withFile(out, path, content);
    }
  }
  return out;
}

export interface SkillPluginOptions {
  /** The plugin's one skill; its name is the directory a try's `Skill` read names. */
  readonly skill: string;
  readonly cases: readonly EvalCaseFixture[];
  /** `hooks/hooks.json`'s event map; a plugin with hooks is mounted into each try's session. */
  readonly hooks?: Readonly<Record<string, unknown>>;
  /** Other files in the plugin, a suite's `evals/mocks/` and shared fixtures included. */
  readonly files?: Readonly<Record<string, string>>;
  /** `.mcp.json`'s servers, by key. */
  readonly mcpServers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * A Claude Code plugin with one skill, which the with-arm's tries are
 * offered, and the given cases under `evals/`.
 */
export function skillPluginWithEvals(
  name: string,
  options: SkillPluginOptions,
): PluginFixture {
  return withEvalCases(
    claudePlugin({
      name,
      version: "1.0.0",
      description: "Writes release notes",
      skills: [
        {
          name: options.skill,
          description: "Write release notes for a change",
          body: "# Release notes\nWrite one line per change, newest first.",
        },
      ],
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
      ...(options.files === undefined ? {} : { files: options.files }),
      ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
    }),
    options.cases,
  );
}

/** The `tool_used: Skill` grader of the format's walkthrough, for `skill`. */
export function skillFiredGrader(
  skill: string,
  name = "skill-fired",
): EvalGraderFixture {
  return {
    name,
    frontmatter: {
      type: "tool_used",
      tool: "Skill",
      input_match: `"skill"\\s*:\\s*"(?:[\\w-]+:)?${skill}"`,
    },
  };
}

/** A `regex` grader over the final message. */
export function lastMessageGrader(
  name: string,
  pattern: string,
): EvalGraderFixture {
  return { name, frontmatter: { type: "regex", pattern } };
}

/**
 * Pushes `fixture` into `org` through the real install, at `visibility`
 * when one is given (the kind's default, organization, otherwise); its
 * delete (which cascades the eval runs about it) is deferred.
 */
export async function installPlugin(
  clients: ConformanceClients,
  fixtures: FixtureTracker,
  org: string,
  fixture: PluginFixture,
  visibility?: ApiResourceVisibility,
): Promise<Plugin> {
  const plugin = await clients.pluginCommand.push({
    org,
    artifact: pluginArchive(fixture),
    visibility,
  });
  fixtures.defer(() =>
    clients.pluginCommand.delete({ value: plugin.metadata!.id }),
  );
  return plugin;
}

// ─── The agent ─────────────────────────────────────────────────────────────

export interface AgentWithOptions extends Omit<AgentSpecOptions, "plugins"> {
  /** The agent's name; its slug derives from it. */
  readonly name: string;
  /** The visibility it is saved at; the kind's default (organization) otherwise. */
  readonly visibility?: ApiResourceVisibility;
}

/**
 * Saves an agent in `org` that lists `plugins`, in order, by slug (no
 * version, so a turn runs each one's installed version), and defers its
 * delete, which removes the eval runs made of it.
 */
export async function createAgentWith(
  clients: Pick<ConformanceClients, "agentCommand">,
  fixtures: FixtureTracker,
  org: string,
  plugins: readonly Plugin[],
  opts: AgentWithOptions,
): Promise<Agent> {
  const { visibility, name, ...spec } = opts;
  const input = makeAgent({
    org,
    name,
    ...spec,
    plugins: plugins.map((plugin) => plugin.metadata!.slug),
  });
  if (visibility !== undefined) {
    input.metadata = { ...input.metadata, visibility };
  }
  const agent = await clients.agentCommand.create(input);
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

// ─── The eval run ──────────────────────────────────────────────────────────

/** What an eval run is about: a plugin on the built-in assistant, or an agent. */
export type EvalRunSubjectOptions =
  | {
      readonly pluginId: string;
      /** The plugin's version digest; empty evaluates its current version. */
      readonly pluginDigest?: string;
    }
  | {
      readonly agentId: string;
      /** A version hash or a tag of the agent; empty evaluates its current version. */
      readonly agentVersion?: string;
      /** The plugin each case runs with and without; none when omitted. */
      readonly comparedPluginId?: string;
      /** The plugins whose cases run, by org and slug; the default when empty. */
      readonly cases?: ReadonlyArray<{ readonly org: string; readonly slug: string }>;
      /** The Evals whose cases run, after the plugins, by org and slug at a version (a digest or a tag; empty: the current one). */
      readonly evals?: ReadonlyArray<{ readonly org: string; readonly slug: string; readonly version?: string }>;
    };

/** The options every eval run takes, whatever it is about. */
export interface EvalRunCommonOptions {
  readonly org: string;
  readonly targets?: ReadonlyArray<InitShape<typeof EvalRunTargetSchema>>;
  readonly runs?: number;
  readonly ablation?: EvalRunAblation;
  readonly caseGlob?: string;
  readonly maxCostUsd?: number;
  readonly concurrency?: number;
  readonly allowTools?: readonly string[];
  readonly skipScaffold?: boolean;
  readonly judgeModel?: string;
  readonly name?: string;
}

/** An eval run about a plugin. */
export type PluginEvalRunOptions = Extract<EvalRunSubjectOptions, { readonly pluginId: string }> & EvalRunCommonOptions;

/** An eval run about an agent. */
export type AgentEvalRunOptions = Extract<EvalRunSubjectOptions, { readonly agentId: string }> & EvalRunCommonOptions;

export type EvalRunOptions = PluginEvalRunOptions | AgentEvalRunOptions;

/** The spec's subject fields of `opts`. */
function subjectSpecOf(opts: EvalRunSubjectOptions) {
  if ("pluginId" in opts) {
    return {
      subject: { case: "pluginId" as const, value: opts.pluginId },
      pluginDigest: opts.pluginDigest ?? "",
    };
  }
  return {
    subject: { case: "agentId" as const, value: opts.agentId },
    agentVersion: opts.agentVersion ?? "",
    comparedPluginId: opts.comparedPluginId ?? "",
    cases: [
      ...(opts.cases ?? []).map((ref) => ({
        source: { case: "plugin" as const, value: { org: ref.org, slug: ref.slug } },
      })),
      ...(opts.evals ?? []).map((ref) => ({
        source: {
          case: "eval" as const,
          value: { kind: ApiResourceKind.eval, org: ref.org, slug: ref.slug, version: ref.version ?? "" },
        },
      })),
    ],
  };
}

/**
 * A complete, valid eval run ready to hand to create: the subject's
 * current version, the default cases, the case's own targets (on an agent,
 * the agent as it runs), one try per arm, with and without the plugin
 * compared, ten dollars at most, one try at a time.
 */
export function makeEvalRun(opts: EvalRunOptions): InitShape<typeof EvalRunSchema> {
  return {
    apiVersion: EVAL_RUN_API_VERSION,
    kind: EVAL_RUN_KIND,
    metadata: {
      org: opts.org,
      ...(opts.name === undefined ? {} : { name: opts.name }),
    },
    spec: {
      ...subjectSpecOf(opts),
      targets: [...(opts.targets ?? [])],
      runs: opts.runs ?? 1,
      ablation: opts.ablation ?? EvalRunAblation.with_without,
      caseGlob: opts.caseGlob ?? "",
      maxCostUsd: opts.maxCostUsd ?? 10,
      concurrency: opts.concurrency ?? 1,
      allowTools: [...(opts.allowTools ?? [])],
      skipScaffold: opts.skipScaffold ?? false,
      judgeModel: opts.judgeModel ?? "",
    },
  };
}

/** Whether an eval run may still start tries. */
export function isActivePhase(phase: EvalRunPhase | undefined): boolean {
  return phase === EvalRunPhase.pending || phase === EvalRunPhase.running;
}

/** Whether an eval run has ended: completed, partial or failed. */
export function isFinishedPhase(phase: EvalRunPhase | undefined): boolean {
  return (
    phase === EvalRunPhase.completed ||
    phase === EvalRunPhase.partial ||
    phase === EvalRunPhase.failed
  );
}

function describeEvalRun(evalRun: EvalRun): string {
  const status = evalRun.status;
  return (
    `phase ${EvalRunPhase[status?.phase ?? 0]}, tries ${status?.triesFinished ?? 0}/${status?.triesTotal ?? 0}` +
    (status?.error ? `, error "${status.error}"` : "")
  );
}

/**
 * The follower: polls eval run `id` until `until` holds and answers it, or
 * fails once `timeoutMs` pass, naming what it waited for and what it last
 * read.
 */
export async function followEvalRun(
  clients: Pick<ConformanceClients, "evalRunQuery">,
  id: string,
  until: (evalRun: EvalRun) => boolean,
  what: string,
  timeoutMs = 120_000,
): Promise<EvalRun> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const last = await clients.evalRunQuery.get({ value: id });
    if (until(last)) {
      return last;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `eval run ${id} did not reach ${what} within ${timeoutMs} ms; last read: ${describeEvalRun(last)}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
}

/** The eval run once it has ended. */
export function awaitEvalRunEnd(
  clients: Pick<ConformanceClients, "evalRunQuery">,
  id: string,
  timeoutMs?: number,
): Promise<EvalRun> {
  return followEvalRun(
    clients,
    id,
    (e) => isFinishedPhase(e.status?.phase),
    "an end",
    timeoutMs,
  );
}

/**
 * Cleanup for an eval run a test created: cancel it if it may still run,
 * wait for it to end, then delete it (its tries' conversations with it).
 * The subject's delete would refuse while one of its eval runs runs.
 */
export async function cancelAndDeleteEvalRun(
  clients: Pick<ConformanceClients, "evalRunQuery" | "evalRunCommand">,
  id: string,
): Promise<void> {
  const current = await clients.evalRunQuery.get({ value: id });
  if (isActivePhase(current.status?.phase)) {
    await clients.evalRunCommand.cancel({ value: id });
    await awaitEvalRunEnd(clients, id, 60_000);
  }
  await clients.evalRunCommand.delete({ value: id });
}

/** One try of an eval run, with where it sits: its plugin, case, target and arm. */
export interface LocatedTry {
  readonly pluginSlug: string;
  readonly caseName: string;
  readonly targetIndex: number;
  readonly arm: "with" | "without";
  readonly attempt: EvalRunTry;
}

function armTries(arm: EvalRunArm | undefined): readonly EvalRunTry[] {
  return arm?.tries ?? [];
}

/** Every try of `evalRun`, in its status's order: plugin, case, target, arm, try. */
export function triesOf(evalRun: EvalRun): LocatedTry[] {
  const out: LocatedTry[] = [];
  for (const plugin of evalRun.status?.plugins ?? []) {
    for (const evalCase of plugin.cases) {
      evalCase.targets.forEach((target, targetIndex) => {
        const at = { pluginSlug: plugin.pluginSlug, caseName: evalCase.caseName, targetIndex };
        for (const attempt of armTries(target.withPlugin)) {
          out.push({ ...at, arm: "with", attempt });
        }
        for (const attempt of armTries(target.withoutPlugin)) {
          out.push({ ...at, arm: "without", attempt });
        }
      });
    }
  }
  return out;
}

/** The cases of an eval run about a plugin: its one plugin's. */
export function casesOf(evalRun: EvalRun) {
  return evalRun.status?.plugins[0]?.cases ?? [];
}
