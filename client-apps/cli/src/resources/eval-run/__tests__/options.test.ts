// Pins how `eval run` reads its options. What it is about: `--plugin`
// alone is the plugin subject, optionally at a full digest; `--agent` is
// the agent subject, `<agent>[@version]` passing a tag or hash through
// untouched (the server judges it); `--plugin` beside it is the compared
// plugin, refused at a digest; `--cases-from` repeats, trims and drops
// repeats, only with `--agent`; `--ablation` needs a plugin to compare;
// and naming neither is refused. The rest: the defaults (a spending limit
// of 5, filled and flagged; the case's own runs; one at a time; with and
// without the plugin; no target, so an agent runs its own engine and
// model), `--model` as engine/model with a bare model on the native
// engine, `--json` to stdout or to a .json path, `--no-wait`, and that
// every invalid option exits 1, the format's code, never the CLI's usage
// code 2, which the format keeps for a partial run.

import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/index.js";
import {
  DEFAULT_MAX_COST_USD,
  parseAgentTarget,
  parsePluginTarget,
  parseTarget,
  readEvalRunOptions,
  type EvalRunFlags,
} from "../options.js";

/** The options of `eval run --plugin thermos` with `flags`. */
function readPluginSubjectOptions(flags: EvalRunFlags) {
  return readEvalRunOptions({ plugin: "thermos", ...flags });
}

function refusal(run: () => unknown): CliExitError {
  try {
    run();
  } catch (error) {
    if (error instanceof CliExitError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("readEvalRunOptions", () => {
  it("fills the defaults and says the spending limit was filled", () => {
    expect(readPluginSubjectOptions({})).toEqual({
      subject: { kind: "plugin", plugin: { ref: "thermos", digest: "" } },
      caseGlob: "",
      caseTags: [],
      runs: 0,
      targets: [],
      ablation: EvalRunAblation.with_without,
      maxCostUsd: DEFAULT_MAX_COST_USD,
      maxCostDefaulted: true,
      concurrency: 0,
      allowTools: [],
      judgeModel: "",
      realMcpServers: false,
      allowRealServers: false,
      skipScaffold: false,
      json: { kind: "none" },
      wait: true,
    });
  });

  it("reads every option the format and Stigmer share", () => {
    const options = readPluginSubjectOptions({
      case: "review-*",
      tag: ["smoke", " fast "],
      runs: "5",
      model: ["native/claude-sonnet-4-6", "cursor/gpt-5"],
      ablation: "none",
      threshold: "0.8",
      maxCostUsd: "20",
      concurrency: "4",
      allowTools: ["Write", "Bash(npm test *)", "mcp__github__*", "mcp__plugin_thermos_github__*"],
      judgeModel: "claude-haiku-4-5",
      realMcpServers: true,
      json: "results.json",
      wait: false,
    });
    expect(options).toMatchObject({
      caseGlob: "review-*",
      caseTags: ["smoke", "fast"],
      runs: 5,
      targets: [
        { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" },
        { harness: Harness.CURSOR, modelName: "gpt-5" },
      ],
      ablation: EvalRunAblation.none,
      threshold: 0.8,
      maxCostUsd: 20,
      maxCostDefaulted: false,
      concurrency: 4,
      judgeModel: "claude-haiku-4-5",
      realMcpServers: true,
      json: { kind: "file", path: "results.json" },
      wait: false,
    });
  });

  it("reads the format's mock and scaffold flags, --scaffold changing nothing", () => {
    expect(readPluginSubjectOptions({ mocks: "off" })).toMatchObject({ realMcpServers: true, allowRealServers: false });
    expect(readPluginSubjectOptions({ mocks: "record", allowRealServers: true })).toMatchObject({
      realMcpServers: false,
      allowRealServers: true,
    });
    expect(readPluginSubjectOptions({ scaffold: false }).skipScaffold).toBe(true);
    expect(readPluginSubjectOptions({ scaffold: true }).skipScaffold).toBe(false);
  });

  it("prints the document to stdout for a bare --json", () => {
    expect(readPluginSubjectOptions({ json: true }).json).toEqual({ kind: "stdout" });
  });

  it.each([
    [{ json: "results.txt" }, "--json output path must end in .json, not 'results.txt'"],
    [{ runs: "0" }, "--runs must be a whole number from 1 to 50"],
    [{ runs: "2.5" }, "--runs must be a whole number from 1 to 50"],
    [{ concurrency: "9" }, "--concurrency must be a whole number from 1 to 8"],
    [{ threshold: "1.5" }, "--threshold must be between 0 and 1"],
    [{ threshold: "high" }, "--threshold must be a number"],
    [{ maxCostUsd: "0" }, "--max-cost-usd must be more than 0 and at most 1000"],
    [{ maxCostUsd: "5000" }, "--max-cost-usd must be more than 0 and at most 1000"],
    [{ ablation: "auto" }, "--ablation must be with-without or none"],
    [{ mocks: "replay" }, "--mocks must be record or off, not 'replay'"],
    [{ mocks: "off", allowRealServers: true }, "--allow-real-servers goes with --mocks record"],
    [{ realMcpServers: true, allowRealServers: true }, "--allow-real-servers goes with --mocks record"],
    [{ allowTools: ["bash"] }, "--allow-tools 'bash' is not a tool name"],
    [{ allowTools: ["mcp__plugin__github__*"] }, "is not a tool name"],
    [{ model: ["claude/sonnet"] }, "names no engine Stigmer runs"],
    [{ judgeModel: "m".repeat(129) }, "--judge-model is longer than 128 characters"],
    [{ model: Array.from({ length: 7 }, () => "native/claude-sonnet-4-6") }, "at most 6 times"],
  ])("refuses %o with exit 1", (flags, message) => {
    const error = refusal(() => readPluginSubjectOptions(flags));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain(message);
  });
});

describe("what an eval run is about", () => {
  const digest = "a".repeat(64);

  it("reads --plugin alone as the plugin subject, at a digest when one is given", () => {
    expect(readEvalRunOptions({ plugin: `acme/thermos@${digest}` }).subject).toEqual({
      kind: "plugin",
      plugin: { ref: "acme/thermos", digest },
    });
  });

  it("reads --agent alone as the agent subject, comparing nothing, with no target by default", () => {
    const options = readEvalRunOptions({ agent: "support-desk@v3" });
    expect(options.subject).toEqual({
      kind: "agent",
      agent: { ref: "support-desk", version: "v3" },
      compared: "",
      casesFrom: [],
      evals: [],
    });
    expect(options.targets).toEqual([]);
  });

  it("reads --plugin beside --agent as the compared plugin, with its ablation", () => {
    const options = readEvalRunOptions({ agent: "support-desk", plugin: "refund-policy", ablation: "none" });
    expect(options.subject).toMatchObject({ kind: "agent", compared: "refund-policy" });
    expect(options.ablation).toBe(EvalRunAblation.none);
  });

  it("collects --cases-from, trimmed and once each", () => {
    expect(
      readEvalRunOptions({ agent: "support-desk", casesFrom: ["refund-policy", " acme/tracker ", "refund-policy"] }).subject,
    ).toMatchObject({ casesFrom: ["refund-policy", "acme/tracker"] });
  });

  it("collects --eval at a version or its current one, once each", () => {
    expect(
      readEvalRunOptions({ agent: "support-desk", eval: ["support-evals@stable", " evs_01x ", "support-evals@stable", "support-evals"] })
        .subject,
    ).toMatchObject({
      evals: [
        { ref: "support-evals", version: "stable" },
        { ref: "evs_01x", version: "" },
        { ref: "support-evals", version: "" },
      ],
    });
  });

  it.each([
    ["nothing to evaluate", {}, "name what to evaluate: --agent <agent>, --plugin <plugin>, or both"],
    ["--eval on a plugin", { plugin: "thermos", eval: ["support-evals"] }, "--eval runs an Eval's cases on an agent"],
    ["an empty --eval", { agent: "a", eval: ["@stable"] }, "--eval names an Eval of the agent's organization"],
    ["an --eval version that is no version", { agent: "a", eval: ["support-evals@"] }, "is not an Eval version"],
    ["more than 64 case sources together", { agent: "a", casesFrom: ["p"], eval: Array.from({ length: 64 }, (_, i) => `e${i}`) }, "at most 64 times together"],
    ["--cases-from on a plugin", { plugin: "thermos", casesFrom: ["thermos"] }, "--cases-from chooses whose cases run on an agent"],
    ["a compared plugin at a digest", { agent: "a", plugin: `thermos@${digest}` }, "drop the @<digest>"],
    ["--ablation with nothing compared", { agent: "a", ablation: "none" }, "--ablation compares each case with and without"],
    ["an empty --cases-from", { agent: "a", casesFrom: [" "] }, "--cases-from names a plugin the agent attaches"],
    ["more than 64 case sources", { agent: "a", casesFrom: Array.from({ length: 65 }, (_, i) => `p${i}`) }, "at most 64 times together"],
  ])("refuses %s with exit 1", (_name, flags: EvalRunFlags, message) => {
    const error = refusal(() => readEvalRunOptions(flags));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain(message);
  });
});

describe("parseAgentTarget", () => {
  it.each([
    ["support-desk", { ref: "support-desk", version: "" }],
    ["acme/support-desk", { ref: "acme/support-desk", version: "" }],
    ["support-desk@v3", { ref: "support-desk", version: "v3" }],
    [`agt_01abc@${"a".repeat(64)}`, { ref: "agt_01abc", version: "a".repeat(64) }],
    ["  support-desk@stable  ", { ref: "support-desk", version: "stable" }],
  ])("reads %s", (raw, target) => {
    expect(parseAgentTarget(raw)).toEqual(target);
  });

  it.each([
    ["", "--agent names an agent"],
    ["@v3", "--agent names an agent"],
    ["support-desk@", "is not an agent version"],
    [`support-desk@${"v".repeat(129)}`, "is not an agent version"],
  ])("refuses %j with exit 1", (raw, message) => {
    const error = refusal(() => parseAgentTarget(raw));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain(message);
  });
});

describe("parseTarget", () => {
  it("reads a bare model as the native engine's, and default as the engine's default model", () => {
    expect(parseTarget("claude-sonnet-4-6")).toEqual({ harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" });
    expect(parseTarget("cursor/default")).toEqual({ harness: Harness.CURSOR, modelName: "" });
  });

  it("refuses an engine with no model", () => {
    expect(refusal(() => parseTarget("cursor/")).message).toContain("names no model");
  });
});

describe("parsePluginTarget", () => {
  const digest = "a".repeat(64);

  it("reads a plugin, optionally at a version", () => {
    expect(parsePluginTarget("thermos")).toEqual({ ref: "thermos", digest: "" });
    expect(parsePluginTarget(`acme/thermos@${digest.toUpperCase()}`)).toEqual({ ref: "acme/thermos", digest });
  });

  it("refuses a version that is not a full digest, and no plugin at all, with exit 1", () => {
    const short = refusal(() => parsePluginTarget("thermos@abc123"));
    expect(short.exitCode).toBe(1);
    expect(short.message).toContain("64-character digest");
    expect(refusal(() => parsePluginTarget(`@${digest}`)).message).toContain("--plugin names a plugin");
  });
});
