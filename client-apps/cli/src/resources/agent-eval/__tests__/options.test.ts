// Pins `agent eval`'s option reading: `<agent>[@version]` keeps the
// reference and passes a tag or hash through untouched (the server judges
// it), refusing an empty agent or version with exit 1; the shared flags
// read as `plugin eval`'s do, with no ablation and no target when `--model`
// is absent (the server then runs the agent's own engine and model);
// `--plugin` repeats, trims and drops repeats, and refuses an empty slug or
// more than the API takes; and the one refusal that shows a command line
// names `agent eval`.

import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/index.js";
import { parseAgentTarget, readAgentEvalOptions } from "../options.js";

function refusal(run: () => unknown): CliExitError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CliExitError);
    return error as CliExitError;
  }
  throw new Error("expected a refusal");
}

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
    ["", "name the agent to evaluate"],
    ["@v3", "name the agent to evaluate"],
    ["support-desk@", "is not an agent version"],
    [`support-desk@${"v".repeat(129)}`, "is not an agent version"],
  ])("refuses %j with exit 1", (raw, message) => {
    const error = refusal(() => parseAgentTarget(raw));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain(message);
  });
});

describe("readAgentEvalOptions", () => {
  it("names no target, no plugin and no ablation by default, and fills the spending limit", () => {
    const options = readAgentEvalOptions({});
    expect(options.targets).toEqual([]);
    expect(options.plugins).toEqual([]);
    expect(options).not.toHaveProperty("ablation");
    expect(options).toMatchObject({ maxCostUsd: 5, maxCostDefaulted: true, runs: 0, json: { kind: "none" }, wait: true });
  });

  it("reads the shared flags as plugin eval does", () => {
    const options = readAgentEvalOptions({
      model: ["native/claude-sonnet-4-6", "cursor/gpt-5"],
      runs: "2",
      tag: ["smoke"],
      allowTools: ["Skill", "Agent"],
      json: "results.json",
      wait: false,
    });
    expect(options.targets).toEqual([
      { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" },
      { harness: Harness.CURSOR, modelName: "gpt-5" },
    ]);
    expect(options).toMatchObject({
      runs: 2,
      caseTags: ["smoke"],
      allowTools: ["Skill", "Agent"],
      json: { kind: "file", path: "results.json" },
      wait: false,
    });
  });

  it("collects --plugin, trimmed and once each", () => {
    expect(readAgentEvalOptions({ plugin: ["refund-policy", " tracker ", "refund-policy"] }).plugins).toEqual([
      "refund-policy",
      "tracker",
    ]);
  });

  it.each([
    ["an empty --plugin", { plugin: [" "] }, "--plugin names a plugin by its slug"],
    ["more than 64 plugins", { plugin: Array.from({ length: 65 }, (_, i) => `p${i}`) }, "at most 64 times"],
    ["a --json path that is not .json", { json: "results.txt" }, "put the agent before --json, as in `stigmer agent eval reviewer --json`"],
    ["a bad --runs", { runs: "0" }, "--runs must be a whole number from 1 to 50"],
  ])("refuses %s with exit 1", (_name, flags, message) => {
    const error = refusal(() => readAgentEvalOptions(flags));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain(message);
  });
});
