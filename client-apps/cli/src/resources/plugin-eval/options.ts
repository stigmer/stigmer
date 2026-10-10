// `plugin eval` options, read into what the eval's create asks for. Pure: no
// client, no I/O, so every refusal is unit-tested.
//
// The flags are Claude Code's `claude plugin eval` flags where Stigmer has
// the same idea (`--case`, `--tag`, `--runs`, `--ablation`, `--threshold`,
// `--max-cost-usd`, `-j`, `--allow-tools`, `--judge-model`, `--json`), so a
// command line moves between the two. Two differ. `--model` names an engine
// and a model, `native/claude-sonnet-4-6` or `cursor/gpt-5`, because Stigmer
// runs a model on one of its engines; a bare model id is the native engine's.
// `--max-cost-usd` is required by the API, so the CLI fills 5 when it is
// omitted and says so. `--real-mcp-servers` is the format's `--mocks off`:
// the plugin's MCP servers run for real with the organization's connections.
//
// A refusal exits 1, as the format exits 1 for an invalid option, not the
// CLI's usual usage code 2, which the format keeps for a partial run.

import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { PluginEvalTargetInput } from "@stigmer/sdk";
import { CliExitError } from "../../errors/index.js";

/** The exit code of an invalid option, as the format has it. */
export const INVALID_OPTION_EXIT = 1;

/** The spending limit the CLI fills when `--max-cost-usd` is omitted. */
export const DEFAULT_MAX_COST_USD = 5;

/** The most engine-and-model targets one eval runs. */
const MAX_TARGETS = 6;

/** A tool name the API accepts in `allow_tools`: a Claude tool, an optional specifier, or an MCP pattern. */
const TOOL_PATTERN =
  /^(mcp__\*|mcp__[a-z][a-z0-9-]*[a-z0-9](__(\*|[A-Za-z0-9_.-]+))?|[A-Z][A-Za-z0-9_]*(\([^()\r\n]+\))?)$/;

/** A full plugin version digest. */
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/** The options as commander hands them over. */
export interface PluginEvalFlags {
  readonly case?: string;
  readonly tag?: readonly string[];
  readonly runs?: string;
  readonly model?: readonly string[];
  readonly ablation?: string;
  readonly threshold?: string;
  readonly maxCostUsd?: string;
  readonly concurrency?: string;
  readonly allowTools?: readonly string[];
  readonly judgeModel?: string;
  readonly realMcpServers?: boolean;
  /** `true` for bare `--json`, a path for `--json <path>`. */
  readonly json?: boolean | string;
  /** False under `--no-wait`. */
  readonly wait?: boolean;
}

/** Where the result document goes. */
export type JsonTarget = { readonly kind: "none" } | { readonly kind: "stdout" } | { readonly kind: "file"; readonly path: string };

/** The options, checked. */
export interface PluginEvalOptions {
  readonly caseGlob: string;
  readonly caseTags: readonly string[];
  /** 0 uses each case's own value. */
  readonly runs: number;
  readonly targets: readonly PluginEvalTargetInput[];
  readonly ablation: PluginEvalAblation;
  readonly threshold?: number;
  readonly maxCostUsd: number;
  /** True when the CLI filled the limit itself. */
  readonly maxCostDefaulted: boolean;
  /** 0 is one at a time. */
  readonly concurrency: number;
  readonly allowTools: readonly string[];
  readonly judgeModel: string;
  readonly realMcpServers: boolean;
  readonly json: JsonTarget;
  readonly wait: boolean;
}

/** A plugin as the command names it: by id or name, and optionally a version. */
export interface PluginTarget {
  /** The plugin reference, without the version. */
  readonly ref: string;
  /** The version digest; empty for the current version. */
  readonly digest: string;
}

/** Reads `<plugin>[@digest]`. */
export function parsePluginTarget(raw: string): PluginTarget {
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf("@");
  const ref = at < 0 ? trimmed : trimmed.slice(0, at);
  const digest = at < 0 ? "" : trimmed.slice(at + 1).toLowerCase();
  if (ref === "") {
    throw invalid("name the plugin to evaluate, as in `stigmer plugin eval thermos`");
  }
  if (at >= 0 && !DIGEST_PATTERN.test(digest)) {
    throw invalid(
      `'${digest}' is not a plugin version: a version is the 64-character digest \`stigmer get plugin ${ref}\` shows`,
    );
  }
  return { ref, digest };
}

/** Checks every option and fills the defaults. */
export function readPluginEvalOptions(flags: PluginEvalFlags): PluginEvalOptions {
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
    if (!TOOL_PATTERN.test(tool)) {
      throw invalid(
        `--allow-tools '${tool}' is not a tool name: use Claude Code's names, as in Write or "Bash(npm test *)", or an MCP server's tools as mcp__<server>__<tool> or mcp__<server>__*`,
      );
    }
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
    ablation: ablationOf(flags.ablation),
    ...(threshold !== undefined && { threshold }),
    maxCostUsd,
    maxCostDefaulted,
    concurrency: flags.concurrency === undefined ? 0 : integer("--concurrency", flags.concurrency, 1, 8),
    allowTools,
    judgeModel,
    realMcpServers: flags.realMcpServers === true,
    json: jsonTargetOf(flags.json),
    wait: flags.wait !== false,
  };
}

/** Reads `<harness>/<model>`; a bare model is the native engine's. */
export function parseTarget(raw: string): PluginEvalTargetInput {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  const engine = slash < 0 ? "native" : trimmed.slice(0, slash).toLowerCase();
  const model = slash < 0 ? trimmed : trimmed.slice(slash + 1);
  const harness = engine === "native" ? Harness.NATIVE : engine === "cursor" ? Harness.CURSOR : undefined;
  if (harness === undefined) {
    throw invalid(`--model '${raw}' names no engine Stigmer runs: write native/<model> or cursor/<model>`);
  }
  if (model === "" || model.length > 128 || /\s/.test(model)) {
    throw invalid(`--model '${raw}' names no model: write ${engine}/<model id>, as in native/claude-sonnet-4-6`);
  }
  return { harness, modelName: model === "default" ? "" : model };
}

function ablationOf(raw: string | undefined): PluginEvalAblation {
  switch (raw) {
    case undefined:
    case "with-without":
      return PluginEvalAblation.with_without;
    case "none":
      return PluginEvalAblation.none;
    default:
      throw invalid(`--ablation must be with-without or none, not '${raw}'`);
  }
}

function jsonTargetOf(raw: boolean | string | undefined): JsonTarget {
  if (raw === undefined || raw === false) return { kind: "none" };
  if (raw === true) return { kind: "stdout" };
  if (!raw.endsWith(".json")) {
    throw invalid(
      "--json output path must end in .json; put the plugin before --json, as in `stigmer plugin eval thermos --json`",
    );
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

function invalid(message: string): CliExitError {
  return new CliExitError(message, INVALID_OPTION_EXIT);
}
