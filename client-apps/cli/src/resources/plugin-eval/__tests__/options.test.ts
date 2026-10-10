// Pins how `plugin eval` reads its options: the defaults (a spending limit
// of 5, filled and flagged; the case's own runs; one at a time; with and
// without the plugin), `--model` as engine/model with a bare model on the
// native engine, `--json` to stdout or to a .json path, `--no-wait`, and
// that every invalid option exits 1, the format's code, never the CLI's
// usage code 2, which the format keeps for a partial run.

import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/index.js";
import { DEFAULT_MAX_COST_USD, parsePluginTarget, parseTarget, readPluginEvalOptions } from "../options.js";

function refusal(run: () => unknown): CliExitError {
  try {
    run();
  } catch (error) {
    if (error instanceof CliExitError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("readPluginEvalOptions", () => {
  it("fills the defaults and says the spending limit was filled", () => {
    expect(readPluginEvalOptions({})).toEqual({
      caseGlob: "",
      caseTags: [],
      runs: 0,
      targets: [],
      ablation: PluginEvalAblation.with_without,
      maxCostUsd: DEFAULT_MAX_COST_USD,
      maxCostDefaulted: true,
      concurrency: 0,
      allowTools: [],
      judgeModel: "",
      realMcpServers: false,
      json: { kind: "none" },
      wait: true,
    });
  });

  it("reads every option the format and Stigmer share", () => {
    const options = readPluginEvalOptions({
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
      ablation: PluginEvalAblation.none,
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

  it("prints the document to stdout for a bare --json", () => {
    expect(readPluginEvalOptions({ json: true }).json).toEqual({ kind: "stdout" });
  });

  it.each([
    [{ json: "results.txt" }, "--json output path must end in .json"],
    [{ runs: "0" }, "--runs must be a whole number from 1 to 50"],
    [{ runs: "2.5" }, "--runs must be a whole number from 1 to 50"],
    [{ concurrency: "9" }, "--concurrency must be a whole number from 1 to 8"],
    [{ threshold: "1.5" }, "--threshold must be between 0 and 1"],
    [{ threshold: "high" }, "--threshold must be a number"],
    [{ maxCostUsd: "0" }, "--max-cost-usd must be more than 0 and at most 1000"],
    [{ maxCostUsd: "5000" }, "--max-cost-usd must be more than 0 and at most 1000"],
    [{ ablation: "auto" }, "--ablation must be with-without or none"],
    [{ allowTools: ["bash"] }, "--allow-tools 'bash' is not a tool name"],
    [{ allowTools: ["mcp__plugin__github__*"] }, "is not a tool name"],
    [{ model: ["claude/sonnet"] }, "names no engine Stigmer runs"],
    [{ model: Array.from({ length: 7 }, () => "native/claude-sonnet-4-6") }, "at most 6 times"],
  ])("refuses %o with exit 1", (flags, message) => {
    const error = refusal(() => readPluginEvalOptions(flags));
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
    expect(refusal(() => parsePluginTarget(`@${digest}`)).message).toContain("name the plugin");
  });
});
