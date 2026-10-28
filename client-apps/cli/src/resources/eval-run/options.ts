// `eval run` options, read into what the eval run's create asks for. Pure:
// no client, no I/O, so every refusal is unit-tested.
//
// What the eval run is about. `--agent <agent>[@version]` runs cases on an
// agent (an id, a slug in the current organization, or org/slug), at its
// current version or at a version hash or tag, which the server resolves
// and stamps; the version's form is the server's to judge, and the CLI
// refuses only what can never be one. `--plugin <plugin>[@digest]` alone
// runs a plugin's own cases on the built-in assistant, with and without it.
// Beside `--agent`, `--plugin` names the plugin compared: each case runs on
// the agent with it and, unless `--ablation none`, without it, whether the
// agent attaches it or not; it runs at the version the agent attaches, or
// its current one, so a digest there is refused. `--cases-from <plugin>`,
// repeatable, chooses whose cases run on an agent: each a plugin the agent
// attaches or the one compared (the server refuses any other). With none,
// the compared plugin's cases run when one is named, else every attached
// plugin's. `--ablation` needs a plugin to compare.
//
// The other flags are Claude Code's `claude plugin eval` flags where
// Stigmer has the same idea (`--case`, `--tag`, `--runs`, `--ablation`,
// `--threshold`, `--max-cost-usd`, `-j`, `--allow-tools`, `--judge-model`,
// `--json`), so a command line moves between the two. Two differ.
// `--model` names an engine and a model, `stigmer/claude-sonnet-4-6` or
// `claude/claude-sonnet-5`, because Stigmer runs a model on one of its engines; a
// bare model id is the native engine's. With no `--model` an eval run
// about an agent runs each case on the agent as it runs: its own engine,
// model and settings. `--max-cost-usd` is required by the API, so the CLI
// fills 5 when it is omitted and says so. `--mocks off` (and its older
// spelling `--real-mcp-servers`) runs the plugins' MCP servers for real
// with the organization's connections and ignores the mocks;
// `--allow-real-servers` starts only the servers no mock answers, and is
// refused with `--mocks off`, as the format pairs it with `--mocks
// record`. `--no-scaffold` skips each case's scaffold, listing such a case
// as not run. `--scaffold` is accepted and changes nothing: a scaffold runs
// in the try's own sandbox, so Stigmer asks no opt-in, and a CI line
// written for Claude Code runs unchanged.
//
// A refusal exits 1, as the format exits 1 for an invalid option, not the
// CLI's usual usage code 2, which the format keeps for a partial run.

import { ALLOW_TOOL_PATTERN } from "@stigmer/client";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { ENGINES, ENGINE_WORDS, engineChoice, isEngineWord } from "../run/engines.js";
import type { EvalRunTargetInput } from "@stigmer/client";
import { CliExitError } from "../../errors/index.js";

/** The exit code of an invalid option, as the format has it. */
export const INVALID_OPTION_EXIT = 1;

/** The spending limit the CLI fills when `--max-cost-usd` is omitted. */
export const DEFAULT_MAX_COST_USD = 5;

/** The most engine-and-model targets one eval runs. */
const MAX_TARGETS = 6;

/** The most case sources `--cases-from` and `--eval` may name together (the API's limit). */
const MAX_CASE_SOURCES = 64;

/** The longest agent version the API accepts. */
const MAX_NAME = 128;

/** The longest plugin reference `--cases-from` takes: an organization and a slug. */
const MAX_REFERENCE = 2 * MAX_NAME + 1;

/** A full plugin version digest. */
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/** The options as commander hands them over. */
export interface EvalRunFlags {
  readonly agent?: string;
  readonly plugin?: string;
  readonly casesFrom?: readonly string[];
  readonly eval?: readonly string[];
  readonly ablation?: string;
  readonly case?: string;
  readonly tag?: readonly string[];
  readonly runs?: string;
  readonly model?: readonly string[];
  readonly threshold?: string;
  readonly maxCostUsd?: string;
  readonly concurrency?: string;
  readonly allowTools?: readonly string[];
  readonly judgeModel?: string;
  readonly realMcpServers?: boolean;
  readonly mocks?: string;
  readonly allowRealServers?: boolean;
  /** False under `--no-scaffold`; `--scaffold` changes nothing (the module header). */
  readonly scaffold?: boolean;
  /** `true` for bare `--json`, a path for `--json <path>`. */
  readonly json?: boolean | string;
  /** False under `--no-wait`. */
  readonly wait?: boolean;
}

/** Where the result document goes. */
export type JsonTarget = { readonly kind: "none" } | { readonly kind: "stdout" } | { readonly kind: "file"; readonly path: string };

/** The options, checked. */
export interface EvalRunOptions {
  readonly subject: EvalRunSubjectTarget;
  readonly ablation: EvalRunAblation;
  readonly caseGlob: string;
  readonly caseTags: readonly string[];
  /** 0 uses each case's own value. */
  readonly runs: number;
  readonly targets: readonly EvalRunTargetInput[];
  readonly threshold?: number;
  readonly maxCostUsd: number;
  /** True when the CLI filled the limit itself. */
  readonly maxCostDefaulted: boolean;
  /** 0 is one at a time. */
  readonly concurrency: number;
  readonly allowTools: readonly string[];
  readonly judgeModel: string;
  readonly realMcpServers: boolean;
  readonly allowRealServers: boolean;
  readonly skipScaffold: boolean;
  readonly json: JsonTarget;
  readonly wait: boolean;
}

/**
 * What the eval run is about: an agent, with the plugin it compares and
 * whose cases run, or a plugin on the built-in assistant.
 */
export type EvalRunSubjectTarget =
  | {
      readonly kind: "agent";
      readonly agent: AgentTarget;
      /** The compared plugin's reference; empty when none is compared. */
      readonly compared: string;
      /** The references of the plugins whose cases run; empty for the default. */
      readonly casesFrom: readonly string[];
      /** The Evals whose cases run on the agent, each at a version or its current one. */
      readonly evals: readonly EvalTarget[];
    }
  | { readonly kind: "plugin"; readonly plugin: PluginTarget };

/** An agent as the command names it: by id or name, and optionally a version. */
export interface AgentTarget {
  /** The agent reference, without the version. */
  readonly ref: string;
  /** A version hash or tag; empty for the current version. */
  readonly version: string;
}

/** A plugin as the command names it: by id or name, and optionally a version. */
export interface PluginTarget {
  /** The plugin reference, without the version. */
  readonly ref: string;
  /** The version digest; empty for the current version. */
  readonly digest: string;
}

/** An Eval as `--eval` names it: by id or name, and optionally a version. */
export interface EvalTarget {
  /** The Eval reference, without the version. */
  readonly ref: string;
  /** A digest or a tag; empty for the current version. */
  readonly version: string;
}

/** Reads `<eval>[@<digest|tag>]`. */
export function parseEvalTarget(raw: string): EvalTarget {
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf("@");
  const ref = at < 0 ? trimmed : trimmed.slice(0, at);
  const version = at < 0 ? "" : trimmed.slice(at + 1);
  if (ref === "" || ref.length > MAX_REFERENCE) {
    throw invalid("--eval names an Eval of the agent's organization, as in --eval variance-reporter-evals");
  }
  if (at >= 0 && (version === "" || version.length > MAX_NAME || /\s/.test(version))) {
    throw invalid(
      `'${version}' is not an Eval version: a version is a digest or a tag \`stigmer get eval ${ref}\` shows`,
    );
  }
  return { ref, version };
}

/** Reads `<plugin>[@digest]`. */
export function parsePluginTarget(raw: string): PluginTarget {
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf("@");
  const ref = at < 0 ? trimmed : trimmed.slice(0, at);
  const digest = at < 0 ? "" : trimmed.slice(at + 1).toLowerCase();
  if (ref === "") {
    throw invalid("--plugin names a plugin, as in `stigmer eval run --plugin thermos`");
  }
  if (at >= 0 && !DIGEST_PATTERN.test(digest)) {
    throw invalid(
      `'${digest}' is not a plugin version: a version is the 64-character digest \`stigmer get plugin ${ref}\` shows`,
    );
  }
  return { ref, digest };
}

/** Reads `<agent>[@version]`. */
export function parseAgentTarget(raw: string): AgentTarget {
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf("@");
  const ref = at < 0 ? trimmed : trimmed.slice(0, at);
  const version = at < 0 ? "" : trimmed.slice(at + 1);
  if (ref === "") {
    throw invalid("--agent names an agent, as in `stigmer eval run --agent reviewer`");
  }
  if (at >= 0 && (version === "" || version.length > MAX_NAME || /\s/.test(version))) {
    throw invalid(
      `'${version}' is not an agent version: a version is a hash or a tag \`stigmer get agent ${ref} --version-history\` shows`,
    );
  }
  return { ref, version };
}

/** Checks every option and fills the defaults. */
export function readEvalRunOptions(flags: EvalRunFlags): EvalRunOptions {
  return { subject: subjectOf(flags), ablation: ablationOf(flags), ...sharedOptionsOf(flags) };
}

/** What the eval run is about, from `--agent`, `--plugin` and `--cases-from` (the module header). */
function subjectOf(flags: EvalRunFlags): EvalRunSubjectTarget {
  const casesFrom = (flags.casesFrom ?? []).map((ref) => ref.trim());
  const evalFlags = flags.eval ?? [];
  if (flags.agent === undefined) {
    if (flags.plugin === undefined) {
      throw invalid(
        "name what to evaluate: --agent <agent>, --plugin <plugin>, or both, as in `stigmer eval run --agent variance-reporter --plugin payroll`",
      );
    }
    if (casesFrom.length > 0) {
      throw invalid("--cases-from chooses whose cases run on an agent: --plugin alone runs that plugin's own cases");
    }
    if (evalFlags.length > 0) {
      throw invalid("--eval runs an Eval's cases on an agent: name one with --agent, as in `stigmer eval run --agent variance-reporter --eval variance-reporter-evals`");
    }
    return { kind: "plugin", plugin: parsePluginTarget(flags.plugin) };
  }
  const agent = parseAgentTarget(flags.agent);
  const compared = flags.plugin === undefined ? undefined : parsePluginTarget(flags.plugin);
  if (compared !== undefined && compared.digest !== "") {
    throw invalid(
      "--plugin beside --agent compares the plugin at the version the agent attaches, or its current one: drop the @<digest>",
    );
  }
  if (compared === undefined && flags.ablation !== undefined) {
    throw invalid("--ablation compares each case with and without the plugin --plugin names; name one, or drop --ablation");
  }
  const evals = dedupeEvals(evalFlags.map(parseEvalTarget));
  if (casesFrom.length + evals.length > MAX_CASE_SOURCES) {
    throw invalid(`--cases-from and --eval may be given at most ${MAX_CASE_SOURCES} times together`);
  }
  for (const ref of casesFrom) {
    if (ref === "" || ref.length > MAX_REFERENCE) {
      throw invalid("--cases-from names a plugin the agent attaches or the one compared, as in --cases-from thermos");
    }
  }
  return { kind: "agent", agent, compared: compared?.ref ?? "", casesFrom: [...new Set(casesFrom)], evals };
}

/** Each Eval at each version once, in the order given. */
function dedupeEvals(evals: readonly EvalTarget[]): EvalTarget[] {
  const seen = new Set<string>();
  return evals.filter((target) => {
    const key = `${target.ref}@${target.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Checks every option but the subject and the ablation, and fills the defaults. */
function sharedOptionsOf(flags: EvalRunFlags): Omit<EvalRunOptions, "subject" | "ablation"> {
  const maxCostDefaulted = flags.maxCostUsd === undefined;
  const maxCostUsd = maxCostDefaulted ? DEFAULT_MAX_COST_USD : number("--max-cost-usd", flags.maxCostUsd);
  if (!(maxCostUsd > 0 && maxCostUsd <= 1000)) {
    throw invalid("--max-cost-usd must be more than 0 and at most 1000");
  }
  const threshold = flags.threshold === undefined ? undefined : number("--threshold", flags.threshold);
  if (threshold !== undefined && !(threshold >= 0 && threshold <= 1)) {
    throw invalid("--threshold must be between 0 and 1");
  }
  const targets = (flags.model ?? []).map(parseTarget);
  if (targets.length > MAX_TARGETS) {
    throw invalid(`--model may be given at most ${MAX_TARGETS} times`);
  }
  const allowTools = flags.allowTools ?? [];
  for (const tool of allowTools) {
    if (!ALLOW_TOOL_PATTERN.test(tool)) {
      throw invalid(
        `--allow-tools '${tool}' is not a tool name: use Claude Code's names, as in Write or "Bash(npm test *)", or a plugin's MCP tools as mcp__plugin_<plugin>_<server>__<tool> or mcp__<server>__*`,
      );
    }
  }
  const realMcpServers = mocksOff(flags.mocks) || flags.realMcpServers === true;
  const allowRealServers = flags.allowRealServers === true;
  if (realMcpServers && allowRealServers) {
    throw invalid("--allow-real-servers goes with --mocks record: --mocks off already starts every server");
  }
  const judgeModel = (flags.judgeModel ?? "").trim();
  if (judgeModel.length > 128) {
    throw invalid("--judge-model is longer than 128 characters");
  }
  return {
    caseGlob: (flags.case ?? "").trim(),
    caseTags: (flags.tag ?? []).map((tag) => tag.trim()).filter((tag) => tag !== ""),
    runs: flags.runs === undefined ? 0 : integer("--runs", flags.runs, 1, 50),
    targets,
    ...(threshold !== undefined && { threshold }),
    maxCostUsd,
    maxCostDefaulted,
    concurrency: flags.concurrency === undefined ? 0 : integer("--concurrency", flags.concurrency, 1, 8),
    allowTools,
    judgeModel,
    realMcpServers,
    allowRealServers,
    skipScaffold: flags.scaffold === false,
    json: jsonTargetOf(flags.json),
    wait: flags.wait !== false,
  };
}

/** Reads `<harness>/<model>`; a bare model is the native engine's. */
export function parseTarget(raw: string): EvalRunTargetInput {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  const engine = slash < 0 ? "stigmer" : trimmed.slice(0, slash).toLowerCase();
  const model = slash < 0 ? trimmed : trimmed.slice(slash + 1);
  if (!isEngineWord(engine)) {
    throw invalid(`--model '${raw}' names no harness Stigmer runs: write ${ENGINE_WORDS.map((word) => `${word}/<model> for ${engineChoice(word)}`).join(", ")}`);
  }
  const { harness } = ENGINES[engine];
  if (model === "" || model.length > 128 || /\s/.test(model)) {
    throw invalid(`--model '${raw}' names no model: write ${engine}/<model id>, as in stigmer/claude-sonnet-4-6`);
  }
  return { harness, modelName: model === "default" ? "" : model };
}

/** Whether `--mocks` turns mocks off; `record`, the default, keeps them. */
function mocksOff(raw: string | undefined): boolean {
  switch (raw) {
    case undefined:
    case "record":
      return false;
    case "off":
      return true;
    default:
      throw invalid(`--mocks must be record or off, not '${raw}'`);
  }
}

function ablationOf(flags: EvalRunFlags): EvalRunAblation {
  const raw = flags.ablation;
  switch (raw) {
    case undefined:
    case "with-without":
      return EvalRunAblation.with_without;
    case "none":
      return EvalRunAblation.none;
    default:
      throw invalid(`--ablation must be with-without or none, not '${raw}'`);
  }
}

function jsonTargetOf(raw: boolean | string | undefined): JsonTarget {
  if (raw === undefined || raw === false) return { kind: "none" };
  if (raw === true) return { kind: "stdout" };
  if (!raw.endsWith(".json")) {
    throw invalid(`--json output path must end in .json, not '${raw}'`);
  }
  return { kind: "file", path: raw };
}

function number(flag: string, raw: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw invalid(`${flag} must be a number, not '${raw}'`);
  }
  return value;
}

function integer(flag: string, raw: string, min: number, max: number): number {
  const value = number(flag, raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${flag} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

/** A refusal of an option: exit 1, as the module header says. */
export function invalid(message: string): CliExitError {
  return new CliExitError(message, INVALID_OPTION_EXIT);
}
