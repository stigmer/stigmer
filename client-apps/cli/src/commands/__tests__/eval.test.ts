// Command-level contract for `stigmer eval run` and `stigmer eval cancel`:
// the program registers the `eval` group with `run` and `cancel`; every
// flag reaches the dispatch read and checked (`--agent` with a version
// after @, `--plugin` beside it as the compared plugin or alone as the
// subject with a digest after @, a repeated --cases-from and --model
// collect, --tag takes several values and repeats), in the organization
// --org names, with the process's own effects; the dispatch's exit code
// leaves through a silent CliExitError when it is not 0; a bad option is
// refused with exit 1 before any call; and `eval cancel` hands the id to
// the cancel call with the process's stderr. The backend and the dispatch
// are replaced at their module seams (the command imports them lazily);
// the program, the option reading and the effects are real.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CliExitError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import type { EvalIo } from "../../resources/eval-run/follow.js";
import type { EvalRunOptions } from "../../resources/eval-run/options.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

// The client the command hands to the dispatch; identity is what is asserted.
const stigmer = vi.hoisted(() => ({ name: "stub-client" }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

const dispatch = vi.hoisted(() => ({ runEvalRun: vi.fn(), cancelEvalRun: vi.fn() }));
vi.mock("../../resources/eval-run/run.js", () => dispatch);

/** Runs `stigmer --org acme eval ...`. */
async function evalCommand(...args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "eval", ...args]);
}

/** The options the dispatch was handed by its first call. */
function handedOptions(): EvalRunOptions {
  return dispatch.runEvalRun.mock.calls[0]?.[2] as EvalRunOptions;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the eval group", () => {
  it("registers eval run and eval cancel", () => {
    const group = buildProgram().commands.find((command) => command.name() === "eval");
    expect(group?.commands.map((command) => command.name())).toEqual(["run", "cancel"]);
  });
});

describe("stigmer eval run", () => {
  it("hands the checked options, the organization and the process's effects to the dispatch", async () => {
    dispatch.runEvalRun.mockResolvedValue(0);
    await evalCommand(
      "run",
      "--agent",
      "support-desk@v3",
      "--plugin",
      "refund-policy",
      "--cases-from",
      "refund-policy",
      "--cases-from",
      "tracker",
      "--tag",
      "smoke",
      "--tag",
      "fast",
      "--model",
      "stigmer/claude-sonnet-4-6",
      "--model",
      "claude/claude-sonnet-5",
      "--runs",
      "2",
      "--json",
    );

    expect(dispatch.runEvalRun).toHaveBeenCalledTimes(1);
    const [client, org, options, io] = dispatch.runEvalRun.mock.calls[0] as [unknown, string, EvalRunOptions, EvalIo];
    expect(client).toBe(stigmer);
    expect(org).toBe("acme");
    expect(options).toMatchObject({
      subject: {
        kind: "agent",
        agent: { ref: "support-desk", version: "v3" },
        compared: "refund-policy",
        casesFrom: ["refund-policy", "tracker"],
      },
      caseTags: ["smoke", "fast"],
      runs: 2,
      targets: [{ modelName: "claude-sonnet-4-6" }, { modelName: "claude-sonnet-5" }],
      json: { kind: "stdout" },
      wait: true,
    });
    expect(io.stdout).toBe(process.stdout);
    expect(io.stderr).toBe(process.stderr);
  });

  it("reads --plugin alone as the plugin evaluated, at the digest after @", async () => {
    dispatch.runEvalRun.mockResolvedValue(0);
    const digest = "c".repeat(64);
    await evalCommand("run", "--plugin", `thermos@${digest}`);
    expect(handedOptions().subject).toEqual({ kind: "plugin", plugin: { ref: "thermos", digest } });
  });

  it.each([
    ["one --tag with several values", ["--tag", "a", "b"], ["a", "b"]],
    ["a repeated --tag", ["--tag", "a", "--tag", "b"], ["a", "b"]],
    ["both at once", ["--tag", "a", "b", "--tag", "c"], ["a", "b", "c"]],
  ])("collects every tag from %s, as Claude Code's --tag <tag...> does", async (_name, flags, tags) => {
    dispatch.runEvalRun.mockResolvedValue(0);
    await evalCommand("run", "--plugin", "thermos", ...flags);
    expect(handedOptions().caseTags).toEqual(tags);
  });

  it("exits with the dispatch's code, silently, when it is not 0", async () => {
    dispatch.runEvalRun.mockResolvedValue(2);
    const error = await evalCommand("run", "--plugin", "thermos").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(2);
    expect((error as CliExitError).message).toBe("");
  });

  it.each([
    ["a bad --runs", ["--plugin", "thermos", "--runs", "0"]],
    ["nothing to evaluate", []],
    ["an empty agent version", ["--agent", "support-desk@"]],
  ])("refuses %s with exit 1 before any call", async (_name, flags) => {
    const error = await evalCommand("run", ...flags).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect(dispatch.runEvalRun).not.toHaveBeenCalled();
  });
});

describe("stigmer eval cancel <eval-run-id>", () => {
  it("cancels the eval run by id and reports on the process's stderr", async () => {
    dispatch.cancelEvalRun.mockResolvedValue(undefined);
    await evalCommand("cancel", "evr_1");
    expect(dispatch.cancelEvalRun).toHaveBeenCalledWith(stigmer, "evr_1", { stderr: process.stderr });
    expect(dispatch.runEvalRun).not.toHaveBeenCalled();
  });
});
