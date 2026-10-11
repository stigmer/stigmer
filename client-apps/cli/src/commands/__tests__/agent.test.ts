// Command-level contract for `stigmer agent eval`: the program registers
// the `agent` group with `eval` and `eval cancel`; the target and every
// flag reach the dispatch read and checked (a version after @, a repeated
// --plugin and --model collect, --tag takes several values, no --ablation),
// in the organization --org names, with the process's own effects; the
// dispatch's exit code leaves through a silent CliExitError when it is not
// 0; and `agent eval cancel` hands the id to the cancel call with the
// process's stderr. The backend and the dispatch are replaced at their
// module seams (the command imports them lazily); the program, the option
// reading and the effects are real.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CliExitError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import type { AgentEvalOptions, AgentTarget } from "../../resources/agent-eval/options.js";
import type { EvalIo } from "../../resources/plugin-eval/follow.js";

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

const dispatch = vi.hoisted(() => ({ runAgentEval: vi.fn(), cancelAgentEval: vi.fn() }));
vi.mock("../../resources/agent-eval/run.js", () => dispatch);

/** Runs `stigmer --org acme agent eval ...`. */
async function agentEval(...args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "agent", "eval", ...args]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the agent group", () => {
  it("registers agent eval and agent eval cancel", () => {
    const agent = buildProgram().commands.find((command) => command.name() === "agent");
    const evalCommand = agent?.commands.find((command) => command.name() === "eval");
    expect(agent?.commands.map((command) => command.name())).toEqual(["eval"]);
    expect(evalCommand?.commands.map((command) => command.name())).toEqual(["cancel"]);
    expect(evalCommand?.options.map((option) => option.long)).not.toContain("--ablation");
  });
});

describe("stigmer agent eval <agent>", () => {
  it("hands the target, the checked options, the organization and the process's effects to the dispatch", async () => {
    dispatch.runAgentEval.mockResolvedValue(0);
    await agentEval(
      "support-desk@v3",
      "--plugin",
      "refund-policy",
      "--plugin",
      "tracker",
      "--model",
      "native/claude-sonnet-4-6",
      "--tag",
      "smoke",
      "fast",
      "--runs",
      "2",
      "--json",
    );

    expect(dispatch.runAgentEval).toHaveBeenCalledTimes(1);
    const [client, org, target, options, io] = dispatch.runAgentEval.mock.calls[0] as [
      unknown,
      string,
      AgentTarget,
      AgentEvalOptions,
      EvalIo,
    ];
    expect(client).toBe(stigmer);
    expect(org).toBe("acme");
    expect(target).toEqual({ ref: "support-desk", version: "v3" });
    expect(options).toMatchObject({
      plugins: ["refund-policy", "tracker"],
      caseTags: ["smoke", "fast"],
      runs: 2,
      targets: [{ modelName: "claude-sonnet-4-6" }],
      json: { kind: "stdout" },
      wait: true,
    });
    expect(io.stdout).toBe(process.stdout);
    expect(io.stderr).toBe(process.stderr);
  });

  it("names no target when no --model is given", async () => {
    dispatch.runAgentEval.mockResolvedValue(0);
    await agentEval("support-desk");
    const options = dispatch.runAgentEval.mock.calls[0]?.[3] as AgentEvalOptions;
    expect(options.targets).toEqual([]);
    expect(options.plugins).toEqual([]);
  });

  it("exits with the dispatch's code, silently, when it is not 0", async () => {
    dispatch.runAgentEval.mockResolvedValue(2);
    const error = await agentEval("support-desk").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(2);
    expect((error as CliExitError).message).toBe("");
  });

  it("refuses a bad option with exit 1 before any call", async () => {
    const error = await agentEval("support-desk@").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect(dispatch.runAgentEval).not.toHaveBeenCalled();
  });
});

describe("stigmer agent eval cancel <eval-id>", () => {
  it("cancels the eval by id and reports on the process's stderr", async () => {
    dispatch.cancelAgentEval.mockResolvedValue(undefined);
    await agentEval("cancel", "aev_1");
    expect(dispatch.cancelAgentEval).toHaveBeenCalledWith(stigmer, "aev_1", { stderr: process.stderr });
    expect(dispatch.runAgentEval).not.toHaveBeenCalled();
  });
});
