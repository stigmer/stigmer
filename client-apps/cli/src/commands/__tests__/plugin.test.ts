// Command-level contract for `stigmer plugin eval`: the target and every
// flag reach the dispatch read and checked (--tag takes several values and
// repeats, a repeated --model collects, a version after @ is the digest), in the organization --org
// names, with the process's own effects; the dispatch's exit code leaves
// through a silent CliExitError when it is not 0; and `plugin eval cancel`
// hands the id to the cancel call with the process's stderr. The backend and
// the dispatch are replaced at their module seams (the command imports them
// lazily); the program, the option reading and the effects are real.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CliExitError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import type { PluginEvalOptions, PluginTarget } from "../../resources/plugin-eval/options.js";
import type { PluginEvalIo } from "../../resources/plugin-eval/run.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

// The client the command hands to the dispatch; identity is what is asserted.
const stigmer = vi.hoisted(() => ({ name: "stub-client" }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

const dispatch = vi.hoisted(() => ({ runPluginEval: vi.fn(), cancelPluginEval: vi.fn() }));
vi.mock("../../resources/plugin-eval/run.js", () => dispatch);

/** Runs `stigmer --org acme plugin eval ...`. */
async function pluginEval(...args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "plugin", "eval", ...args]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("stigmer plugin eval <plugin>", () => {
  it("hands the target, the checked options, the organization and the process's effects to the dispatch", async () => {
    dispatch.runPluginEval.mockResolvedValue(0);
    const digest = "c".repeat(64);
    await pluginEval(
      `thermos@${digest}`,
      "--tag",
      "smoke",
      "--tag",
      "fast",
      "--model",
      "native/claude-sonnet-4-6",
      "--model",
      "cursor/gpt-5",
      "--runs",
      "2",
      "--json",
    );

    expect(dispatch.runPluginEval).toHaveBeenCalledTimes(1);
    const [client, org, target, options, io] = dispatch.runPluginEval.mock.calls[0] as [
      unknown,
      string,
      PluginTarget,
      PluginEvalOptions,
      PluginEvalIo,
    ];
    expect(client).toBe(stigmer);
    expect(org).toBe("acme");
    expect(target).toEqual({ ref: "thermos", digest });
    expect(options).toMatchObject({
      caseTags: ["smoke", "fast"],
      runs: 2,
      targets: [{ modelName: "claude-sonnet-4-6" }, { modelName: "gpt-5" }],
      json: { kind: "stdout" },
      wait: true,
    });
    expect(io.stdout).toBe(process.stdout);
    expect(io.stderr).toBe(process.stderr);
  });

  it.each([
    ["one --tag with several values", ["--tag", "a", "b"], ["a", "b"]],
    ["a repeated --tag", ["--tag", "a", "--tag", "b"], ["a", "b"]],
    ["both at once", ["--tag", "a", "b", "--tag", "c"], ["a", "b", "c"]],
  ])("collects every tag from %s, as Claude Code's --tag <tag...> does", async (_name, flags, tags) => {
    dispatch.runPluginEval.mockResolvedValue(0);
    await pluginEval("thermos", ...flags);
    const options = dispatch.runPluginEval.mock.calls[0]?.[3] as PluginEvalOptions;
    expect(options.caseTags).toEqual(tags);
  });

  it("exits with the dispatch's code, silently, when it is not 0", async () => {
    dispatch.runPluginEval.mockResolvedValue(2);
    const error = await pluginEval("thermos").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(2);
    expect((error as CliExitError).message).toBe("");
  });

  it("refuses a bad option with exit 1 before any call", async () => {
    const error = await pluginEval("thermos", "--runs", "0").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect(dispatch.runPluginEval).not.toHaveBeenCalled();
  });
});

describe("stigmer plugin eval cancel <eval-id>", () => {
  it("cancels the eval by id and reports on the process's stderr", async () => {
    dispatch.cancelPluginEval.mockResolvedValue(undefined);
    await pluginEval("cancel", "pev_1");
    expect(dispatch.cancelPluginEval).toHaveBeenCalledWith(stigmer, "pev_1", { stderr: process.stderr });
    expect(dispatch.runPluginEval).not.toHaveBeenCalled();
  });
});
