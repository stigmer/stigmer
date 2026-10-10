// Plugin-eval fixtures, the eval follower and the eval lanes' contract copy
// for the conformance suites.
// Domain: conformance support.
//
// A PluginEval runs an installed plugin's own `evals/` cases, in Claude
// Code's plugin-eval format: a case directory holding a `prompt.md` (and a
// `case.yaml` for the `context.*` fields), with its graders under
// `graders/<name>.md`. The fixtures here write that layout into a plugin
// fixture map (support/plugins.ts), so a suite pushes it through the real
// install and the server reads the suite from the stored archive, as it
// does for every eval. The cases are written as an author writes them
// (YAML frontmatter, a Markdown body), never as the server's parsed shape,
// so a reader change that stops accepting the documented layout fails here.
//
// The follower polls an eval by id until a condition holds (its terminal
// phase, a running phase, a try started), failing loudly with what it last
// saw once its budget is spent. The copy constants are cross-edition
// contract strings, byte-pinned in the server
// (domain/plugin-eval/constants.ts, the case workflow's reasons in
// temporal/evals/names.ts, the score writer's indicator reason) and
// asserted over the wire.
//
// Pinned by support/__tests__/plugin-evals.test.ts: the layout reads back
// through the library's own suite reader, and the follower's polling.
import { dump } from "js-yaml";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type {
  PluginEval,
  PluginEvalSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type { PluginEvalTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type {
  PluginEvalArm,
  PluginEvalTry,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import type { InitShape } from "./init-shape";
import {
  claudePlugin,
  pluginArchive,
  withFile,
  type PluginFixture,
} from "./plugins";

export const PLUGIN_EVAL_API_VERSION = "agentic.stigmer.ai/v1";
export const PLUGIN_EVAL_KIND = "PluginEval";

/** The reserved label on a try's session and run (domain/plugin-eval/constants.ts). */
export const PLUGIN_EVAL_LABEL = "stigmer.ai/plugin-eval";

/** The metric of the Score each try's run carries. */
export const EVAL_METRIC = "eval";

/** The reason prefix of a grader the two-arm comparison does not score. */
export const INDICATOR_ONLY_REASON = "indicator only";

// ─── Contract copy (byte-pinned in the server) ─────────────────────────────

export const PLUGIN_EVAL_CREATE_DENIED_MESSAGE =
  "unauthorized to run evals of plugin";

export function pluginEvalOrgMismatchMessage(pluginOrg: string): string {
  return `metadata.org must be the plugin's organization (${pluginOrg})`;
}

export function pluginEvalNotCurrentVersionMessage(current: string): string {
  return `an eval runs the plugin's current version (${current}); evaluating an earlier version is not supported yet`;
}

export function pluginEvalNoCasesMessage(dir: string): string {
  return `this plugin version has no eval cases: add a case directory under ${dir}/ holding a prompt.md or a case.yaml`;
}

export function pluginEvalTooLargeMessage(
  cases: number,
  tries: number,
): string {
  return (
    `this eval would run ${cases} case${cases === 1 ? "" : "s"} and ${tries} tr${tries === 1 ? "y" : "ies"}; ` +
    "an eval runs at most 200 cases and 1000 tries: " +
    "narrow it with case_glob or case_tags, or lower runs or targets"
  );
}

export function pluginEvalActiveDeleteMessage(evalId: string): string {
  return `plugin eval ${evalId} is still running: cancel it first, then delete it`;
}

export function pluginEvalOtherPluginToolMessage(
  entry: string,
  named: string,
  plugin: string,
): string {
  return `allow_tools entry '${entry}' names plugin '${named}', but this eval runs '${plugin}'; a try attaches no other plugin`;
}

/** A failed eval's error when its workflow could not start. */
export function pluginEvalNotStartedMessage(cause: string): string {
  return `the eval could not start: ${cause}`;
}

/** Why a create on a server with no engine connection could not start the eval. */
export const NO_ENGINE_CAUSE = "no engine connection";

/** A case that uses a feature Stigmer does not run yet. */
export function unsupportedFeatureReason(feature: string): string {
  return `not run: ${feature}`;
}

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

/** The files of one case, by plugin-relative path. */
export function evalCaseFiles(
  evalCase: EvalCaseFixture,
  dir = "evals",
): Map<string, string> {
  const root = `${dir}/${evalCase.name}`;
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
  /** Other files in the plugin. */
  readonly files?: Readonly<Record<string, string>>;
}

/**
 * A Claude Code plugin with one skill (so its install composes an agent the
 * with-arm runs on) and the given cases under `evals/`.
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

/** Pushes `fixture` into `org` through the real install; its delete (which cascades its evals) is deferred. */
export async function installPlugin(
  clients: ConformanceClients,
  fixtures: FixtureTracker,
  org: string,
  fixture: PluginFixture,
): Promise<Plugin> {
  const plugin = await clients.pluginCommand.push({
    org,
    artifact: pluginArchive(fixture),
  });
  fixtures.defer(() =>
    clients.pluginCommand.delete({ value: plugin.metadata!.id }),
  );
  return plugin;
}

// ─── The eval ──────────────────────────────────────────────────────────────

export interface PluginEvalOptions {
  readonly org: string;
  readonly pluginId: string;
  readonly pluginDigest?: string;
  readonly targets?: ReadonlyArray<InitShape<typeof PluginEvalTargetSchema>>;
  readonly runs?: number;
  readonly ablation?: PluginEvalAblation;
  readonly caseGlob?: string;
  readonly maxCostUsd?: number;
  readonly concurrency?: number;
  readonly allowTools?: readonly string[];
  readonly name?: string;
}

/**
 * A complete, valid eval ready to hand to create: the current version, the
 * case's own targets, one try per arm, with and without the plugin, ten
 * dollars at most, one try at a time.
 */
export function makePluginEval(
  opts: PluginEvalOptions,
): InitShape<typeof PluginEvalSchema> {
  return {
    apiVersion: PLUGIN_EVAL_API_VERSION,
    kind: PLUGIN_EVAL_KIND,
    metadata: {
      org: opts.org,
      ...(opts.name === undefined ? {} : { name: opts.name }),
    },
    spec: {
      pluginId: opts.pluginId,
      pluginDigest: opts.pluginDigest ?? "",
      targets: [...(opts.targets ?? [])],
      runs: opts.runs ?? 1,
      ablation: opts.ablation ?? PluginEvalAblation.with_without,
      caseGlob: opts.caseGlob ?? "",
      maxCostUsd: opts.maxCostUsd ?? 10,
      concurrency: opts.concurrency ?? 1,
      allowTools: [...(opts.allowTools ?? [])],
    },
  };
}

/** Whether an eval may still start tries. */
export function isActivePhase(phase: PluginEvalPhase | undefined): boolean {
  return phase === PluginEvalPhase.pending || phase === PluginEvalPhase.running;
}

/** Whether an eval has ended: completed, partial or failed. */
export function isFinishedPhase(phase: PluginEvalPhase | undefined): boolean {
  return (
    phase === PluginEvalPhase.completed ||
    phase === PluginEvalPhase.partial ||
    phase === PluginEvalPhase.failed
  );
}

function describeEval(pluginEval: PluginEval): string {
  const status = pluginEval.status;
  return (
    `phase ${PluginEvalPhase[status?.phase ?? 0]}, tries ${status?.triesFinished ?? 0}/${status?.triesTotal ?? 0}` +
    (status?.error ? `, error "${status.error}"` : "")
  );
}

/**
 * The follower: polls eval `id` until `until` holds and answers it, or
 * fails once `timeoutMs` pass, naming what it waited for and what it last
 * read.
 */
export async function followPluginEval(
  clients: ConformanceClients,
  id: string,
  until: (pluginEval: PluginEval) => boolean,
  what: string,
  timeoutMs = 120_000,
): Promise<PluginEval> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const last = await clients.pluginEvalQuery.get({ value: id });
    if (until(last)) {
      return last;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `plugin eval ${id} did not reach ${what} within ${timeoutMs} ms; last read: ${describeEval(last)}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
}

/** The eval once it has ended. */
export function awaitPluginEvalEnd(
  clients: ConformanceClients,
  id: string,
  timeoutMs?: number,
): Promise<PluginEval> {
  return followPluginEval(
    clients,
    id,
    (e) => isFinishedPhase(e.status?.phase),
    "an end",
    timeoutMs,
  );
}

/**
 * Cleanup for an eval a test created: cancel it if it may still run, wait
 * for it to end, then delete it (its tries' conversations with it). A plugin
 * delete would refuse while one of its evals runs.
 */
export async function cancelAndDeletePluginEval(
  clients: ConformanceClients,
  id: string,
): Promise<void> {
  const current = await clients.pluginEvalQuery.get({ value: id });
  if (isActivePhase(current.status?.phase)) {
    await clients.pluginEvalCommand.cancel({ value: id });
    await awaitPluginEvalEnd(clients, id, 60_000);
  }
  await clients.pluginEvalCommand.delete({ value: id });
}

/** One try of an eval, with where it sits. */
export interface LocatedTry {
  readonly caseName: string;
  readonly targetIndex: number;
  readonly arm: "with" | "without";
  readonly attempt: PluginEvalTry;
}

function armTries(arm: PluginEvalArm | undefined): readonly PluginEvalTry[] {
  return arm?.tries ?? [];
}

/** Every try of `pluginEval`, in its status's order. */
export function triesOf(pluginEval: PluginEval): LocatedTry[] {
  const out: LocatedTry[] = [];
  for (const evalCase of pluginEval.status?.cases ?? []) {
    evalCase.targets.forEach((target, targetIndex) => {
      for (const attempt of armTries(target.withPlugin)) {
        out.push({
          caseName: evalCase.caseName,
          targetIndex,
          arm: "with",
          attempt,
        });
      }
      for (const attempt of armTries(target.withoutPlugin)) {
        out.push({
          caseName: evalCase.caseName,
          targetIndex,
          arm: "without",
          attempt,
        });
      }
    });
  }
  return out;
}
